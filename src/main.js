"use strict";

// 包進 IIFE 隔離 scope,避免 const 與 window 既有屬性衝突(WebKit 嚴格模式)
(function () {

const { invoke } = window.__TAURI__.core;
const clipboard = window.__TAURI__.clipboardManager;
const dialog = window.__TAURI__.dialog;
const { t, tError } = window.i18n;

// ---------- DOM 引用 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const lockScreen = $("#lock-screen");
const mainScreen = $("#main-screen");
const lockTitle = $("#lock-title");
const lockSubtitle = $("#lock-subtitle");
const lockSubmit = $("#lock-submit");
const passwordInput = $("#password-input");
const passwordConfirm = $("#password-confirm");
const lockForm = $("#lock-form");
const lockError = $("#lock-error");
const accountList = $("#account-list");
const emptyState = $("#empty-state");
const searchEmpty = $("#search-empty");
const searchEmptyText = $("#search-empty-text");
const vaultOverview = $("#vault-overview");
const searchBar = $("#search-bar");
const searchInput = $("#search-input");
const modalAdd = $("#modal-add");
const modalError = $("#modal-error");
const modalEdit = $("#modal-edit");
const editName = $("#edit-name");
const editIssuer = $("#edit-issuer");
const editError = $("#edit-error");
const settingsScreen = $("#settings-screen");
const modalChangepw = $("#modal-changepw");
const cpOld = $("#cp-old");
const cpNew = $("#cp-new");
const cpConfirm = $("#cp-confirm");
const changepwError = $("#changepw-error");
const toast = $("#toast");

// ---------- 狀態 ----------
let mode = "unlock"; // "init" | "unlock"
let accounts = [];   // [{id,name,issuer,digits,period,...}]
let codes = new Map(); // id → {code, period, remaining}
let tickHandle = null;
let lastCodeFetch = 0;
let searchQuery = "";
let editingId = null;
let revealedIds = new Set(); // session-only:被點擊揭露的卡片 id

// ---------- 偏好設定(localStorage) ----------
const APP_VERSION = "0.1.0";
const SETTINGS_KEY = "auth2fa.settings";
const defaultSettings = {
  theme: "auto",          // "auto" | "light" | "dark"
  autolockSec: 300,       // 0=off
  hideCodes: false,
};
let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch (_) {
    return { ...defaultSettings };
  }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
}
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
}

// ---------- 工具 ----------
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toast.style.animation = "none";
  void toast.offsetWidth;
  toast.style.animation = "";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add("hidden"), 1800);
}

function setError(el, msg) {
  el.textContent = msg || "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function formatCode(s) {
  const half = Math.ceil(s.length / 2);
  return s.slice(0, half) + " " + s.slice(half);
}

function codeWindowLabel() {
  let minRemaining = null;
  for (const c of codes.values()) {
    if (typeof c.remaining !== "number") continue;
    minRemaining = minRemaining === null ? c.remaining : Math.min(minRemaining, c.remaining);
  }
  if (minRemaining === null) return "—";
  return t("overview.next_value", { seconds: minRemaining });
}

function renderVaultOverview() {
  if (!vaultOverview) return;
  const hiddenMode = settings.hideCodes ? t("overview.hidden_on") : t("overview.hidden_off");
  vaultOverview.innerHTML = `
    <div class="overview-item overview-item-strong">
      <span class="overview-label">${escapeHtml(t("overview.accounts_label"))}</span>
      <strong>${escapeHtml(t("overview.accounts_value", { count: accounts.length }))}</strong>
    </div>
    <div class="overview-item">
      <span class="overview-label">${escapeHtml(t("overview.next_label"))}</span>
      <strong>${escapeHtml(codeWindowLabel())}</strong>
    </div>
    <div class="overview-item">
      <span class="overview-label">${escapeHtml(t("overview.privacy_label"))}</span>
      <strong>${escapeHtml(hiddenMode)}</strong>
    </div>`;
}

// 把字串雜湊成 0..360 的色相,讓每個 issuer 有穩定且不同的代表色
function hashHue(str) {
  let h = 0;
  const s = String(str || "?");
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return ((h % 360) + 360) % 360;
}

function avatarStyle(issuer, name) {
  const hue = hashHue(issuer || name || "");
  const c1 = `hsl(${hue}, 70%, 55%)`;
  const c2 = `hsl(${(hue + 35) % 360}, 70%, 45%)`;
  return `background: linear-gradient(135deg, ${c1} 0%, ${c2} 100%);`;
}

function avatarLetter(issuer, name) {
  const src = (issuer || name || "?").trim();
  for (const ch of src) {
    if (/\S/.test(ch)) return ch.toUpperCase();
  }
  return "?";
}

// ---------- 啟動 ----------
async function refreshStatus() {
  const status = await invoke("vault_status");
  if (status.unlocked) {
    showMain();
  } else {
    showLock(status.exists ? "unlock" : "init");
  }
}

function showLock(m) {
  mode = m;
  mainScreen.classList.add("hidden");
  lockScreen.classList.remove("hidden");
  stopTicker();
  applyLockTexts();
  if (m === "init") {
    passwordConfirm.classList.remove("hidden");
    passwordInput.autocomplete = "new-password";
  } else {
    passwordConfirm.classList.add("hidden");
    passwordInput.autocomplete = "current-password";
  }
  passwordInput.value = "";
  passwordConfirm.value = "";
  setError(lockError, "");
  setTimeout(() => passwordInput.focus(), 50);
}

function applyLockTexts() {
  if (mode === "init") {
    lockTitle.textContent = t("lock.title.init");
    lockSubtitle.textContent = t("lock.subtitle.init");
    lockSubmit.textContent = t("lock.button.init");
  } else {
    lockTitle.textContent = t("lock.title.unlock");
    lockSubtitle.textContent = t("lock.subtitle.unlock");
    lockSubmit.textContent = t("lock.button.unlock");
  }
}

async function showMain() {
  lockScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
  revealedIds.clear();
  await loadAccounts();
  startTicker();
  resetIdleTimer();
}

// ---------- 鎖定表單 ----------
lockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError(lockError, "");
  const pw = passwordInput.value;
  if (!pw) {
    setError(lockError, t("lock.error.password_required"));
    return;
  }
  try {
    if (mode === "init") {
      if (pw.length < 8) {
        setError(lockError, t("err.password_too_short"));
        return;
      }
      if (pw !== passwordConfirm.value) {
        setError(lockError, t("lock.error.password_mismatch"));
        return;
      }
      lockSubmit.disabled = true;
      lockSubmit.textContent = t("lock.button.creating");
      await invoke("vault_init", { password: pw });
    } else {
      lockSubmit.disabled = true;
      lockSubmit.textContent = t("lock.button.unlocking");
      await invoke("vault_unlock", { password: pw });
    }
    await showMain();
  } catch (err) {
    setError(lockError, tError(err));
  } finally {
    lockSubmit.disabled = false;
    applyLockTexts();
  }
});

// ---------- 帳戶列表 ----------
async function loadAccounts() {
  try {
    accounts = await invoke("list_accounts");
    await refreshCodes(true);
    renderVaultOverview();
    renderList();
  } catch (err) {
    showToast(t("toast.read_failed", { err: tError(err) }));
  }
}

async function refreshCodes(force = false) {
  try {
    const list = await invoke("generate_codes");
    codes = new Map(list.map((c) => [c.id, c]));
    lastCodeFetch = Date.now();
  } catch (err) {
    if (force) showToast(t("toast.codes_failed", { err: tError(err) }));
  }
}

function filteredAccounts() {
  if (!searchQuery) return accounts;
  const q = searchQuery.toLowerCase();
  return accounts.filter((a) => {
    const name = (a.name || "").toLowerCase();
    const issuer = (a.issuer || "").toLowerCase();
    return name.includes(q) || issuer.includes(q);
  });
}

function renderList(animateCards = true) {
  renderVaultOverview();
  if (accounts.length === 0) {
    accountList.classList.add("hidden");
    emptyState.classList.remove("hidden");
    searchEmpty.classList.add("hidden");
    return;
  }

  const visible = filteredAccounts();
  if (visible.length === 0) {
    accountList.classList.add("hidden");
    emptyState.classList.add("hidden");
    searchEmpty.classList.remove("hidden");
    searchEmptyText.textContent = t("search.no_results", { query: searchQuery });
    return;
  }

  accountList.classList.remove("hidden");
  accountList.classList.toggle("no-card-animation", !animateCards);
  emptyState.classList.add("hidden");
  searchEmpty.classList.add("hidden");

  const prevCodes = new Map();
  $$(".account-card").forEach((el) => prevCodes.set(el.dataset.id, el.dataset.lastCode || ""));

  const placeholder = t("card.placeholder_code");
  const hiddenStr = t("card.hidden_code");
  const titleCopy = t("card.copy");
  const titleDelete = t("card.delete");
  const titleEdit = t("card.edit");
  const dragEnabled = !searchQuery; // 搜尋中暫時不允許拖曳避免亂排

  accountList.innerHTML = visible
    .map((a, i) => {
      const c = codes.get(a.id);
      const rawCode = c?.code || "";
      const isHidden = settings.hideCodes && !revealedIds.has(a.id);
      const code = isHidden ? hiddenStr : (c ? formatCode(rawCode) : placeholder);
      const remaining = c ? c.remaining : 30;
      const period = c ? c.period : a.period;
      const expiring = remaining <= 5;
      const r = 16;
      const circumference = 2 * Math.PI * r;
      const offset = circumference * (1 - remaining / period);
      const changed = !isHidden && prevCodes.has(a.id) && prevCodes.get(a.id) !== rawCode && prevCodes.get(a.id);

      return `
        <li class="account-card"
            data-id="${escapeHtml(a.id)}"
            data-last-code="${escapeHtml(rawCode)}"
            style="--i:${i}"
            ${dragEnabled ? 'draggable="true"' : ""}>
          <div class="account-avatar" style="${avatarStyle(a.issuer, a.name)}" aria-hidden="true">
            ${escapeHtml(avatarLetter(a.issuer, a.name))}
          </div>
          <div class="account-info">
            ${a.issuer ? `<div class="account-issuer">${escapeHtml(a.issuer)}</div>` : ""}
            <div class="account-name">${escapeHtml(a.name)}</div>
            <div class="account-meta">
              <span>${escapeHtml(a.algorithm || "TOTP")}</span>
              <span>${escapeHtml(String(a.digits))}</span>
              <span>${escapeHtml(String(a.period))}s</span>
            </div>
            <div class="account-code ${expiring && !isHidden ? "expiring" : ""} ${changed ? "changed" : ""} ${isHidden ? "hidden-code" : ""}">${code}</div>
          </div>
          <div class="countdown ${expiring && !isHidden ? "expiring" : ""}">
            <svg viewBox="0 0 38 38">
              <circle class="bg" cx="19" cy="19" r="${r}"/>
              <circle class="fg" cx="19" cy="19" r="${r}"
                      stroke-dasharray="${circumference}"
                      stroke-dashoffset="${offset}"/>
            </svg>
            <div class="countdown-text">${remaining}</div>
          </div>
          <div class="account-menu">
            <button class="icon-btn" data-act="copy" title="${escapeHtml(titleCopy)}" aria-label="${escapeHtml(titleCopy)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button class="icon-btn" data-act="edit" title="${escapeHtml(titleEdit)}" aria-label="${escapeHtml(titleEdit)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
              </svg>
            </button>
            <button class="icon-btn danger" data-act="delete" title="${escapeHtml(titleDelete)}" aria-label="${escapeHtml(titleDelete)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>
          </div>
        </li>`;
    })
    .join("");
}

accountList.addEventListener("click", async (e) => {
  const card = e.target.closest(".account-card");
  if (!card) return;
  const id = card.dataset.id;
  const btn = e.target.closest("button[data-act]");
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return;

  if (btn?.dataset.act === "delete") {
    e.stopPropagation();
    const ok = await dialog.ask(t("dialog.delete.body", { name: acc.name }), {
      title: t("dialog.delete.title"),
      kind: "warning",
    });
    if (!ok) return;
    try {
      await invoke("remove_account", { id });
      await loadAccounts();
      showToast(t("toast.deleted"));
    } catch (err) {
      showToast(t("toast.delete_failed", { err: tError(err) }));
    }
    return;
  }

  if (btn?.dataset.act === "edit") {
    e.stopPropagation();
    openEditModal(acc);
    return;
  }

  // 隱藏模式下:第一次點擊只揭露,不複製
  if (settings.hideCodes && !revealedIds.has(id)) {
    revealedIds.add(id);
    renderList();
    return;
  }

  const code = codes.get(id);
  if (!code) return;
  try {
    await clipboard.writeText(code.code);
    card.classList.remove("copied");
    void card.offsetWidth;
    card.classList.add("copied");
    showToast(t("toast.copied", { code: formatCode(code.code) }));
  } catch (err) {
    showToast(t("toast.copy_failed", { err: tError(err) }));
  }
});

// ---------- 倒數計時 ----------
function startTicker() {
  stopTicker();
  tickHandle = setInterval(tick, 1000);
}
function stopTicker() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

async function tick() {
  let needsRefresh = false;
  for (const a of accounts) {
    const c = codes.get(a.id);
    if (!c) {
      needsRefresh = true;
      break;
    }
    c.remaining = Math.max(0, c.remaining - 1);
    if (c.remaining === 0) needsRefresh = true;
  }
  if (needsRefresh) await refreshCodes();
  renderList(false);
}

// ---------- 頂列 ----------
$("#btn-lock").addEventListener("click", async () => {
  await invoke("vault_lock");
  await refreshStatus();
});

$("#btn-add").addEventListener("click", openAddModal);
$("#btn-add-empty").addEventListener("click", openAddModal);

// ---------- 新增 modal ----------
function openAddModal() {
  setError(modalError, "");
  $("#uri-input").value = "";
  $("#manual-form").reset();
  switchTab("uri");
  modalAdd.classList.remove("hidden");
  setTimeout(() => $("#uri-input").focus(), 50);
}

function closeAddModal() {
  modalAdd.classList.add("hidden");
}

$$(".modal-close").forEach((el) => el.addEventListener("click", closeAddModal));
modalAdd.addEventListener("click", (e) => {
  if (e.target === modalAdd) closeAddModal();
});

$$(".tab-btn").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab))
);

function switchTab(name) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-content").forEach((c) =>
    c.classList.toggle("hidden", c.dataset.tabContent !== name)
  );
  setError(modalError, "");
}

$("#btn-choose-qr").addEventListener("click", async () => {
  setError(modalError, "");
  try {
    const path = await dialog.open({
      multiple: false,
      filters: [
        { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
      ],
    });
    if (!path) return;
    const target = Array.isArray(path) ? path[0] : path;
    const uri = await invoke("decode_qr_from_path", { path: target });
    $("#uri-input").value = uri;
    setError(modalError, "");
    showToast(t("modal.uri.image_decoded"));
  } catch (err) {
    setError(modalError, tError(err));
  }
});

$("#btn-save").addEventListener("click", async () => {
  setError(modalError, "");
  const activeTab = $(".tab-btn.active")?.dataset.tab;
  try {
    let view;
    if (activeTab === "uri") {
      const uri = $("#uri-input").value.trim();
      if (!uri) {
        setError(modalError, t("modal.error.uri_required"));
        return;
      }
      view = await invoke("add_account_uri", { uri });
    } else {
      const payload = {
        name: $("#m-name").value.trim(),
        issuer: $("#m-issuer").value.trim() || null,
        secret: $("#m-secret").value.trim(),
        algorithm: $("#m-algorithm").value,
        digits: parseInt($("#m-digits").value, 10),
        period: parseInt($("#m-period").value, 10),
      };
      if (!payload.name || !payload.secret) {
        setError(modalError, t("modal.error.fields_required"));
        return;
      }
      view = await invoke("add_account_manual", { payload });
    }
    closeAddModal();
    await loadAccounts();
    showToast(t("toast.added", { name: view.name }));
  } catch (err) {
    setError(modalError, tError(err));
  }
});

// ---------- 全域鍵盤 ----------
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!modalAdd.classList.contains("hidden")) { closeAddModal(); return; }
  if (!modalEdit.classList.contains("hidden")) { closeEditModal(); return; }
  if (!modalChangepw.classList.contains("hidden")) { closeChangepw(); return; }
  if (lockLangOpen) { closeLockLangMenu(); return; }
  if (!langMenu.classList.contains("hidden")) { closeLangMenu(); return; }
  if (!settingsScreen.classList.contains("hidden")) { closeSettings(); return; }
});

// ---------- 語言切換器 ----------
const langBtn = $("#btn-lang");
const langMenu = $("#lang-menu");
const lockLangRow = $("#lock-lang-row");
let lockLangOpen = false;

function localeButtonHtml(locale, cur, variant = "menu") {
  const active = locale.code === cur;
  const activeClass = active ? " active" : "";
  const role = variant === "settings" ? "radio" : variant === "menu" ? "menuitem" : "option";
  const pressed = variant === "settings"
    ? ` aria-checked="${active ? "true" : "false"}"`
    : variant === "lock"
      ? ` aria-selected="${active ? "true" : "false"}"`
      : "";
  const tabIndex = variant === "settings" && !active ? ` tabindex="-1"` : "";
  const checkIcon = `
    <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;

  return `<button type="button" role="${role}" data-lang="${locale.code}" class="language-option language-option-${variant}${activeClass}"${pressed}${tabIndex}>
    <span class="lang-name">${escapeHtml(locale.label)}</span>
    <span class="lang-code">${escapeHtml(locale.tag)}</span>
    ${checkIcon}
  </button>`;
}

function buildLangMenus() {
  const locales = window.i18n.listLocales();
  const cur = window.i18n.getLocale();
  const currentLocale = locales.find((l) => l.code === cur) || locales[0];

  // 頂列下拉
  langMenu.innerHTML = locales.map((l) => localeButtonHtml(l, cur, "menu")).join("");

  // 鎖定畫面只保留一個入口,避免語系清單壓過解鎖主流程
  lockLangRow.innerHTML = `
    <button
      id="btn-lock-lang-toggle"
      class="lock-lang-toggle"
      type="button"
      aria-haspopup="listbox"
      aria-expanded="${lockLangOpen ? "true" : "false"}"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span>${escapeHtml(t("top.language"))}</span>
      <strong>${escapeHtml(currentLocale.label)}</strong>
      <span class="lang-code">${escapeHtml(currentLocale.tag)}</span>
    </button>
    <div class="lock-lang-panel ${lockLangOpen ? "" : "hidden"}" role="listbox">
      ${locales.map((l) => localeButtonHtml(l, cur, "lock")).join("")}
    </div>`;
}

function openLangMenu() {
  langMenu.classList.remove("hidden");
  langBtn.setAttribute("aria-expanded", "true");
}
function closeLangMenu() {
  langMenu.classList.add("hidden");
  langBtn.setAttribute("aria-expanded", "false");
}
function closeLockLangMenu() {
  lockLangOpen = false;
  buildLangMenus();
}

langBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (langMenu.classList.contains("hidden")) openLangMenu();
  else closeLangMenu();
});

document.addEventListener("click", (e) => {
  if (!langMenu.classList.contains("hidden") && !e.target.closest(".lang-switcher")) {
    closeLangMenu();
  }
  if (lockLangOpen && !e.target.closest("#lock-lang-row")) {
    closeLockLangMenu();
  }
});

// 透過事件委派處理各處的語言按鈕
function handleLangPick(e) {
  const btn = e.target.closest("button[data-lang]");
  if (!btn) return;
  window.i18n.setLocale(btn.dataset.lang);
  closeLangMenu();
  closeLockLangMenu();
}
langMenu.addEventListener("click", handleLangPick);
lockLangRow.addEventListener("click", (e) => {
  const toggle = e.target.closest("#btn-lock-lang-toggle");
  if (toggle) {
    e.stopPropagation();
    lockLangOpen = !lockLangOpen;
    buildLangMenus();
    return;
  }
  handleLangPick(e);
});

// 語言變動時:重套 DOM、重建選單、重繪鎖定畫面文字、重繪列表(以套用 card.copy 等)
window.i18n.onChange(() => {
  window.i18n.applyDom();
  buildLangMenus();
  buildSettingsLangGrid();
  applySettingsValues();
  applyAboutVersion();
  renderVaultOverview();
  if (!lockScreen.classList.contains("hidden")) applyLockTexts();
  if (!mainScreen.classList.contains("hidden")) renderList();
});

// ---------- 搜尋列 ----------
const btnSearchToggle = $("#btn-search-toggle");
const btnSearchClear = $("#btn-search-clear");

btnSearchToggle.addEventListener("click", () => {
  if (searchBar.classList.contains("hidden")) {
    searchBar.classList.remove("hidden");
    setTimeout(() => searchInput.focus(), 30);
  } else {
    searchInput.value = "";
    searchQuery = "";
    searchBar.classList.add("hidden");
    renderList();
  }
});
btnSearchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  renderList();
  searchInput.focus();
});
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  renderList();
});

// ---------- 編輯 modal ----------
function openEditModal(acc) {
  editingId = acc.id;
  editName.value = acc.name || "";
  editIssuer.value = acc.issuer || "";
  setError(editError, "");
  modalEdit.classList.remove("hidden");
  setTimeout(() => editName.focus(), 30);
}
function closeEditModal() {
  modalEdit.classList.add("hidden");
  editingId = null;
}
$$(".modal-edit-close").forEach((el) => el.addEventListener("click", closeEditModal));
modalEdit.addEventListener("click", (e) => { if (e.target === modalEdit) closeEditModal(); });
$("#btn-edit-save").addEventListener("click", async () => {
  if (!editingId) return;
  setError(editError, "");
  try {
    const view = await invoke("rename_account", {
      id: editingId,
      name: editName.value,
      issuer: editIssuer.value || null,
    });
    closeEditModal();
    await loadAccounts();
    showToast(t("toast.updated", { name: view.name }));
  } catch (err) {
    setError(editError, tError(err));
  }
});

// ---------- 設定 modal ----------
const btnSettings = $("#btn-settings");
const settingTheme = $("#setting-theme");
const settingLanguageGrid = $("#setting-language-grid");
const settingAutolock = $("#setting-autolock");
const settingHideCodes = $("#setting-hide-codes");

function buildSettingsLangGrid() {
  const cur = window.i18n.getLocale();
  settingLanguageGrid.innerHTML = window.i18n
    .listLocales()
    .map((l) => localeButtonHtml(l, cur, "settings"))
    .join("");
}
function applySettingsValues() {
  settingTheme.value = settings.theme;
  settingAutolock.value = String(settings.autolockSec);
  settingHideCodes.checked = !!settings.hideCodes;
}
function applyAboutVersion() {
  $("#settings-version").textContent = t("settings.about.version", { version: APP_VERSION });
}

function openSettings() {
  buildSettingsLangGrid();
  applySettingsValues();
  applyAboutVersion();
  mainScreen.classList.add("hidden");
  settingsScreen.classList.remove("hidden");
  // 進入設定頁也視為使用中
  resetIdleTimer();
}
function closeSettings() {
  settingsScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
  resetIdleTimer();
}
btnSettings.addEventListener("click", openSettings);
$("#btn-settings-back").addEventListener("click", closeSettings);

settingTheme.addEventListener("change", () => {
  settings.theme = settingTheme.value;
  saveSettings();
  applyTheme();
});
settingLanguageGrid.addEventListener("click", handleLangPick);
settingLanguageGrid.addEventListener("keydown", (e) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", " ", "Enter"];
  if (!keys.includes(e.key)) return;

  const options = Array.from(settingLanguageGrid.querySelectorAll("button[data-lang]"));
  if (options.length === 0) return;
  e.preventDefault();

  if (e.key === " " || e.key === "Enter") {
    document.activeElement?.click();
    return;
  }

  const currentIndex = Math.max(0, options.indexOf(document.activeElement));
  const columnCount = 2;
  let nextIndex = currentIndex;
  if (e.key === "Home") nextIndex = 0;
  else if (e.key === "End") nextIndex = options.length - 1;
  else if (e.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
  else if (e.key === "ArrowRight") nextIndex = Math.min(options.length - 1, currentIndex + 1);
  else if (e.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - columnCount);
  else if (e.key === "ArrowDown") nextIndex = Math.min(options.length - 1, currentIndex + columnCount);

  const nextLocale = options[nextIndex]?.dataset.lang;
  if (!nextLocale) return;
  window.i18n.setLocale(nextLocale);
  setTimeout(() => settingLanguageGrid.querySelector(`button[data-lang="${nextLocale}"]`)?.focus(), 0);
});
settingAutolock.addEventListener("change", () => {
  settings.autolockSec = parseInt(settingAutolock.value, 10) || 0;
  saveSettings();
  resetIdleTimer();
});
settingHideCodes.addEventListener("change", () => {
  settings.hideCodes = settingHideCodes.checked;
  saveSettings();
  revealedIds.clear();
  renderVaultOverview();
  renderList();
});

// ---------- 變更主密碼 modal ----------
$("#btn-change-password").addEventListener("click", () => {
  closeSettings();
  cpOld.value = ""; cpNew.value = ""; cpConfirm.value = "";
  setError(changepwError, "");
  modalChangepw.classList.remove("hidden");
  setTimeout(() => cpOld.focus(), 30);
});
function closeChangepw() { modalChangepw.classList.add("hidden"); }
$$(".modal-changepw-close").forEach((el) => el.addEventListener("click", closeChangepw));
modalChangepw.addEventListener("click", (e) => { if (e.target === modalChangepw) closeChangepw(); });
$("#btn-changepw-submit").addEventListener("click", async () => {
  setError(changepwError, "");
  if (cpNew.value.length < 8) {
    setError(changepwError, t("err.password_too_short"));
    return;
  }
  if (cpNew.value !== cpConfirm.value) {
    setError(changepwError, t("changepw.error.mismatch"));
    return;
  }
  try {
    await invoke("vault_change_password", {
      oldPassword: cpOld.value,
      newPassword: cpNew.value,
    });
    closeChangepw();
    showToast(t("toast.password_changed"));
  } catch (err) {
    setError(changepwError, tError(err));
  }
});

// ---------- 備份 匯出 / 匯入 ----------
$("#btn-export").addEventListener("click", async () => {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await dialog.save({
      defaultPath: `authenticator2fa-${ts}.json`,
      filters: [{ name: "Vault", extensions: ["json"] }],
    });
    if (!path) return;
    await invoke("export_vault_to_path", { path });
    showToast(t("toast.exported"));
  } catch (err) {
    showToast(tError(err));
  }
});

$("#btn-import").addEventListener("click", async () => {
  try {
    const ok = await dialog.ask(t("dialog.import.body"), {
      title: t("dialog.import.title"),
      kind: "warning",
    });
    if (!ok) return;
    const path = await dialog.open({
      multiple: false,
      filters: [{ name: "Vault", extensions: ["json"] }],
    });
    if (!path) return;
    const target = Array.isArray(path) ? path[0] : path;
    await invoke("import_vault_from_path", { path: target });
    closeSettings();
    showToast(t("toast.imported"));
    await refreshStatus(); // 後端強制鎖定 → 顯示鎖定畫面
  } catch (err) {
    showToast(tError(err));
  }
});

// ---------- 自動鎖定 ----------
let idleTimer = null;
function resetIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!settings.autolockSec) return;
  // 鎖定畫面顯示中就不需要計時(已經是鎖定狀態)
  if (lockScreen && !lockScreen.classList.contains("hidden")) return;
  idleTimer = setTimeout(async () => {
    try { await invoke("vault_lock"); } catch (_) {}
    await refreshStatus();
    showToast(t("toast.locked_auto"));
  }, settings.autolockSec * 1000);
}
["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((ev) =>
  document.addEventListener(ev, resetIdleTimer, { passive: true })
);

// ---------- 拖曳重新排序 ----------
let dragSrc = null;
accountList.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".account-card");
  if (!card) return;
  dragSrc = card;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", card.dataset.id);
});
accountList.addEventListener("dragover", (e) => {
  const card = e.target.closest(".account-card");
  if (!card || card === dragSrc) return;
  e.preventDefault();
  $$(".account-card").forEach((c) => c.classList.remove("drop-before", "drop-after"));
  const rect = card.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  card.classList.add(before ? "drop-before" : "drop-after");
});
accountList.addEventListener("dragleave", (e) => {
  const card = e.target.closest(".account-card");
  if (card) card.classList.remove("drop-before", "drop-after");
});
accountList.addEventListener("drop", async (e) => {
  e.preventDefault();
  const target = e.target.closest(".account-card");
  if (!target || !dragSrc || target === dragSrc) {
    cleanupDrag();
    return;
  }
  const rect = target.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;

  // 在 accounts 陣列中重新排序
  const srcId = dragSrc.dataset.id;
  const tgtId = target.dataset.id;
  const newOrder = [...accounts];
  const fromIdx = newOrder.findIndex((a) => a.id === srcId);
  const [moved] = newOrder.splice(fromIdx, 1);
  let toIdx = newOrder.findIndex((a) => a.id === tgtId);
  if (!before) toIdx += 1;
  newOrder.splice(toIdx, 0, moved);

  cleanupDrag();
  // 樂觀更新 UI
  accounts = newOrder;
  renderList();
  try {
    await invoke("reorder_accounts", { ids: newOrder.map((a) => a.id) });
    showToast(t("toast.reordered"));
  } catch (err) {
    showToast(tError(err));
    await loadAccounts(); // 回滾
  }
});
accountList.addEventListener("dragend", cleanupDrag);
function cleanupDrag() {
  $$(".account-card").forEach((c) => c.classList.remove("dragging", "drop-before", "drop-after"));
  dragSrc = null;
}

// ---------- 啟動 ----------
applyTheme();
window.i18n.applyDom();
buildLangMenus();
buildSettingsLangGrid();
applyAboutVersion();

refreshStatus().catch((err) => {
  setError(lockError, t("lock.startup_failed", { err: tError(err) }));
  lockScreen.classList.remove("hidden");
});

})();
