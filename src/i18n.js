"use strict";

// 整個模組包進 IIFE,避免 top-level function 宣告污染 window(WebKit 在 strict
// 下會把 top-level function 設成 global property,main.js 再用 const 解構同名
// 變數時會丟 "Can't create duplicate variable that shadows a global property")
(function () {

// ----------------------------------------------------------------------------
// 多語系字典
// 規則:
//  - UI 字串以 dot.path key 命名(例:"lock.title")
//  - 後端錯誤以 "err.*" 開頭(例:"err.wrong_password");Rust 端只回傳 key
//  - 變數插值用 {name} 格式;t(key, {name: "..."})
// ----------------------------------------------------------------------------

const SUPPORTED = ["zh-TW", "en", "ja"];
const DEFAULT_LOCALE = "zh-TW";
const STORAGE_KEY = "auth2fa.locale";

const dictionaries = {
  "zh-TW": {
    "lang.name": "繁體中文",

    // 鎖定畫面
    "lock.title.unlock": "Authenticator 2FA",
    "lock.title.init": "建立金庫",
    "lock.subtitle.unlock": "輸入主密碼以解鎖您的金庫",
    "lock.subtitle.init": "設定一個強主密碼來保護您的 2FA 金鑰",
    "lock.button.unlock": "解鎖",
    "lock.button.init": "建立金庫",
    "lock.button.unlocking": "驗證中…",
    "lock.button.creating": "建立中…",
    "lock.placeholder.password": "主密碼",
    "lock.placeholder.confirm": "再次輸入主密碼",
    "lock.hint": "金庫使用 Argon2id + AES-256-GCM 在本機加密。忘記密碼將無法復原。",
    "lock.error.password_required": "請輸入密碼",
    "lock.error.password_mismatch": "兩次密碼不一致",
    "lock.startup_failed": "啟動失敗:{err}",

    // 頂列
    "top.title": "Authenticator",
    "top.add": "新增帳戶",
    "top.lock": "鎖定",
    "top.language": "語言",
    "top.search": "搜尋",
    "top.settings": "設定",

    // 搜尋
    "search.placeholder": "搜尋帳戶或發行者…",
    "search.no_results": "找不到符合「{query}」的帳戶",

    // 空狀態
    "empty.title": "金庫已就緒",
    "empty.body": "新增您的第一個 2FA 帳戶,開始安全地管理一次性驗證碼。",
    "empty.button": "新增帳戶",

    // 帳戶卡
    "card.copy": "複製",
    "card.delete": "刪除",
    "card.edit": "編輯",
    "card.menu": "選單",
    "card.reveal": "顯示驗證碼",
    "card.placeholder_code": "— — —",
    "card.hidden_code": "• • •  • • •",

    // 新增 modal
    "modal.title": "新增帳戶",
    "modal.close": "關閉",
    "modal.tab.uri": "otpauth:// 連結",
    "modal.tab.manual": "手動輸入",
    "modal.uri.label": "otpauth:// URI",
    "modal.uri.hint": "貼上 otpauth:// 字串,或從圖片載入 QR Code。",
    "modal.uri.choose_image": "選擇 QR 圖片",
    "modal.uri.image_decoded": "已從圖片讀取 QR Code,請確認後儲存。",
    "modal.field.name": "帳戶名稱",
    "modal.field.secret": "您的金鑰",
    "modal.field.kind": "金鑰類型",
    "modal.kind.totp": "根據時間",
    "modal.kind.hotp": "根據計數器(尚未支援)",
    "modal.advanced": "進階選項",
    "modal.field.issuer": "發行者",
    "modal.field.algorithm": "演算法",
    "modal.field.digits": "位數",
    "modal.field.period": "週期(秒)",
    "modal.cancel": "取消",
    "modal.save": "儲存",
    "modal.error.uri_required": "請輸入 otpauth:// URI",
    "modal.error.fields_required": "名稱與金鑰為必填",

    // Toast
    "toast.copied": "已複製 {code}",
    "toast.added": "已新增「{name}」",
    "toast.updated": "已更新「{name}」",
    "toast.deleted": "已刪除",
    "toast.read_failed": "讀取失敗:{err}",
    "toast.codes_failed": "產生程式碼失敗:{err}",
    "toast.copy_failed": "複製失敗:{err}",
    "toast.delete_failed": "刪除失敗:{err}",
    "toast.password_changed": "主密碼已更新",
    "toast.exported": "已匯出加密備份",
    "toast.imported": "匯入完成,請以該備份的主密碼解鎖",
    "toast.locked_auto": "閒置過久,已自動鎖定",
    "toast.reordered": "順序已更新",

    // 對話框
    "dialog.delete.title": "刪除帳戶",
    "dialog.delete.body": "確定要刪除「{name}」嗎?此操作無法復原。",
    "dialog.import.title": "匯入備份",
    "dialog.import.body": "匯入後將取代目前金庫,並需要以該備份的主密碼解鎖。確定繼續?",

    // 編輯帳戶
    "edit.title": "編輯帳戶",
    "edit.field.name": "帳戶名稱",
    "edit.field.issuer": "發行者",
    "edit.save": "儲存",

    // 設定
    "settings.title": "設定",
    "settings.section.appearance": "外觀",
    "settings.section.security": "安全",
    "settings.section.backup": "備份",
    "settings.section.about": "關於",
    "settings.theme.label": "主題",
    "settings.theme.auto": "跟隨系統",
    "settings.theme.light": "淺色",
    "settings.theme.dark": "深色",
    "settings.language.label": "語言",
    "settings.autolock.label": "自動鎖定",
    "settings.autolock.off": "永不",
    "settings.autolock.1m": "1 分鐘後",
    "settings.autolock.5m": "5 分鐘後",
    "settings.autolock.15m": "15 分鐘後",
    "settings.autolock.30m": "30 分鐘後",
    "settings.reveal.label": "預設隱藏驗證碼",
    "settings.reveal.hint": "點擊卡片才顯示,適合螢幕分享情境。",
    "settings.change_password.button": "變更主密碼",
    "settings.export.button": "匯出加密備份",
    "settings.export.hint": "備份檔已加密,但仍請妥善保管。",
    "settings.import.button": "從備份匯入",
    "settings.about.tagline": "離線、開源的 2FA 驗證器",
    "settings.about.version": "版本 {version}",

    // 變更主密碼
    "changepw.title": "變更主密碼",
    "changepw.old": "目前密碼",
    "changepw.new": "新密碼(至少 8 字元)",
    "changepw.confirm": "再次輸入新密碼",
    "changepw.button": "更新",
    "changepw.error.mismatch": "兩次新密碼不一致",

    // 後端錯誤(Rust 回傳 key)
    "err.vault_locked": "金庫尚未解鎖",
    "err.vault_exists": "金庫已存在,請改用解鎖",
    "err.password_too_short": "密碼至少 8 個字元",
    "err.wrong_password": "密碼錯誤",
    "err.wrong_old_password": "舊密碼錯誤",
    "err.only_totp": "目前僅支援 TOTP",
    "err.account_not_found": "找不到該帳戶",
    "err.name_required": "名稱不可為空",
    "err.invalid_algorithm": "演算法必須是 SHA1、SHA256 或 SHA512",
    "err.invalid_digits": "位數必須介於 6 到 10 之間",
    "err.invalid_period": "週期必須介於 5 到 300 秒",
    "err.invalid_secret": "金鑰不是合法的 Base32",
    "err.uri_invalid": "otpauth:// URI 格式錯誤",
    "err.kdf_failed": "金鑰派生失敗",
    "err.seal_failed": "加密失敗",
    "err.write_failed": "寫入失敗",
    "err.vault_read_failed": "讀取金庫失敗",
    "err.totp_failed": "TOTP 計算失敗",
    "err.import_invalid": "備份檔格式錯誤或已毀損",
    "err.reorder_invalid": "排序資料不正確",
    "err.qr_read_failed": "無法讀取圖片檔",
    "err.qr_format_unsupported": "圖片格式不支援(請用 PNG / JPG / WebP / GIF / BMP)",
    "err.qr_not_found": "圖片中找不到 QR Code",
    "err.qr_decode_failed": "QR Code 解碼失敗",
  },

  en: {
    "lang.name": "English",

    "lock.title.unlock": "Authenticator 2FA",
    "lock.title.init": "Create vault",
    "lock.subtitle.unlock": "Enter your master password to unlock the vault",
    "lock.subtitle.init": "Choose a strong master password to protect your 2FA keys",
    "lock.button.unlock": "Unlock",
    "lock.button.init": "Create vault",
    "lock.button.unlocking": "Verifying…",
    "lock.button.creating": "Creating…",
    "lock.placeholder.password": "Master password",
    "lock.placeholder.confirm": "Confirm master password",
    "lock.hint": "Encrypted locally with Argon2id + AES-256-GCM. A forgotten password cannot be recovered.",
    "lock.error.password_required": "Please enter your password",
    "lock.error.password_mismatch": "Passwords do not match",
    "lock.startup_failed": "Startup failed: {err}",

    "top.title": "Authenticator",
    "top.add": "Add account",
    "top.lock": "Lock",
    "top.language": "Language",
    "top.search": "Search",
    "top.settings": "Settings",

    "search.placeholder": "Search accounts or issuers…",
    "search.no_results": "No accounts match “{query}”",

    "empty.title": "Your vault is ready",
    "empty.body": "Add your first 2FA account to start managing one-time codes securely.",
    "empty.button": "Add account",

    "card.copy": "Copy",
    "card.delete": "Delete",
    "card.edit": "Edit",
    "card.menu": "Menu",
    "card.reveal": "Reveal code",
    "card.placeholder_code": "— — —",
    "card.hidden_code": "• • •  • • •",

    "modal.title": "Add account",
    "modal.close": "Close",
    "modal.tab.uri": "otpauth:// link",
    "modal.tab.manual": "Manual entry",
    "modal.uri.label": "otpauth:// URI",
    "modal.uri.hint": "Paste an otpauth:// string, or load it from a QR code image.",
    "modal.uri.choose_image": "Choose QR image",
    "modal.uri.image_decoded": "QR code decoded — review and save.",
    "modal.field.name": "Account name",
    "modal.field.secret": "Your key",
    "modal.field.kind": "Key type",
    "modal.kind.totp": "Time based",
    "modal.kind.hotp": "Counter based (not supported yet)",
    "modal.advanced": "Advanced options",
    "modal.field.issuer": "Issuer",
    "modal.field.algorithm": "Algorithm",
    "modal.field.digits": "Digits",
    "modal.field.period": "Period (seconds)",
    "modal.cancel": "Cancel",
    "modal.save": "Save",
    "modal.error.uri_required": "Please enter an otpauth:// URI",
    "modal.error.fields_required": "Name and key are required",

    "toast.copied": "Copied {code}",
    "toast.added": "Added “{name}”",
    "toast.updated": "Updated “{name}”",
    "toast.deleted": "Deleted",
    "toast.read_failed": "Read failed: {err}",
    "toast.codes_failed": "Code generation failed: {err}",
    "toast.copy_failed": "Copy failed: {err}",
    "toast.delete_failed": "Delete failed: {err}",
    "toast.password_changed": "Master password updated",
    "toast.exported": "Encrypted backup exported",
    "toast.imported": "Imported. Unlock with the backup’s master password.",
    "toast.locked_auto": "Auto-locked due to inactivity",
    "toast.reordered": "Order updated",

    "dialog.delete.title": "Delete account",
    "dialog.delete.body": "Delete “{name}”? This cannot be undone.",
    "dialog.import.title": "Import backup",
    "dialog.import.body": "This replaces your current vault. You’ll need the backup’s master password to unlock. Continue?",

    "edit.title": "Edit account",
    "edit.field.name": "Account name",
    "edit.field.issuer": "Issuer",
    "edit.save": "Save",

    "settings.title": "Settings",
    "settings.section.appearance": "Appearance",
    "settings.section.security": "Security",
    "settings.section.backup": "Backup",
    "settings.section.about": "About",
    "settings.theme.label": "Theme",
    "settings.theme.auto": "System",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "settings.language.label": "Language",
    "settings.autolock.label": "Auto-lock",
    "settings.autolock.off": "Never",
    "settings.autolock.1m": "After 1 minute",
    "settings.autolock.5m": "After 5 minutes",
    "settings.autolock.15m": "After 15 minutes",
    "settings.autolock.30m": "After 30 minutes",
    "settings.reveal.label": "Hide codes by default",
    "settings.reveal.hint": "Tap a card to reveal — useful when sharing your screen.",
    "settings.change_password.button": "Change master password",
    "settings.export.button": "Export encrypted backup",
    "settings.export.hint": "The file is encrypted but still keep it safe.",
    "settings.import.button": "Import from backup",
    "settings.about.tagline": "Offline, open-source 2FA authenticator",
    "settings.about.version": "Version {version}",

    "changepw.title": "Change master password",
    "changepw.old": "Current password",
    "changepw.new": "New password (at least 8 characters)",
    "changepw.confirm": "Confirm new password",
    "changepw.button": "Update",
    "changepw.error.mismatch": "New passwords do not match",

    "err.vault_locked": "Vault is locked",
    "err.vault_exists": "Vault already exists; please unlock instead",
    "err.password_too_short": "Password must be at least 8 characters",
    "err.wrong_password": "Wrong password",
    "err.wrong_old_password": "Old password is incorrect",
    "err.only_totp": "Only TOTP is supported",
    "err.account_not_found": "Account not found",
    "err.name_required": "Name cannot be empty",
    "err.invalid_algorithm": "Algorithm must be SHA1, SHA256, or SHA512",
    "err.invalid_digits": "Digits must be between 6 and 10",
    "err.invalid_period": "Period must be between 5 and 300 seconds",
    "err.invalid_secret": "Key is not valid Base32",
    "err.uri_invalid": "Invalid otpauth:// URI",
    "err.kdf_failed": "Key derivation failed",
    "err.seal_failed": "Encryption failed",
    "err.write_failed": "Write failed",
    "err.vault_read_failed": "Failed to read vault",
    "err.totp_failed": "TOTP computation failed",
    "err.import_invalid": "Backup file is corrupted or invalid",
    "err.reorder_invalid": "Reorder data is invalid",
    "err.qr_read_failed": "Could not read the image file",
    "err.qr_format_unsupported": "Unsupported image format (use PNG / JPG / WebP / GIF / BMP)",
    "err.qr_not_found": "No QR code found in the image",
    "err.qr_decode_failed": "Failed to decode the QR code",
  },

  ja: {
    "lang.name": "日本語",

    "lock.title.unlock": "Authenticator 2FA",
    "lock.title.init": "金庫を作成",
    "lock.subtitle.unlock": "マスターパスワードを入力して金庫を開きます",
    "lock.subtitle.init": "2FA キーを保護する強力なマスターパスワードを設定してください",
    "lock.button.unlock": "ロック解除",
    "lock.button.init": "金庫を作成",
    "lock.button.unlocking": "確認中…",
    "lock.button.creating": "作成中…",
    "lock.placeholder.password": "マスターパスワード",
    "lock.placeholder.confirm": "マスターパスワードを再入力",
    "lock.hint": "Argon2id と AES-256-GCM でローカル暗号化されます。パスワードを忘れると復元できません。",
    "lock.error.password_required": "パスワードを入力してください",
    "lock.error.password_mismatch": "パスワードが一致しません",
    "lock.startup_failed": "起動に失敗しました:{err}",

    "top.title": "Authenticator",
    "top.add": "アカウント追加",
    "top.lock": "ロック",
    "top.language": "言語",
    "top.search": "検索",
    "top.settings": "設定",

    "search.placeholder": "アカウントまたは発行者を検索…",
    "search.no_results": "「{query}」に一致するアカウントはありません",

    "empty.title": "金庫の準備ができました",
    "empty.body": "最初の 2FA アカウントを追加して、ワンタイムコードを安全に管理しましょう。",
    "empty.button": "アカウント追加",

    "card.copy": "コピー",
    "card.delete": "削除",
    "card.edit": "編集",
    "card.menu": "メニュー",
    "card.reveal": "コードを表示",
    "card.placeholder_code": "— — —",
    "card.hidden_code": "• • •  • • •",

    "modal.title": "アカウント追加",
    "modal.close": "閉じる",
    "modal.tab.uri": "otpauth:// リンク",
    "modal.tab.manual": "手動入力",
    "modal.uri.label": "otpauth:// URI",
    "modal.uri.hint": "otpauth:// 文字列を貼り付けるか、画像から QR コードを読み込みます。",
    "modal.uri.choose_image": "QR 画像を選択",
    "modal.uri.image_decoded": "QR コードを読み取りました。内容を確認して保存してください。",
    "modal.field.name": "アカウント名",
    "modal.field.secret": "キー",
    "modal.field.kind": "キーの種類",
    "modal.kind.totp": "時間ベース",
    "modal.kind.hotp": "カウンターベース(未対応)",
    "modal.advanced": "詳細オプション",
    "modal.field.issuer": "発行者",
    "modal.field.algorithm": "アルゴリズム",
    "modal.field.digits": "桁数",
    "modal.field.period": "周期(秒)",
    "modal.cancel": "キャンセル",
    "modal.save": "保存",
    "modal.error.uri_required": "otpauth:// URI を入力してください",
    "modal.error.fields_required": "名前とキーは必須です",

    "toast.copied": "{code} をコピーしました",
    "toast.added": "「{name}」を追加しました",
    "toast.updated": "「{name}」を更新しました",
    "toast.deleted": "削除しました",
    "toast.read_failed": "読み取り失敗:{err}",
    "toast.codes_failed": "コード生成に失敗:{err}",
    "toast.copy_failed": "コピー失敗:{err}",
    "toast.delete_failed": "削除失敗:{err}",
    "toast.password_changed": "マスターパスワードを変更しました",
    "toast.exported": "暗号化バックアップを書き出しました",
    "toast.imported": "インポート完了。バックアップのマスターパスワードで開いてください",
    "toast.locked_auto": "操作がないため自動ロックしました",
    "toast.reordered": "並び順を更新しました",

    "dialog.delete.title": "アカウントを削除",
    "dialog.delete.body": "「{name}」を削除しますか?この操作は取り消せません。",
    "dialog.import.title": "バックアップから復元",
    "dialog.import.body": "現在の金庫を上書きします。バックアップのマスターパスワードでロック解除する必要があります。続行しますか?",

    "edit.title": "アカウントを編集",
    "edit.field.name": "アカウント名",
    "edit.field.issuer": "発行者",
    "edit.save": "保存",

    "settings.title": "設定",
    "settings.section.appearance": "外観",
    "settings.section.security": "セキュリティ",
    "settings.section.backup": "バックアップ",
    "settings.section.about": "アプリ情報",
    "settings.theme.label": "テーマ",
    "settings.theme.auto": "システムに合わせる",
    "settings.theme.light": "ライト",
    "settings.theme.dark": "ダーク",
    "settings.language.label": "言語",
    "settings.autolock.label": "自動ロック",
    "settings.autolock.off": "しない",
    "settings.autolock.1m": "1 分後",
    "settings.autolock.5m": "5 分後",
    "settings.autolock.15m": "15 分後",
    "settings.autolock.30m": "30 分後",
    "settings.reveal.label": "コードをデフォルトで隠す",
    "settings.reveal.hint": "カードをタップで表示。画面共有時に便利です。",
    "settings.change_password.button": "マスターパスワードを変更",
    "settings.export.button": "暗号化バックアップを書き出す",
    "settings.export.hint": "ファイルは暗号化済みですが、保管にはご注意ください。",
    "settings.import.button": "バックアップから復元",
    "settings.about.tagline": "オフラインで動作するオープンソース 2FA",
    "settings.about.version": "バージョン {version}",

    "changepw.title": "マスターパスワードを変更",
    "changepw.old": "現在のパスワード",
    "changepw.new": "新しいパスワード(8 文字以上)",
    "changepw.confirm": "新しいパスワードを再入力",
    "changepw.button": "更新",
    "changepw.error.mismatch": "新しいパスワードが一致しません",

    "err.vault_locked": "金庫がロックされています",
    "err.vault_exists": "金庫が既に存在します。ロック解除をお試しください",
    "err.password_too_short": "パスワードは 8 文字以上必要です",
    "err.wrong_password": "パスワードが違います",
    "err.wrong_old_password": "現在のパスワードが違います",
    "err.only_totp": "現時点では TOTP のみ対応しています",
    "err.account_not_found": "アカウントが見つかりません",
    "err.name_required": "名前を入力してください",
    "err.invalid_algorithm": "アルゴリズムは SHA1 / SHA256 / SHA512 のいずれかです",
    "err.invalid_digits": "桁数は 6 から 10 の間で指定してください",
    "err.invalid_period": "周期は 5 から 300 秒の間で指定してください",
    "err.invalid_secret": "キーは正しい Base32 ではありません",
    "err.uri_invalid": "otpauth:// URI の形式が不正です",
    "err.kdf_failed": "鍵の導出に失敗しました",
    "err.seal_failed": "暗号化に失敗しました",
    "err.write_failed": "書き込みに失敗しました",
    "err.vault_read_failed": "金庫の読み取りに失敗しました",
    "err.totp_failed": "TOTP の計算に失敗しました",
    "err.import_invalid": "バックアップファイルが破損しているか不正です",
    "err.reorder_invalid": "並び順データが不正です",
    "err.qr_read_failed": "画像ファイルを読み取れません",
    "err.qr_format_unsupported": "対応していない画像形式です(PNG / JPG / WebP / GIF / BMP)",
    "err.qr_not_found": "画像内に QR コードが見つかりません",
    "err.qr_decode_failed": "QR コードのデコードに失敗しました",
  },
};

let currentLocale = detectInitial();
const listeners = new Set();

function detectInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch (_) {}

  const nav = (navigator.language || navigator.userLanguage || "").toLowerCase();
  if (nav.startsWith("zh")) return "zh-TW";
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

function getLocale() {
  return currentLocale;
}

function setLocale(locale) {
  if (!SUPPORTED.includes(locale) || locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch (_) {}
  document.documentElement.lang = locale;
  applyDom();
  for (const fn of listeners) fn(locale);
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function t(key, vars) {
  const dict = dictionaries[currentLocale] || dictionaries[DEFAULT_LOCALE];
  let s = dict[key];
  if (s === undefined) s = dictionaries[DEFAULT_LOCALE][key];
  if (s === undefined) s = key; // fallback:顯示 key 以利除錯
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v ?? ""));
    }
  }
  return s;
}

/// 把錯誤(可能是 string key、Error、或任意值)轉成已翻譯訊息。
function tError(err, vars) {
  const raw = typeof err === "string" ? err : (err?.message || String(err));
  // Rust 命令拋出的 key 形如 "err.xxx";其他訊息原樣顯示
  if (raw.startsWith("err.")) return t(raw, vars);
  return raw;
}

/// 把 DOM 上有 data-i18n / data-i18n-attr 的元素套用翻譯
function applyDom(root = document) {
  // 文字內容
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
  // 屬性翻譯,例:data-i18n-attr="title:top.add,aria-label:top.add"
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    const spec = el.getAttribute("data-i18n-attr");
    for (const part of spec.split(",")) {
      const [attr, key] = part.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
  // placeholder
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  }
  document.documentElement.lang = currentLocale;
}

function listLocales() {
  return SUPPORTED.map((code) => ({
    code,
    label: dictionaries[code]["lang.name"],
  }));
}

window.i18n = { t, tError, getLocale, setLocale, onChange, applyDom, listLocales };

})();
