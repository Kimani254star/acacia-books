/* Acacia Books – readability guard.
   Fixes text that ends up the same colour as its background (e.g. white text on a
   white card in Organization Profile / Branding, or after a theme/brand colour change). */
(function () {
  "use strict";
  if (window.__acxContrastFix) return;
  window.__acxContrastFix = true;

  var css =
    "#orgProfileTab .op-hero,#warehousesTab .wh-hero{background:linear-gradient(135deg,#0f2557 0,#1e3a8a 55%,#1d4ed8 100%)!important;color:#fff!important}" +
    "#orgProfileTab .op-hero *{color:#fff}" +
    "#orgProfileTab .op-hero .text-blue-100{color:#dbeafe!important}" +
    "#orgProfileTab .op-card,#orgProfileTab .op-nav{color:#1f2937}" +
    "#orgProfileTab .op-card input,#orgProfileTab .op-card select,#orgProfileTab .op-card textarea{background:#fff!important;color:#111827!important;border:1px solid #d1d5db}" +
    "#orgProfileTab .op-card label{color:#374151}" +
    "#orgProfileTab .op-nav a{color:#1e3a8a!important;background:#fff!important}" +
    "#orgProfileTab .op-nav a.op-nav-active{color:#fff!important;background:#1e3a8a!important}" +
    "#orgProfileTab .op-savebtn{background:#1e3a8a!important;color:#fff!important}" +
    "#brandPreviewBtn,#brandPreviewBtn2{min-width:6rem}" +
    "#dashboard{color:#1f2937}" +
    "#dashboard h2,#dashboard h3,#dashboard h4{color:#0f172a!important}" +
    "#dashboard p{color:#475569}" +
    "#dashboard .bg-white,#dashboard .bg-white *{color:#1f2937}" +
    "#dashboard .bg-white .text-slate-400,#dashboard .bg-white .text-slate-500{color:#64748b!important}" +
    "#dashboard .text-green-600{color:#16a34a!important}#dashboard .text-red-600,#dashboard .text-red-500{color:#dc2626!important}" +
    "#dashboard .text-2xl,#dashboard .text-xl{color:#0f172a!important}" +
    "html.dark #orgProfileTab .op-card,html.dark #orgProfileTab .op-nav{background:#1e293b!important;color:#e5e7eb!important;border-color:#334155!important}" +
    "html.dark #orgProfileTab .op-card-title{color:#f1f5f9!important}" +
    "html.dark #orgProfileTab .op-card-sub,html.dark #orgProfileTab .op-card label{color:#cbd5e1!important}" +
    "html.dark #orgProfileTab .op-card input,html.dark #orgProfileTab .op-card select,html.dark #orgProfileTab .op-card textarea{background:#0f172a!important;color:#f1f5f9!important;border-color:#475569!important}" +
    /* Preferences submodule – section sidebar tabs follow the theme */
    "#preferencesTab .pref-tab{color:#475569}" +
    "#preferencesTab .pref-tab:hover{color:#1e3a8a}" +
    "#preferencesTab .pref-tab.active,#preferencesTab .pref-tab.border-blue-900{color:#1e3a8a;border-color:#1e3a8a}" +
    "#preferencesTab .pref-section label{color:#374151}" +
    "html.dark #preferencesTab{color:#e5e7eb}" +
    "html.dark #preferencesTab h2,html.dark #preferencesTab h3,html.dark #preferencesTab h4{color:#f1f5f9!important}" +
    "html.dark #preferencesTab .pref-tab{color:#cbd5e1!important;background:transparent!important;border-color:transparent}" +
    "html.dark #preferencesTab .pref-tab:hover{color:#93c5fd!important}" +
    "html.dark #preferencesTab .pref-tab.active,html.dark #preferencesTab .pref-tab.border-blue-900{color:#93c5fd!important;border-color:#3b82f6!important}" +
    "html.dark #preferencesTab .pref-section{color:#e5e7eb}" +
    "html.dark #preferencesTab .pref-section label{color:#cbd5e1!important}" +
    "html.dark #preferencesTab .pref-section input,html.dark #preferencesTab .pref-section select,html.dark #preferencesTab .pref-section textarea{background:#0f172a!important;color:#f1f5f9!important;border-color:#475569!important}" +
    "html.dark #preferencesTab .bg-white{background:#1e293b!important;color:#e5e7eb!important;border-color:#334155!important}";
  var st = document.createElement("style");
  st.id = "acxContrastFixCss";
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  function rgb(s) {
    var m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function ratio(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function bgOf(el) {
    while (el && el.nodeType === 1) {
      var cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== "none") {
        var g = rgb(cs.backgroundImage); // first colour of a gradient
        if (g) return g;
        return null; // picture background – leave alone
      }
      var c = rgb(cs.backgroundColor);
      if (c && c.a > 0.5) return c;
      el = el.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  function hasText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling)
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  }

  var SCOPES = ["#dashboard", "#preferencesTab", "#orgProfileTab", "#advCustomization", "#customizationTab", "[id$='Tab']:not(.hidden)", ".modal:not(.hidden)", "[id$='Panel']:not(.hidden)", "main:not(.hidden)"];
  function scan() {
    var seen = [];
    SCOPES.forEach(function (sel) {
      try { document.querySelectorAll(sel).forEach(function (r) { if (seen.indexOf(r) < 0 && r.offsetParent !== null) seen.push(r); }); } catch (e) {}
    });
    seen.forEach(function (root) {
      var els = root.querySelectorAll("*");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el.offsetParent || !hasText(el)) continue;
        if (el.__acxFixed) continue;
        var fg = rgb(getComputedStyle(el).color), bg = bgOf(el);
        if (!fg || !bg) continue;
        if (ratio(fg, bg) < 3) {
          el.style.setProperty("color", lum(bg) > 0.4 ? "#111827" : "#ffffff", "important");
          el.__acxFixed = true;
        }
      }
    });
  }

  var t = null;
  function later() { clearTimeout(t); t = setTimeout(scan, 250); }
  function start() {
    scan();
    new MutationObserver(later).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
    document.addEventListener("click", later, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
