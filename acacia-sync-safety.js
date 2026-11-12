/* acacia-sync-safety.js - stops two things that make Books and the cloud disagree.
 *
 * 1) Several Books tabs open at once: an old tab still holds old stock and can upload it over a newer import.
 *    Tabs now find each other (BroadcastChannel, nothing is stored) and a yellow bar tells you when Books is
 *    open in another tab.
 * 2) Importing stock on top of out-of-date data: before an inventory import runs, Books first downloads the latest cloud
 *    copy (so the import is merged with current stock, not with a stale copy). If Books is open in another tab you
 *    are asked before the import starts.
 *
 * Load LAST in index.html (after acacia-live-sync.js). */
(function (W) {
  "use strict";
  if (W.__acxSyncSafety) return;
  W.__acxSyncSafety = true;

  /* ---------- 1. other tabs ---------- */
  var ID = Math.random().toString(36).slice(2) + Date.now().toString(36), peers = {}, bc = null, bar = null, closedAt = 0;
  var BEAT = 3000, GONE = 9000;
  function live() { var t = Date.now(), n = 0; Object.keys(peers).forEach(function (k) { if (t - peers[k] > GONE) delete peers[k]; else n++; }); return n; }
  function say(type) { try { bc && bc.postMessage({ t: type, id: ID }); } catch (e) {} }
  function draw() {
    var n = live();
    if (!n) { if (bar) { bar.remove(); bar = null; } return; }
    if (closedAt && Date.now() - closedAt < 60000) return;                    /* dismissed: stay quiet for a minute */
    if (!bar) {
      bar = document.createElement("div");
      bar.style.cssText = "position:fixed;left:12px;bottom:12px;max-width:360px;z-index:2147483000;background:#fef3c7;color:#78350f;border:1px solid #f59e0b;border-radius:8px;padding:10px 34px 10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2)";
      bar.innerHTML = '<span id="acxTabMsg"></span><button type="button" aria-label="Dismiss" style="position:absolute;right:8px;top:6px;border:0;background:none;font-size:18px;line-height:1;color:#78350f;cursor:pointer">&times;</button>';
      bar.querySelector("button").onclick = function () { closedAt = Date.now(); bar.remove(); bar = null; };
      (document.body || document.documentElement).appendChild(bar);
    }
    bar.querySelector("#acxTabMsg").innerHTML = "<b>Books is open in " + n + " other tab" + (n === 1 ? "" : "s") + ".</b> An old tab can overwrite newer stock. Close the extra tab" + (n === 1 ? "" : "s") + " before importing.";
  }
  try {
    bc = new BroadcastChannel("acx-books-tabs");
    bc.onmessage = function (e) {
      var d = e && e.data; if (!d || d.id === ID) return;
      if (d.t === "bye") delete peers[d.id]; else { var fresh = !peers[d.id]; peers[d.id] = Date.now(); if (d.t === "hello" && fresh) say("here"); }
      draw();
    };
    say("hello");
    setInterval(function () { say("beat"); draw(); }, BEAT);
    W.addEventListener("pagehide", function () { say("bye"); });
  } catch (e) { /* very old browser: no tab check, the import safety below still works */ }
  W.acxOtherTabs = live;

  /* ---------- 2. fresh data before an inventory import ---------- */
  function timeout(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function wrapImport() {
    var orig = W.importInventoryExcel;
    if (typeof orig !== "function") return false;
    if (orig.__syncSafe) return true;
    var wrapped = function (ev) {
      var self = this, args = arguments, input = ev && ev.target;
      if (live() && !W.confirm("Books is open in another tab.\n\nAn old tab can overwrite this import with older stock. Close the other tab first.\n\nOK = import anyway, Cancel = stop.")) {
        try { if (input) input.value = ""; } catch (e) {}
        return;
      }
      var cs = W.__companySync, pull = Promise.resolve();
      if (cs && typeof cs.pullCompany === "function" && navigator.onLine) pull = Promise.race([Promise.resolve().then(function () { return cs.pullCompany(); }), timeout(8000)]).catch(function () {});
      return pull.then(function () { return orig.apply(self, args); });
    };
    wrapped.__syncSafe = true;
    if (orig.__stockFix) wrapped.__stockFix = true;           /* keep the stock-fix wrapper from wrapping it a second time */
    W.importInventoryExcel = wrapped;
    return true;
  }
  var tries = 0;
  (function boot() { if (!wrapImport() && ++tries < 60) setTimeout(boot, 500); })();
})(window);
