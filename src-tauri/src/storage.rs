//! Vault 檔案格式與 I/O。
//!
//! Vault 結構(以 JSON 序列化):
//! ```json
//! {
//!   "version": 1,
//!   "kdf": { "algorithm": "argon2id", "m_cost": 65536, "t_cost": 3, "p_cost": 1, "salt": "<base64>" },
//!   "nonce": "<base64>",
//!   "ciphertext": "<base64>"
//! }
//! ```
//! 解密後的明文為 [`VaultPlain`] 的 JSON。

use crate::crypto::{self, KdfParams, KEY_LEN};
use crate::totp::Algorithm;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("I/O 錯誤: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 解析錯誤: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Base64 解碼錯誤: {0}")]
    B64(#[from] base64::DecodeError),
    #[error("加密錯誤: {0}")]
    Crypto(#[from] crypto::CryptoError),
    #[error("vault 版本不支援: {0}")]
    UnsupportedVersion(u32),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OtpKind {
    Totp,
    Hotp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub kind: OtpKind,
    pub name: String,
    pub issuer: Option<String>,
    /// base32 (RFC 4648, 無 padding)
    pub secret: String,
    pub algorithm: Algorithm,
    pub digits: u32,
    pub period: u64,
    /// 僅 HOTP 使用
    #[serde(default)]
    pub counter: Option<u64>,
    /// 建立 Unix 時間戳(秒)
    pub created_at: u64,
}

impl Account {
    pub fn new_totp(
        name: String,
        issuer: Option<String>,
        secret: String,
        algorithm: Algorithm,
        digits: u32,
        period: u64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            kind: OtpKind::Totp,
            name,
            issuer,
            secret,
            algorithm,
            digits,
            period,
            counter: None,
            created_at: now_unix(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultPlain {
    #[serde(default)]
    pub accounts: Vec<Account>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultFile {
    pub version: u32,
    pub kdf: KdfParams,
    /// base64
    pub nonce: String,
    /// base64
    pub ciphertext: String,
}

const VAULT_VERSION: u32 = 1;
pub const VAULT_FILENAME: &str = "vault.json";

/// 把明文加密並打包成 [`VaultFile`]。
pub fn seal(
    plain: &VaultPlain,
    key: &[u8; KEY_LEN],
    kdf: KdfParams,
) -> Result<VaultFile, StorageError> {
    let json = serde_json::to_vec(plain)?;
    let (nonce, ct) = crypto::encrypt(key, &json)?;
    Ok(VaultFile {
        version: VAULT_VERSION,
        kdf,
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ct),
    })
}

/// 從 [`VaultFile`] 解密回明文。
pub fn open(file: &VaultFile, key: &[u8; KEY_LEN]) -> Result<VaultPlain, StorageError> {
    if file.version != VAULT_VERSION {
        return Err(StorageError::UnsupportedVersion(file.version));
    }
    let nonce = B64.decode(&file.nonce)?;
    let ct = B64.decode(&file.ciphertext)?;
    let plain: Zeroizing<Vec<u8>> = crypto::decrypt(key, &nonce, &ct)?;
    let parsed: VaultPlain = serde_json::from_slice(&plain)?;
    Ok(parsed)
}

pub fn write_file(path: &Path, file: &VaultFile) -> Result<(), StorageError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(file)?;
    // 原子寫入:先寫到 .tmp 再 rename,避免半寫入毀損
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn read_file(path: &Path) -> Result<VaultFile, StorageError> {
    let bytes = std::fs::read(path)?;
    let f = serde_json::from_slice(&bytes)?;
    Ok(f)
}

pub fn vault_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(VAULT_FILENAME)
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::derive_key;

    fn fast_kdf() -> KdfParams {
        KdfParams {
            algorithm: "argon2id".into(),
            m_cost: 8,
            t_cost: 1,
            p_cost: 1,
            salt: vec![7u8; 16],
        }
    }

    #[test]
    fn seal_open_round_trip() {
        let kdf = fast_kdf();
        let key = derive_key("pw", &kdf).unwrap();
        let plain = VaultPlain {
            accounts: vec![Account::new_totp(
                "alice".into(),
                Some("Acme".into()),
                "JBSWY3DPEHPK3PXP".into(),
                Algorithm::Sha1,
                6,
                30,
            )],
        };
        let file = seal(&plain, &key, kdf.clone()).unwrap();
        let out = open(&file, &key).unwrap();
        assert_eq!(out.accounts.len(), 1);
        assert_eq!(out.accounts[0].name, "alice");
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir();
        let kdf = fast_kdf();
        let key = derive_key("pw", &kdf).unwrap();
        let plain = VaultPlain::default();
        let file = seal(&plain, &key, kdf).unwrap();
        let p = vault_path(&dir);
        write_file(&p, &file).unwrap();
        let read = read_file(&p).unwrap();
        let out = open(&read, &key).unwrap();
        assert_eq!(out.accounts.len(), 0);
    }

    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("auth2fa-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}
