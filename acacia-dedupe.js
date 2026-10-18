/* acacia-dedupe.js — stops duplicate bank accounts and stock items.
 *
 * Why duplicates happen: banks and stock items are stored as lists of records
 * without a stable id. The cloud sync identifies such records by a fingerprint
 * of their content, so one quantity or balance change makes the synced copy look
 * like a brand-new record and both copies are kept.
 *
 * What this does:
 *   1. Gives every bank / stock record a stable id (same on every device).
 *   2. Removes duplicates on every save of "banks" and "inventory_*"
 *      (same bank = name + account number + currency;
 *       same stock item = SKU, or name when there is no SKU, per warehouse).
 *   3. Re-checks when the tab regains focus and every 30 seconds, which also
 *      covers data that arrives from the cloud.
 * Removed records are kept in localStorage under "__acxDedupeLog" (last 100).
 */
(function () {
  "use strict";
  if (window.__acxDedupe) return;
  window.__acxDedupe = true;

  var LOG = "__acxDedupeLog";
  var SP = Storage.prototype;
  var prevSet = SP.setItem;
  var busy = false;
  var lastToast = 0;

  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase();
  }
  function hash(s) {
    var h = 5381;
    s = String(s);
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function isStore(k) {
    return k === "banks" || (typeof k === "string" && k.indexOf("inventory_") === 0 && k.length > 10);
  }
  function bankKey(b) {
    var n = norm(b.name);
    return n ? n + "|" + norm(b.accountNumber) + "|" + norm(b.currency || "KES") : "";
  }
  function stockKey(it) {
    return norm(it.sku) || norm(it.name);
  }
  function histLen(x) {
    return Array.isArray(x.history) ? x.history.length : 0;
  }
  // true when "b" should replace "a" as the surviving record
  function better(isBank, a, b) {
    if (isBank) {
      if (a.system && !b.system) return false;
      if (b.system && !a.system) return true;
      return true; // later copy wins
    }
    var ha = histLen(a), hb = histLen(b);
    if (ha !== hb) return hb > ha; // the copy with more recorded movements is the newer one
    return true;
  }

  function process(key, text) {
    var arr;
    try { arr = JSON.parse(text); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    var isBank = key === "banks";
    var wh = isBank ? "" : key.slice(10);
    var out = [], seen = Object.create(null), removed = [], changed = false;

    arr.forEach(function (r) {
      if (!r || typeof r !== "object" || Array.isArray(r)) { out.push(r); return; }
      var k = isBank ? bankKey(r) : stockKey(r);
      if (!k) { out.push(r); return; }
      if (k in seen) {
        var idx = seen[k];
        if (better(isBank, out[idx], r)) { removed.push(out[idx]); out[idx] = r; }
        else removed.push(r);
        changed = true;
      } else {
        seen[k] = out.length;
        out.push(r);
      }
    });

    out.forEach(function (r) {
      if (!r || typeof r !== "object" || Array.isArray(r) || r.id) return;
      var k = isBank ? bankKey(r) : stockKey(r);
      if (!k) return;
      r.id = (isBank ? "bk_" : "st_") + hash(isBank ? k : wh + "|" + k);
      changed = true;
    });

    if (!changed) return null;
    return { text: JSON.stringify(out), removed: removed, list: out };
  }

  function log(key, removed) {
    if (!removed.length) return;
    try {
      var cur = JSON.parse(localStorage.getItem(LOG) || "[]") || [];
      removed.forEach(function (r) {
        cur.push({ at: new Date().toISOString(), key: key, record: r });
      });
      cur = cur.slice(-100);
      prevSet.call(localStorage, LOG, JSON.stringify(cur));
    } catch (e) {}
  }

  function toast(msg) {
    var now = Date.now();
    if (now - lastToast < 5000) return;
    lastToast = now;
    try {
      var d = document.createElement("div");
      d.textContent = msg;
      d.style.cssText = "position:fixed;left:16px;bottom:16px;max-width:360px;background:#92400e;color:#fff;padding:10px 14px;border-radius:8px;z-index:2147483647;font:13px/1.4 sans-serif";
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 6000);
    } catch (e) {}
  }

  function syncMemory(key, list) {
    if (key !== "banks") return;
    try {
      if (typeof banks !== "undefined" && Array.isArray(banks)) { // eslint-disable-line no-undef
        banks.length = 0; // eslint-disable-line no-undef
        list.forEach(function (r) { banks.push(r); }); // eslint-disable-line no-undef
      }
    } catch (e) {}
  }

  // 1) every save of banks / inventory_* goes through the duplicate check
  SP.setItem = function (k, v) {
    var res = null;
    if (!busy && this === window.localStorage && isStore(k) && typeof v === "string") {
      try { res = process(k, v); } catch (e) { res = null; }
      if (res) {
        v = res.text;
        log(k, res.removed);
        if (res.removed.length)
          toast(k === "banks" ? "Duplicate bank account blocked — only one copy was kept."
                              : "Duplicate stock item blocked — only one copy was kept.");
      }
    }
    var ret = prevSet.call(this, k, v);
    if (res) syncMemory(k, res.list);
    return ret;
  };

  // 2) periodic / on-focus pass (catches data written by the cloud sync)
  function rerender() {
    ["renderBankTable", "updateBankDropdowns", "renderInventorySummary", "renderInventoryTable"].forEach(function (f) {
      try { if (typeof window[f] === "function") window[f](); } catch (e) {}
    });
  }
  function pass() {
    var fixed = 0;
    try {
      var keys = ["banks"];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && isStore(k) && k !== "banks") keys.push(k);
      }
      keys.forEach(function (k) {
        var raw = localStorage.getItem(k);
        if (!raw) return;
        var res = process(k, raw);
        if (!res) return;
        busy = true;
        try { log(k, res.removed); localStorage.setItem(k, res.text); } finally { busy = false; }
        syncMemory(k, res.list);
        if (res.removed.length) fixed++;
      });
    } catch (e) { busy = false; }
    if (fixed) rerender();
    return fixed;
  }

  window.acxDedupeNow = pass;
  document.addEventListener("DOMContentLoaded", function () { setTimeout(pass, 3000); });
  window.addEventListener("focus", function () { setTimeout(pass, 500); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(pass, 500); });
  setInterval(pass, 30000);
})();
