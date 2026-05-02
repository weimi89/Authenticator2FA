//! Tauri 命令層:把 totp/crypto/storage 模組接到前端。

pub mod crypto;
pub mod otpauth;
pub mod qr;
pub mod storage;
pub mod totp;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use zeroize::Zeroizing;

use crypto::{KdfParams, KEY_LEN};
use storage::{Account, OtpKind, VaultFile, VaultPlain};
use totp::Algorithm;

// ---------- 應用程式狀態 ----------

struct VaultRuntime {
    plain: VaultPlain,
    key: Zeroizing<[u8; KEY_LEN]>,
    kdf: KdfParams,
}

pub struct AppState {
    vault_path: PathBuf,
    runtime: Mutex<Option<VaultRuntime>>,
}

impl AppState {
    fn new(vault_dir: PathBuf) -> Self {
        Self {
            vault_path: storage::vault_path(&vault_dir),
            runtime: Mutex::new(None),
        }
    }
}

// ---------- 對前端的 DTO ----------

#[derive(Serialize)]
struct VaultStatus {
    exists: bool,
    unlocked: bool,
}

#[derive(Serialize, Clone)]
struct AccountView {
    id: String,
    kind: String,
    name: String,
    issuer: Option<String>,
    algorithm: String,
    digits: u32,
    period: u64,
}

impl From<&Account> for AccountView {
    fn from(a: &Account) -> Self {
        AccountView {
            id: a.id.clone(),
            kind: match a.kind {
                OtpKind::Totp => "totp".into(),
                OtpKind::Hotp => "hotp".into(),
            },
            name: a.name.clone(),
            issuer: a.issuer.clone(),
            algorithm: format!("{:?}", a.algorithm).to_uppercase(),
            digits: a.digits,
            period: a.period,
        }
    }
}

#[derive(Serialize)]
struct CodeView {
    id: String,
    code: String,
    period: u64,
    remaining: u64,
}

#[derive(Deserialize)]
pub struct ManualAccountPayload {
    name: String,
    issuer: Option<String>,
    secret: String,
    algorithm: Option<String>, // "SHA1" / "SHA256" / "SHA512"
    digits: Option<u32>,
    period: Option<u64>,
}

// ---------- 工具函式 ----------

fn validate_account_input(name: &str, secret: &str, digits: u32, period: u64) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("err.name_required".into());
    }
    if !(6..=10).contains(&digits) {
        return Err("err.invalid_digits".into());
    }
    if !(5..=300).contains(&period) {
        return Err("err.invalid_period".into());
    }
    if totp::decode_secret(secret).is_none() {
        return Err("err.invalid_secret".into());
    }
    Ok(())
}

fn save_locked(state: &AppState, runtime: &VaultRuntime) -> Result<(), String> {
    let file = storage::seal(&runtime.plain, &runtime.key, runtime.kdf.clone())
        .map_err(|_| "err.seal_failed".to_string())?;
    storage::write_file(&state.vault_path, &file)
        .map_err(|_| "err.write_failed".to_string())?;
    Ok(())
}

// ---------- 命令 ----------

#[tauri::command]
fn vault_status(state: State<'_, AppState>) -> VaultStatus {
    let unlocked = state.runtime.lock().unwrap().is_some();
    let exists = state.vault_path.exists();
    VaultStatus { exists, unlocked }
}

#[tauri::command]
fn vault_init(state: State<'_, AppState>, password: String) -> Result<(), String> {
    if state.vault_path.exists() {
        return Err("err.vault_exists".into());
    }
    if password.len() < 8 {
        return Err("err.password_too_short".into());
    }
    let kdf = KdfParams::new_random();
    let key = crypto::derive_key(&password, &kdf).map_err(|_| "err.kdf_failed".to_string())?;
    let plain = VaultPlain::default();
    let file: VaultFile = storage::seal(&plain, &key, kdf.clone())
        .map_err(|_| "err.seal_failed".to_string())?;
    storage::write_file(&state.vault_path, &file)
        .map_err(|_| "err.write_failed".to_string())?;

    let mut guard = state.runtime.lock().unwrap();
    *guard = Some(VaultRuntime { plain, key, kdf });
    Ok(())
}

#[tauri::command]
fn vault_unlock(state: State<'_, AppState>, password: String) -> Result<(), String> {
    let file = storage::read_file(&state.vault_path)
        .map_err(|_| "err.vault_read_failed".to_string())?;
    let key = crypto::derive_key(&password, &file.kdf)
        .map_err(|_| "err.kdf_failed".to_string())?;
    // 解密失敗一律歸類為密碼錯誤(也可能是檔案被竄改 — 對使用者體驗一致地呈現)
    let plain = storage::open(&file, &key).map_err(|_| "err.wrong_password".to_string())?;

    let mut guard = state.runtime.lock().unwrap();
    *guard = Some(VaultRuntime {
        plain,
        key,
        kdf: file.kdf,
    });
    Ok(())
}

#[tauri::command]
fn vault_lock(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.runtime.lock().unwrap();
    *guard = None; // Zeroizing 會在 drop 時歸零
    Ok(())
}

#[tauri::command]
fn vault_change_password(
    state: State<'_, AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    if new_password.len() < 8 {
        return Err("err.password_too_short".into());
    }
    let mut guard = state.runtime.lock().unwrap();
    let runtime = guard.as_mut().ok_or("err.vault_locked")?;

    // 驗證舊密碼:用舊 kdf 重新派生並比對
    let old_key = crypto::derive_key(&old_password, &runtime.kdf)
        .map_err(|_| "err.kdf_failed".to_string())?;
    if old_key.as_slice() != runtime.key.as_slice() {
        return Err("err.wrong_old_password".into());
    }

    let new_kdf = KdfParams::new_random();
    let new_key = crypto::derive_key(&new_password, &new_kdf)
        .map_err(|_| "err.kdf_failed".to_string())?;
    runtime.kdf = new_kdf;
    runtime.key = new_key;
    save_locked(&state, runtime)
}

#[tauri::command]
fn list_accounts(state: State<'_, AppState>) -> Result<Vec<AccountView>, String> {
    let guard = state.runtime.lock().unwrap();
    let runtime = guard.as_ref().ok_or("err.vault_locked")?;
    Ok(runtime.plain.accounts.iter().map(AccountView::from).collect())
}

#[tauri::command]
fn add_account_uri(state: State<'_, AppState>, uri: String) -> Result<AccountView, String> {
    let parsed = otpauth::parse(uri.trim()).map_err(|_| "err.uri_invalid".to_string())?;
    if parsed.otp_type != otpauth::OtpType::Totp {
        return Err("err.only_totp".into());
    }
    validate_account_input(&parsed.account_name, &parsed.secret, parsed.digits, parsed.period)?;
    let issuer = parsed.issuer.or(parsed.label_issuer);

    let mut guard = state.runtime.lock().unwrap();
    let runtime = guard.as_mut().ok_or("err.vault_locked")?;
    let account = Account::new_totp(
        parsed.account_name,
        issuer,
        parsed.secret,
        parsed.algorithm,
        parsed.digits,
        parsed.period,
    );
    let view = AccountView::from(&account);
    runtime.plain.accounts.push(account);
    save_locked(&state, runtime)?;
    Ok(view)
}

#[tauri::command]
fn add_account_manual(
    state: State<'_, AppState>,
    payload: ManualAccountPayload,
) -> Result<AccountView, String> {
    let algorithm = match payload.algorithm.as_deref() {
        None | Some("") => Algorithm::Sha1,
        Some(s) => Algorithm::parse(s).ok_or("err.invalid_algorithm")?,
    };
    let digits = payload.digits.unwrap_or(6);
    let period = payload.period.unwrap_or(30);
    let secret_clean: String = payload
        .secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();

    validate_account_input(&payload.name, &secret_clean, digits, period)?;

    let mut guard = state.runtime.lock().unwrap();
    let runtime = guard.as_mut().ok_or("err.vault_locked")?;
    let account = Account::new_totp(
        payload.name.trim().to_string(),
        payload.issuer.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        secret_clean,
        algorithm,
        digits,
        period,
    );
    let view = AccountView::from(&account);
    runtime.plain.accounts.push(account);
    save_locked(&state, runtime)?;
    Ok(view)
}

#[tauri::command]
fn remove_account(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut guard = state.runtime.lock().unwrap();
    let runtime = guard.as_mut().ok_or("err.vault_locked")?;
    let before = runtime.plain.accounts.len();
    runtime.plain.accounts.retain(|a| a.id != id);
    if runtime.plain.accounts.len() == before {
        return Err("err.account_not_found".into());
    }
    save_locked(&state, runtime)
}

#[tauri::command]
fn rename_account(
    state: State<'_, AppState>,
    id: String,
    name: String,
    issuer: Option<String>,
) -> Result<AccountView, String> {
    if name.trim().is_empty() {
        return Err("err.name_required".into());
    }
    let mut guard = state.runtime.lock().unwrap();
    let runtime = guard.as_mut().ok_or("err.vault_locked")?;
    let acc = runtime
        .plain
        .accounts
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("err.account_not_found")?;
    acc.name = name.trim().to_string();
    acc.issuer = issuer.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let view = AccountView::from(&*acc);
    save_locked(&state, runtime)?;
    Ok(view)
}

#[tauri::command]
fn generate_codes(state: State<'_, AppState>) -> Result<Vec<CodeView>, String> {
    let guard = state.runtime.lock().unwrap();
    let runtime = guard.as_ref().ok_or("err.vault_locked")?;
    let now = storage::now_unix();
    let mut out = Vec::with_capacity(runtime.plain.accounts.len());
    for a in &runtime.plain.accounts {
        if a.kind != OtpKind::Totp {
            continue;
        }
        let key = match totp::decode_secret(&a.secret) {
            Some(k) => k,
            None => continue, // 跳過毀損條目而非整個失敗
        };
        let result = totp::totp(a.algorithm, &key, now, a.period, a.digits)
            .map_err(|_| "err.totp_failed".to_string())?;
        out.push(CodeView {
            id: a.id.clone(),
            code: result.formatted(),
            period: result.period,
            remaining: result.remaining,
        });
    }
    Ok(out)
}

#[tauri::command]
fn reorder_accounts(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), String> {
    let mut guard = state.runtime.lock().unwrap();
    let runtime = guard.as_mut().ok_or("err.vault_locked")?;

    // 必須是現有帳戶的 permutation,不可遺漏或新增
    if ids.len() != runtime.plain.accounts.len() {
        return Err("err.reorder_invalid".into());
    }
    let mut reordered = Vec::with_capacity(ids.len());
    for id in &ids {
        let pos = runtime
            .plain
            .accounts
            .iter()
            .position(|a| a.id == *id)
            .ok_or("err.reorder_invalid")?;
        reordered.push(runtime.plain.accounts.swap_remove(pos));
    }
    runtime.plain.accounts = reordered;
    save_locked(&state, runtime)
}

#[tauri::command]
fn export_vault_to_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    // 把目前磁碟上的(已加密)vault.json 原封不動複製到使用者選擇的路徑
    if !state.vault_path.exists() {
        return Err("err.vault_read_failed".into());
    }
    let target = std::path::PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "err.write_failed".to_string())?;
    }
    std::fs::copy(&state.vault_path, &target).map_err(|_| "err.write_failed".to_string())?;
    Ok(())
}

#[tauri::command]
fn decode_qr_from_path(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    qr::decode_from_path(&p).map_err(|e| match e {
        qr::QrError::Read => "err.qr_read_failed".into(),
        qr::QrError::Format => "err.qr_format_unsupported".into(),
        qr::QrError::NotFound => "err.qr_not_found".into(),
        qr::QrError::Decode => "err.qr_decode_failed".into(),
    })
}

#[tauri::command]
fn import_vault_from_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    // 讀取使用者選擇的檔案 → 驗證為合法的 VaultFile JSON → 取代目前 vault.json
    // 注意:取代後會強制鎖定,使用者必須以匯入檔的主密碼解鎖
    let source = std::path::PathBuf::from(&path);
    let bytes = std::fs::read(&source).map_err(|_| "err.vault_read_failed".to_string())?;
    let _: VaultFile =
        serde_json::from_slice(&bytes).map_err(|_| "err.import_invalid".to_string())?;

    if let Some(parent) = state.vault_path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "err.write_failed".to_string())?;
    }
    let tmp = state.vault_path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|_| "err.write_failed".to_string())?;
    std::fs::rename(&tmp, &state.vault_path).map_err(|_| "err.write_failed".to_string())?;

    // 強制鎖定:舊的 runtime 金鑰已不對應新匯入的檔案
    let mut guard = state.runtime.lock().unwrap();
    *guard = None;
    Ok(())
}

// ---------- 入口 ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("無法取得 app_data_dir");
            std::fs::create_dir_all(&dir).ok();
            app.manage(AppState::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_init,
            vault_unlock,
            vault_lock,
            vault_change_password,
            list_accounts,
            add_account_uri,
            add_account_manual,
            remove_account,
            rename_account,
            generate_codes,
            reorder_accounts,
            export_vault_to_path,
            import_vault_from_path,
            decode_qr_from_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
