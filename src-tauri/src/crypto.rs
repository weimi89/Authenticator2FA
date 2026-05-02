//! 主密碼派生 (Argon2id) + AES-256-GCM 加解密
//!
//! 設計:
//! - KDF: Argon2id, 預設 m=64MB / t=3 / p=1, 鹽 16 bytes, 派生金鑰 32 bytes
//! - AEAD: AES-256-GCM, nonce 12 bytes(每次加密時隨機產生)
//! - 密鑰於記憶體以 [`Zeroizing`] 包裝,離開作用域立即歸零

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm as ArgonAlg, Argon2, Params, Version};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("密碼錯誤或資料毀損")]
    DecryptFailed,
    #[error("加密失敗")]
    EncryptFailed,
    #[error("KDF 失敗: {0}")]
    KdfFailed(String),
    #[error("KDF 參數無效")]
    InvalidKdfParams,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KdfParams {
    pub algorithm: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    /// 16 bytes salt
    pub salt: Vec<u8>,
}

impl KdfParams {
    pub fn new_random() -> Self {
        let mut salt = vec![0u8; 16];
        OsRng.fill_bytes(&mut salt);
        Self {
            algorithm: "argon2id".to_string(),
            m_cost: 64 * 1024, // 64 MiB
            t_cost: 3,
            p_cost: 1,
            salt,
        }
    }
}

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
const AAD: &[u8] = b"authenticator-2fa-vault-v1";

/// 從密碼派生 32-byte 金鑰。
pub fn derive_key(password: &str, params: &KdfParams) -> Result<Zeroizing<[u8; KEY_LEN]>, CryptoError> {
    if params.algorithm != "argon2id" {
        return Err(CryptoError::InvalidKdfParams);
    }
    let argon_params = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(KEY_LEN))
        .map_err(|e| CryptoError::KdfFailed(e.to_string()))?;
    let argon = Argon2::new(ArgonAlg::Argon2id, Version::V0x13, argon_params);

    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), &params.salt, &mut key)
        .map_err(|e| CryptoError::KdfFailed(e.to_string()))?;
    Ok(Zeroizing::new(key))
}

/// 加密任意位元組,回傳 (nonce, ciphertext)。
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: AAD,
            },
        )
        .map_err(|_| CryptoError::EncryptFailed)?;
    Ok((nonce_bytes.to_vec(), ciphertext))
}

/// 以 nonce + ciphertext 解密。
pub fn decrypt(
    key: &[u8; KEY_LEN],
    nonce_bytes: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if nonce_bytes.len() != NONCE_LEN {
        return Err(CryptoError::DecryptFailed);
    }
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: AAD,
            },
        )
        .map_err(|_| CryptoError::DecryptFailed)?;
    Ok(Zeroizing::new(plain))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fast_params() -> KdfParams {
        // 測試用:極小參數加快速度
        KdfParams {
            algorithm: "argon2id".into(),
            m_cost: 8,
            t_cost: 1,
            p_cost: 1,
            salt: vec![1u8; 16],
        }
    }

    #[test]
    fn derive_key_is_deterministic() {
        let p = fast_params();
        let k1 = derive_key("password123", &p).unwrap();
        let k2 = derive_key("password123", &p).unwrap();
        assert_eq!(*k1, *k2);
    }

    #[test]
    fn derive_key_changes_with_password() {
        let p = fast_params();
        let k1 = derive_key("a", &p).unwrap();
        let k2 = derive_key("b", &p).unwrap();
        assert_ne!(*k1, *k2);
    }

    #[test]
    fn round_trip_encrypt_decrypt() {
        let p = fast_params();
        let key = derive_key("hunter2", &p).unwrap();
        let plaintext = b"the cake is a lie".to_vec();
        let (nonce, ct) = encrypt(&key, &plaintext).unwrap();
        let pt = decrypt(&key, &nonce, &ct).unwrap();
        assert_eq!(&pt[..], &plaintext[..]);
    }

    #[test]
    fn wrong_key_fails() {
        let p = fast_params();
        let key1 = derive_key("right", &p).unwrap();
        let key2 = derive_key("wrong", &p).unwrap();
        let (nonce, ct) = encrypt(&key1, b"data").unwrap();
        assert!(decrypt(&key2, &nonce, &ct).is_err());
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let p = fast_params();
        let key = derive_key("k", &p).unwrap();
        let (nonce, mut ct) = encrypt(&key, b"data").unwrap();
        ct[0] ^= 0xFF;
        assert!(decrypt(&key, &nonce, &ct).is_err());
    }
}
