# Auth 2FA 專案指南 (GEMINI.md)

這是一個基於 **Tauri 2 + Rust** 開發的開源、離線、加密儲存的桌面版 2FA 驗證器 (Authenticator)。

## 專案概述

*   **目標**: 提供安全、私密且跨平台的雙因素驗證工具，所有資料皆在本機加密儲存，永不上雲。
*   **技術棧**:
    *   **後端**: Rust (Tauri 2)，使用 `aes-gcm`、`argon2`、`hmac`、`sha1`、`sha2`、`zeroize` 等密碼學函式庫。
    *   **前端**: 純 HTML / CSS / 原生 JavaScript，不依賴任何 npm 套件或打包工具 (Bundler)。
*   **核心架構**:
    *   `src-tauri/src/`:
        *   `totp.rs`: RFC 4226 (HOTP) 與 RFC 6238 (TOTP) 的純 Rust 實作。
        *   `otpauth.rs`: `otpauth://` URI 解析器。
        *   `crypto.rs`: 處理 Argon2id 金鑰派生與 AES-256-GCM 加密。
        *   `storage.rs`: 負責 Vault 檔案的 I/O 與原子寫入。
        *   `qr.rs`: QR Code 圖片解碼。
        *   `lib.rs`: Tauri 命令層與全域狀態管理 (`AppState`)。
    *   `src/`: 前端 UI，透過 `window.__TAURI__.core.invoke` 與後端通訊。

## 開發指南

### 環境需求
*   Rust 1.77+
*   `tauri-cli` v2: `cargo install tauri-cli --version "^2" --locked`

### 常用指令
所有 `cargo` 指令需在 `src-tauri/` 目錄下執行。

*   **開發模式**: `cargo tauri dev` (啟動桌面視窗，前端熱重載)。
*   **建置發布**: `cargo tauri build` (產出各平台安裝包)。
*   **執行測試**: `cargo test` (包含 18 個單元測試與 3 個整合測試)。
*   **型別檢查**: `cargo check --bins`。

### 關鍵位置
*   **Vault 檔案位置**:
    *   macOS: `~/Library/Application Support/app.miao.auth2fa/vault.json`
    *   Linux: `~/.local/share/app.miao.auth2fa/vault.json`
    *   Windows: `%APPDATA%\app.miao.auth2fa\vault.json`
*   **前端入口**: `src/index.html`
*   **整合測試**: `src-tauri/tests/end_to_end.rs`

## 開發規範與慣例

### 程式碼與設計
*   **安全性第一**: 
    *   `secret` 永遠留在 Rust 後端，前端僅接收 `AccountView`。
    *   機敏金鑰應使用 `Zeroizing` 包裝，確保在離開作用域時從記憶體清除。
*   **前端規範**: 
    *   由於不使用打包工具，`tauri.conf.json` 將 `frontendDist` 直接指向 `../src`。
    *   **不要**在 `tauri.conf.json` 中添加 `devUrl`。
    *   在 JS 中插入 HTML 字串時，必須使用 `escapeHtml()` 進行過濾。
*   **Tauri 權限**: 新增需要 plugin (如剪貼簿) 的命令時，必須在 `src-tauri/capabilities/default.json` 中添加相應權限。

### 測試慣例
*   **單元測試**: 放在模組內的 `#[cfg(test)] mod tests`。
*   **整合測試**: 放在 `src-tauri/tests/` 目錄。
*   **測試 KDF**: 測試時使用低強度的 KDF 參數以加速執行，但**絕對不可**將其用於正式生產環境。

### 檔案管理
*   **禁止刪除**: 不得直接刪除專案檔案，應將其移動至 `backups/{YYYYMMDDHHMMSS}/{原始路徑}`。

### 溝通與文件
*   **語言**: 一律使用**繁體中文**進行回覆（目前介面支援：繁體中文、簡體中文、英文、日文、法文、西班牙文、德文、韓文，共 8 種語系）。
*   **品質**: 不留 TODO，修復問題時應尋找根因並同步套用到所有類似結構。

## 狀態管理 (`lib.rs`)
`AppState` 持有一個 `Mutex<Option<VaultRuntime>>`：
*   `None`: 代表 Vault 處於鎖定狀態，大部分命令會失敗。
*   `Some(VaultRuntime)`: 包含解密後的數據、派生金鑰與 Kdf 參數。
*   修改數據後，系統會自動使用快取的金鑰重新封裝並進行原子寫入。
