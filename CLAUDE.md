# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用指令

所有 `cargo` 指令都在 `src-tauri/` 目錄下執行。

```bash
# 開發模式(啟動桌面視窗,前端會 hot reload)
cd src-tauri && cargo tauri dev

# 產出可發布安裝包(.app / .dmg / .msi / .deb / .AppImage)
cd src-tauri && cargo tauri build

# 執行所有測試(18 個單元測試 + 3 個整合測試)
cd src-tauri && cargo test

# 依名稱執行單一測試
cd src-tauri && cargo test rfc6238_sha1_vectors

# 只跑 lib 單元測試(略過整合測試)
cd src-tauri && cargo test --lib

# 只做型別檢查不建置 binary
cd src-tauri && cargo check --bins
```

`tauri-cli` 不會自動安裝,需要先執行:`cargo install tauri-cli --version "^2" --locked`。

## 架構

這是一個 **Tauri 2 + Rust** 桌面應用程式。前端是**純 HTML/CSS/JS,沒有打包工具** — `tauri.conf.json` 把 `frontendDist` 直接指向 `../src`,並啟用 `withGlobalTauri: true` 暴露 `window.__TAURI__` 給前端,讓 JS 不需 import 即可呼叫後端命令。

### 分層(由下而上)

```
totp.rs / otpauth.rs / crypto.rs / storage.rs    ← 純模組,不依賴 Tauri
                       ↓
                   lib.rs                         ← Tauri 命令 + AppState
                       ↓
                   main.rs                        ← 進入點
                       ↓
              src/ (HTML / CSS / JS)              ← UI,呼叫 invoke()
```

`src-tauri/src/` 下的四個純模組刻意不依賴 Tauri,可獨立測試:

- **`totp.rs`** — RFC 4226 (HOTP) 與 RFC 6238 (TOTP) 從零實作於 `hmac` + `sha1`/`sha2` 之上。測試覆蓋整套 RFC 測試向量。
- **`otpauth.rs`** — `otpauth://` URI 解析器,回傳 `ParsedOtpAuth`。`counter` 欄位目前只用於 HOTP 驗證(命令層暫時拒絕 HOTP),因此標註 `#[allow(dead_code)]`。
- **`crypto.rs`** — Argon2id KDF(m=64 MiB / t=3 / p=1,16 byte salt,32 byte 金鑰)→ AES-256-GCM AEAD,每次加密用隨機 12 byte nonce 與固定 AAD `b"authenticator-2fa-vault-v1"`。派生金鑰用 `Zeroizing<[u8; 32]>` 包裝,離開作用域時自動歸零。
- **`storage.rs`** — 定義 `VaultFile`(磁碟格式)與 `VaultPlain`(解密後),由 `seal`/`open` 透過 `crypto` 互轉。`write_file` 採原子寫入(`*.tmp` 寫完再 rename),避免半寫入毀損。

### `lib.rs` 的狀態機

`AppState` 持有 `Mutex<Option<VaultRuntime>>`。`VaultRuntime` 含解密後的 `VaultPlain`、`Zeroizing` 派生金鑰、與 `KdfParams`(讓重新封裝時不需要再次輸入密碼)。

- 鎖定狀態 = `None` → 所有帳戶命令會以 `"vault 尚未解鎖"` 失敗。
- `vault_unlock` 讀檔 → 派生金鑰 → 解密 → 填入 runtime。
- `vault_lock` 寫入 `None`,先前的 `Zeroizing` 金鑰會在 drop 時歸零。
- 修改型命令(`add_*`、`remove_*`、`rename_*`、`vault_change_password`)更動 `runtime.plain` 後呼叫 `save_locked`,它會用快取的金鑰 + KDF 重新封裝並原子覆寫檔案。
- `vault_change_password` 會**產生全新的隨機 salt**,使密碼重複使用無法從 salt 被識別。

### 前後端契約

- 所有命令回傳 `Result<T, String>`,讓 JS 端只需處理字串錯誤(透過 `setError` 顯示)。
- 前端**永遠收不到** `Account` 完整物件,只會收到 `AccountView`(不含 `secret`)。`secret` 永遠留在 Rust 端。
- TOTP 程式碼由前端用 1 秒 `setInterval` 呼叫 `generate_codes` 命令計算;本地端只負責倒數 `remaining`,當歸零或首次渲染時才重新跟後端要。

### Vault 檔案位置

`app.path().app_data_dir() / vault.json`。在 macOS 為 `~/Library/Application Support/app.miao.authenticator2fa/vault.json`。

## 規範與陷阱

- **Tauri 2 權限**:在 JS 新增 plugin 命令時,**必須**同步在 `src-tauri/capabilities/default.json` 加上對應的 permission,否則執行時會被拒絕。
- **不要加回 `devUrl`**:`tauri.conf.json` 故意不設,本專案沒有真實的 dev server。重新加上會讓 `tauri dev` 一直卡在等 `localhost:1420`。
- **測試專用 KDF 參數**:測試傳的是 `KdfParams { m_cost: 8, t_cost: 1, p_cost: 1, .. }` 以保持快速;生產用 `KdfParams::new_random()`(64 MiB / 3 iters)。**不可**把測試參數複製到命令層程式碼。
- **模組是 `pub`**:`crypto`、`otpauth`、`storage`、`totp` 在 `lib.rs` 標為 `pub mod` 只是為了讓 `tests/end_to_end.rs` 整合測試能引用,不是對外 API。
- **HOTP**:解析器支援,但 `add_account_uri` 拒絕非 TOTP。要啟用 HOTP,需新增 `next_hotp_code(id)` 命令以遞增 `account.counter` 並重新存檔。
- **前端 HTML 跳脫**:`main.js` 的 `escapeHtml()` 用於 `renderList()` 內每個被插入的字串 — 編輯時請保留。
- **視窗尺寸**:460×720,設計假設單欄、無水平捲軸。

## 專案規則(來自使用者全域 CLAUDE.md)

- **不偷懶 / 不留 TODO**:修 bug 時要找根因,且把同樣的修法套用到專案中所有同類結構處。不可用 `try/catch`、skip flag 或「之後再做」的註解蓋住問題。
- **測試放在 `tests/`**:整合測試置於 `src-tauri/tests/`(遵循 Cargo 慣例);模組級單元測試保留在模組內的 `#[cfg(test)] mod tests`。
- **檔案搬移而非刪除**:要移除檔案時,改搬到 `backups/{YYYYMMDDHHMMSS}/{原路徑}`,並驗證專案仍能建置且測試通過。
- **Commit 訊息**:不可包含 `Co-Authored-By:`。
- **語言**:一律以繁體中文回覆。
