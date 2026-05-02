"use strict";

// 必須在所有其他 script 之前載入,確保載入期錯誤可被捕捉
(function () {
  function show(prefix, msg, extra) {
    var box = document.createElement("pre");
    box.style.cssText =
      "position:fixed;inset:0;margin:20px;padding:16px;background:#1a1a1a;color:#ff6b6b;" +
      "font:12px/1.5 ui-monospace,Menlo,monospace;z-index:9999;overflow:auto;border-radius:8px;" +
      "white-space:pre-wrap;word-break:break-word;";
    box.textContent = prefix + ":\n" + msg + (extra ? "\n\n" + extra : "");
    if (document.body) {
      document.body.appendChild(box);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        document.body.appendChild(box);
      });
    }
  }

  window.addEventListener("error", function (e) {
    show(
      "JavaScript 錯誤",
      e.message + "\n  at " + (e.filename || "?") + ":" + (e.lineno || "?") + ":" + (e.colno || "?"),
      e.error && e.error.stack
    );
  });

  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    show("Unhandled rejection", (r && r.message) || String(r), r && r.stack);
  });
})();
