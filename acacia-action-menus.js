/* acacia-action-menus.js - keeps the "Actions" dropdown of Non-Current Assets, Non-Current Liabilities and Equity
 * on screen.
 *
 * Why: the three menus were pinned to the right edge of their button (absolute right-0). When the button sits near the
 * left of the page (narrow window, wrapped toolbar, details panel open) the menu grew LEFT, under the fixed sidebar,
 * and could not be seen or clicked. The menu is now placed from the button's real position on screen:
 *   - it opens straight under the button, right-aligned to it when there is room;
 *   - it never goes under the left sidebar or the right tools rail, and never past the window edge;
 *   - it opens upward when there is no room below, and scrolls inside itself if the window is very short.
 * All three tabs use the same code, so they behave the same. Nothing else about the menus changes
 * (same buttons, same Esc / click-away to close, same wiring in app-2.js / app-3.js).
 * Load LAST in index.html (after acacia-live-sync.js). No SQL. */
(function (W) {
  "use strict";
  if (W.__acxActionMenus) return;
  W.__acxActionMenus = true;

  var PAIRS = [
    ["assetActionsBtn", "assetActionsDropdown"],          /* Non-Current Assets */
    ["liabilityActionsBtn", "liabilityActionsDropdown"],  /* Non-Current Liabilities */
    ["equityActionsBtn", "equityActionsDropdown"]         /* Equity */
  ];
  var GAP = 6, EDGE = 8, Z = 2000;   /* above the sidebar (z-index 1300) */
  var doc = document, wired = {};

  function $(id) { return doc.getElementById(id); }

  /* right edge of the left sidebar when it is actually showing (0 when it is slid off-screen on a phone) */
  function leftLimit() {
    var s = $("sidebar");
    if (!s) return EDGE;
    var cs = W.getComputedStyle(s);
    if (cs.display === "none" || cs.visibility === "hidden") return EDGE;
    var r = s.getBoundingClientRect();
    return r.width > 0 && r.right > 0 ? Math.round(r.right) + EDGE : EDGE;
  }
  /* left edge of the right tools rail when it is showing */
  function rightLimit() {
    var vw = doc.documentElement.clientWidth, s = $("rightSidebar");
    if (s) {
      var cs = W.getComputedStyle(s);
      if (cs.display !== "none" && cs.visibility !== "hidden") {
        var r = s.getBoundingClientRect();
        if (r.width > 0 && r.left < vw && r.right > 0) return Math.round(r.left) - EDGE;
      }
    }
    return vw - EDGE;
  }

  function place(btn, dd) {
    if (!btn || !dd || dd.classList.contains("hidden")) return;
    var st = dd.style;
    st.position = "fixed"; st.right = "auto"; st.bottom = "auto"; st.margin = "0";
    st.zIndex = String(Z); st.overflowY = "auto"; st.maxHeight = "";
    var b = btn.getBoundingClientRect(), w = dd.offsetWidth, h = dd.offsetHeight;
    var vh = W.innerHeight || doc.documentElement.clientHeight;
    var minL = leftLimit(), maxR = rightLimit();
    if (maxR - minL < w) { maxR = Math.max(maxR, minL + w); }   /* very narrow: keep the menu whole, start at the sidebar edge */

    var left = b.right - w;                       /* right-aligned to the button (the original look) */
    if (left < minL) left = Math.max(minL, Math.min(b.left, maxR - w));   /* not enough room on the left: start at the button or the sidebar edge */
    if (left + w > maxR) left = Math.max(minL, maxR - w);

    var top = b.bottom + GAP, room = vh - top - EDGE;
    if (h > room && b.top - GAP - EDGE > room) {  /* more room above: open upward */
      top = Math.max(EDGE, b.top - GAP - h);
      room = b.top - GAP - top;
    }
    st.left = Math.round(left) + "px";
    st.top = Math.round(top) + "px";
    if (h > room) st.maxHeight = Math.max(120, Math.floor(room)) + "px";
  }

  function wire(pair) {
    var btn = $(pair[0]), dd = $(pair[1]);
    if (!btn || !dd || wired[pair[1]]) return;
    wired[pair[1]] = true;
    var go = function () { place(btn, dd); };
    /* the app shows / hides the menu by toggling the "hidden" class - react to that */
    if (W.MutationObserver) new MutationObserver(function () { if (!dd.classList.contains("hidden")) go(); }).observe(dd, { attributes: true, attributeFilter: ["class"] });
    /* One owner for open/close. Equity had TWO click handlers (app-2.js and app-3.js) that both toggled, so it opened and
       shut again in the same click and never showed. This capture handler runs first, toggles once and stops the others. */
    var chev = btn.querySelector("svg");
    btn.addEventListener("click", function (e) {
      e.stopImmediatePropagation(); e.stopPropagation();
      var open = dd.classList.contains("hidden");
      PAIRS.forEach(function (q) { var o = $(q[1]); if (o && o !== dd) { o.classList.add("hidden"); var c = $(q[0]) && $(q[0]).querySelector("svg"); if (c) c.style.transform = ""; } });
      dd.classList.toggle("hidden", !open);
      if (chev) chev.style.transform = open ? "rotate(180deg)" : "";
      if (open) go();
    }, true);
    var close = function () { dd.classList.add("hidden"); if (chev) chev.style.transform = ""; };
    doc.addEventListener("click", function (e) { if (!dd.classList.contains("hidden") && !dd.contains(e.target) && !btn.contains(e.target)) close(); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    /* keep it attached to the button while the page scrolls or the window changes */
    var again = function () { if (!dd.classList.contains("hidden")) go(); };
    W.addEventListener("resize", again);
    W.addEventListener("scroll", again, true);
  }

  function wireAll() { PAIRS.forEach(wire); }

  /* the tabs are in index.html from the start, but wire again if anything re-renders them */
  wireAll();
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", wireAll);
  W.addEventListener("load", wireAll);
  var tries = 0, iv = setInterval(function () { wireAll(); if (++tries > 20) clearInterval(iv); }, 1500);
})(window);
