/* ===================================================================
   acacia-template-redirect.js
   Makes Customization > PDF Templates the ONLY place to edit a
   document template.

   Anywhere in the system that used to open its own template editor
   (the per-document "Edit Template" popups, the "Document Template"
   bar, the old "Edit in Customization" button) now takes the user to
   Customization > PDF Templates, with the right Form Type selected
   and the document's saved template loaded (if it has one).

   Load this LAST in index.html (after acacia-numbering.js).
   =================================================================== */
(function () {
  "use strict";
  if (window.__acxTplRedirect) return;
  window.__acxTplRedirect = true;

  /* ---------- hide the old built-in editors & duplicate button ---------- */
  var st = document.createElement("style");
  st.textContent =
    "#utsEditor{display:none!important}" +
    "#templateEditor,#orderTemplateEditor,#bulkTemplateEditor,#quoteTemplateEditor,#salesReturnTemplateEditor{display:none!important}" +
    ".uts-bar [data-role=editInCustomization]{display:none!important}";
  (document.head || document.documentElement).appendChild(st);

  /* ---------- helpers ---------- */
  function registryByKey(key) {
    try { return (window.acxDocRegistryByKey || {})[key] || null; } catch (e) { return null; }
  }

  function registryByContext(el) {
    var reg = window.acxDocRegistry || [];
    var n = el;
    while (n && n !== document.body) {
      if (n.id) {
        for (var i = 0; i < reg.length; i++) {
          if (reg[i].modal === n.id || reg[i].tab === n.id) return reg[i];
        }
      }
      n = n.parentElement;
    }
    return null;
  }

  function savedTemplateFor(key) {
    if (!key) return "";
    try {
      var s = JSON.parse(localStorage.getItem("docTemplateSettings_" + key) || "{}") || {};
      if (s.customTemplate) return s.customTemplate;
    } catch (e) {}
    try {
      var d = JSON.parse(localStorage.getItem("templateModuleDefaults") || "{}") || {};
      if (d[key]) return d[key];
    } catch (e) {}
    return "";
  }

  function closePreviewModals() {
    try {
      document.querySelectorAll('[id$="PreviewModal"], [id*="PreviewModal"]').forEach(function (m) {
        m.classList.add("hidden");
      });
    } catch (e) {}
  }

  function setFormType(formType) {
    var sel = document.getElementById("templateFormType");
    if (!sel || !formType) return;
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === formType || sel.options[i].text === formType) {
        sel.selectedIndex = i; found = true; break;
      }
    }
    if (!found) {
      var o = document.createElement("option");
      o.textContent = formType; o.value = formType;
      sel.appendChild(o);
      sel.value = formType;
    }
  }

  function selectTemplate(name) {
    var dd = document.getElementById("savedTemplatesDropdown");
    if (!dd || !name) return;
    var exists = false;
    try { exists = localStorage.getItem("template_" + name) !== null; } catch (e) {}
    if (!exists) return;
    var has = false;
    for (var i = 0; i < dd.options.length; i++) if (dd.options[i].value === name) { has = true; break; }
    if (!has) {
      var o = document.createElement("option");
      o.value = name; o.textContent = name;
      dd.appendChild(o);
    }
    dd.value = name;
    if (typeof window.loadTemplateEditor === "function") window.loadTemplateEditor();
  }

  /* ---------- the one place to edit templates ---------- */
  function goEditTemplate(opts) {
    opts = opts || {};
    closePreviewModals();

    if (typeof window.showTab === "function") window.showTab("settingstemplateTab");

    function arrive(tries) {
      var host = document.getElementById("settingstemplateTab");
      if (host && host.classList.contains("hidden")) {
        /* showTab refused (plan/role) or not ready - nothing more to do */
        if (tries > 0) return setTimeout(function () { arrive(tries - 1); }, 100);
        return;
      }
      /* open the PDF Templates tab inside Customization */
      var btn = document.querySelector('#custTabs .cust-tab[data-sec="cTemplates"]');
      if (btn) btn.click();

      /* pick the Form Type for this document and load the template list */
      if (opts.formType) setFormType(opts.formType);
      try { if (typeof window.loadTemplateList === "function") window.loadTemplateList(); } catch (e) {}
      try { if (typeof window.updatePreview === "function") window.updatePreview(); } catch (e) {}

      /* load this document's saved template into the editor */
      if (opts.template) selectTemplate(opts.template);

      var target = document.getElementById("allTemplatesGallery") || document.getElementById("cTemplates");
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setTimeout(function () { arrive(10); }, 150);
  }
  window.acxGoEditTemplate = goEditTemplate;

  function goForKey(key) {
    var d = registryByKey(key);
    goEditTemplate({ formType: d && d.formType, template: savedTemplateFor(key) });
  }

  /* ---------- 1. existing "open designer" hook (used by the old
              "Edit in Customization" button and the template cards) ---------- */
  function designerHook(templateName, formType) {
    goEditTemplate({ template: templateName || "", formType: formType || "" });
  }
  try {
    Object.defineProperty(window, "acxOpenTemplateDesigner", {
      configurable: true,
      get: function () { return designerHook; },
      set: function () { /* ignore later overwrites */ }
    });
  } catch (e) { window.acxOpenTemplateDesigner = designerHook; }

  /* ---------- 2. the "Document Template" bar's Edit Template button ---------- */
  function utsHook(key) { goForKey(key); }
  try {
    Object.defineProperty(window, "utsOpenEditor", {
      configurable: true,
      get: function () { return utsHook; },
      set: function () { /* ignore later overwrites */ }
    });
  } catch (e) { window.utsOpenEditor = utsHook; }

  /* ---------- 3. the old per-document editors ---------- */
  var OLD = {
    openTemplateEditor: "invoice",
    openOrderTemplateEditor: "order",
    openBulkTemplateEditor: "bulkinvoice",
    openQuoteTemplateEditor: "quote",
    openSalesReturnTemplateEditor: "salesreturn"
  };
  Object.keys(OLD).forEach(function (fn) {
    window[fn] = function () { goForKey(OLD[fn]); };
  });

  /* ---------- 4. safety net: any other "Edit Template" /
              "Edit in Customization" button outside Customization ---------- */
  document.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("button, a") : null;
    if (!b) return;
    if (b.closest("#settingstemplateTab")) return;           /* already in Customization */
    if (b.closest("#utsEditor")) return;
    var label = (b.textContent || "").replace(/\s+/g, " ").trim();
    if (!/^(✏️\s*)?edit (template|in customization)$/i.test(label)) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();

    var bar = b.closest(".uts-bar");
    var key = "";
    if (bar && bar.id) key = bar.id.replace(/^uts(Modal|Tab)Bar_/, "");
    if (key) return goForKey(key);

    var d = registryByContext(b);
    if (d) return goForKey(d.key);
    goEditTemplate({});
  }, true);
})();
