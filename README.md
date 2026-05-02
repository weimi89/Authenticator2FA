# Authenticator 2FA

離線、開源、加密儲存的桌面版 2FA Authenticator,以 **Tauri 2 + Rust** 打造。

支援 TOTP / HOTP(RFC 4226 / RFC 6238)、`otpauth://` URI 匯入、自動產生帳戶頭像、深淺色主題切換,所有資料在本機以 **Argon2id + AES-256-GCM** 加密儲存,**永不上雲**。

## 功能

- TOTP 程式碼產生(支援 SHA1 / SHA256 / SHA512、6–10 位數、自訂週期)
- 從 `otpauth://` URI 匯入(QR Code 字串)或手動輸入
- 主密碼解鎖,鎖定即從記憶體歸零金鑰
- 1 秒倒數圓環,即將過期變色
- 一鍵複製到剪貼簿
- 深 / 淺色主題隨系統切換
- 變更主密碼時自動產生全新 salt

## 安全模型

| 項目 | 採用 |
| --- | --- |
| 金鑰派生 | Argon2id,m = 64 MiB,t = 3,p = 1,salt 16 byte |
| 對稱加密 | AES-256-GCM,nonce 12 byte(每次加密重新隨機),AAD 綁定版本 |
| 金鑰生命週期 | 解鎖時派生並包裝為 `Zeroizing<[u8; 32]>`,鎖定/離開作用域立即歸零 |
| 檔案寫入 | 原子寫入(`*.tmp` → rename),避免毀損 |
| Secret 暴露 | 前端永不接收 `secret`,僅收到 `AccountView` |

Vault 檔案位置:

- macOS:`~/Library/Application Support/app.miao.authenticator2fa/vault.json`
- Linux:`~/.local/share/app.miao.authenticator2fa/vault.json`
- Windows:`%APPDATA%\app.miao.authenticator2fa\vault.json`

> ⚠ 忘記主密碼將**無法**復原任何資料。請妥善保管,並備份 vault 檔案。

## 開發

需求:Rust 1.77+、`tauri-cli` v2。

```bash
# 第一次設定
cargo install tauri-cli --version "^2" --locked

# 開發模式(熱重載前端)
cd src-tauri && cargo tauri dev

# 產出可發布安裝包
cd src-tauri && cargo tauri build

# 全部測試(18 單元 + 3 整合)
cd src-tauri && cargo test
```

## 專案結構

```
.
├── src/                       # 前端(純 HTML / CSS / JS,無打包工具)
│   ├── index.html
│   ├── style.css
│   └── main.js
├── src-tauri/
│   ├── src/
│   │   ├── totp.rs            # RFC 4226 / 6238 從零實作
│   │   ├── otpauth.rs         # otpauth:// URI 解析
│   │   ├── crypto.rs          # Argon2id + AES-256-GCM
│   │   ├── storage.rs         # Vault 檔案 I/O
│   │   ├── lib.rs             # Tauri 命令 + AppState
│   │   └── main.rs            # 入口
│   ├── tests/end_to_end.rs    # 整合測試
│   ├── capabilities/
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── CLAUDE.md
└── README.md
```

進一步的架構說明請見 [`CLAUDE.md`](./CLAUDE.md)。

## 技術棧

- **Tauri 2** — 跨平台桌面 shell
- **Rust** — 後端與密碼學:`aes-gcm`、`argon2`、`hmac`、`sha1`、`sha2`、`zeroize`
- **純前端** — HTML / CSS / 原生 JS,不依賴任何 npm 套件或 bundler

## 授權

尚未指定。
