//! End-to-end 整合測試:模擬完整流程
//! 建立金庫 → 加帳戶 → 加密寫入 → 重新讀取 → 解密 → 產生 TOTP 程式碼

use authenticator_2fa_lib::{
    crypto::{derive_key, KdfParams},
    otpauth,
    storage::{self, Account, OtpKind, VaultPlain},
    totp::{self, Algorithm},
};
use std::path::PathBuf;

fn fast_kdf() -> KdfParams {
    // 整合測試用:極小參數確保快速
    KdfParams {
        algorithm: "argon2id".into(),
        m_cost: 8,
        t_cost: 1,
        p_cost: 1,
        salt: vec![42u8; 16],
    }
}

fn tempdir() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("auth2fa-e2e-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn full_lifecycle_with_uri_import() {
    let dir = tempdir();
    let path = storage::vault_path(&dir);
    let kdf = fast_kdf();

    // 1. 解析 otpauth:// URI(模擬 QR Code 匯入)
    let uri = "otpauth://totp/GitHub:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30";
    let parsed = otpauth::parse(uri).expect("解析 URI");
    assert_eq!(parsed.account_name, "alice@example.com");
    assert_eq!(parsed.secret, "JBSWY3DPEHPK3PXP");

    // 2. 建立帳戶並加入金庫
    let mut plain = VaultPlain::default();
    plain.accounts.push(Account::new_totp(
        parsed.account_name.clone(),
        parsed.issuer.clone(),
        parsed.secret.clone(),
        parsed.algorithm,
        parsed.digits,
        parsed.period,
    ));

    // 3. 加密並寫入磁碟
    let key = derive_key("master-pw-12345", &kdf).unwrap();
    let file = storage::seal(&plain, &key, kdf.clone()).unwrap();
    storage::write_file(&path, &file).unwrap();

    // 4. 模擬重新啟動:讀檔 → 派生金鑰 → 解密
    let read = storage::read_file(&path).unwrap();
    let key2 = derive_key("master-pw-12345", &read.kdf).unwrap();
    let restored = storage::open(&read, &key2).unwrap();

    assert_eq!(restored.accounts.len(), 1);
    let acc = &restored.accounts[0];
    assert_eq!(acc.name, "alice@example.com");
    assert_eq!(acc.issuer.as_deref(), Some("GitHub"));

    // 5. 用 RFC 6238 已知 t=59 / secret="12345678901234567890"(base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ) 生成程式碼
    let key_bytes = totp::decode_secret(&acc.secret).unwrap();
    let r = totp::totp(acc.algorithm, &key_bytes, 59, acc.period, acc.digits).unwrap();
    // 此處只驗證能成功產生 6 位數
    assert_eq!(r.formatted().len(), 6);

    // 6. 錯誤密碼應該失敗
    let bad_key = derive_key("wrong-password", &read.kdf).unwrap();
    assert!(storage::open(&read, &bad_key).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn vault_persists_across_reads() {
    let dir = tempdir();
    let path = storage::vault_path(&dir);
    let kdf = fast_kdf();
    let key = derive_key("pw", &kdf).unwrap();

    let plain = VaultPlain {
        accounts: vec![
            Account::new_totp("a".into(), None, "JBSW".into(), Algorithm::Sha1, 6, 30),
            Account::new_totp("b".into(), Some("Acme".into()), "MFRGG".into(), Algorithm::Sha256, 8, 60),
        ],
    };
    let file = storage::seal(&plain, &key, kdf.clone()).unwrap();
    storage::write_file(&path, &file).unwrap();

    // 多次讀取應該都成功
    for _ in 0..3 {
        let read = storage::read_file(&path).unwrap();
        let out = storage::open(&read, &key).unwrap();
        assert_eq!(out.accounts.len(), 2);
        assert_eq!(out.accounts[0].kind, OtpKind::Totp);
        assert_eq!(out.accounts[1].digits, 8);
    }

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rfc6238_compliance_through_pipeline() {
    // 用 RFC 6238 附錄 B 測試向量 secret = "12345678901234567890"(base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
    let secret_b32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    let key = totp::decode_secret(secret_b32).unwrap();
    assert_eq!(&key, b"12345678901234567890");

    let r = totp::totp(Algorithm::Sha1, &key, 1234567890, 30, 8).unwrap();
    assert_eq!(r.code, 89005924); // 來自 RFC 6238 附錄 B
}
