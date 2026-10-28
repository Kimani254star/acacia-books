/* ============================================================================
   acacia-bill-batch.js
   Product lines on Bills, Bulk Bills and Recurring Bills can now put the
   received stock into a BATCH:
     - pick one of the item's existing batches, or
     - choose "New batch" and type the batch number (+ optional mfg / expiry).
   On save the quantity is added to that batch (created if new) and the item
   total is raised as before. Deleting / editing a bill takes it back off the
   same batch. Only Product lines are affected (other item types never touch
   stock). Load AFTER app-2.js / app-3.js.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__acxBillBatchLoaded) return;
  window.__acxBillBatchLoaded = true;

  var NEW = "__new__";
  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ---------- stock side: add / remove quantity on a batch ---------- */
  window.__acxBatchAdj = function (item, line, sign) {
    try {
      if (!item || !line || !line.batch) return;
      var b0 = line.batch;
      var no = String(b0.batchNo || b0.batch || "").trim();
      if (!no) return;
      var qty = num(line.qty);
      if (!Array.isArray(item.batches)) item.batches = [];

      var b = item.batches.find(function (x) { return String(x.batchNo || x.batch || "").trim() === no; });
      if (!b) {
        if (sign <= 0) return;                       // nothing to take off
        // first tracked batch on an item that already held untracked stock:
        // keep that stock visible, otherwise the batch total would hide it
        if (item.batches.length === 0) {
          var prior = num(item.qty) - qty;          // item.qty already includes this line
          if (prior > 0.0000001) item.batches.push({ batchNo: "Opening stock", mfgDate: "", expiryDate: "", qty: prior });
        }
        b = { batchNo: no, mfgDate: b0.mfg || b0.mfgDate || "", expiryDate: b0.expiry || b0.expiryDate || "", qty: 0 };
        item.batches.push(b);
      } else if (sign > 0) {
        if (!b.expiryDate && (b0.expiry || b0.expiryDate)) b.expiryDate = b0.expiry || b0.expiryDate;
        if (!b.mfgDate && (b0.mfg || b0.mfgDate)) b.mfgDate = b0.mfg || b0.mfgDate;
      }
      b.qty = Math.max(num(b.qty) + sign * qty, 0);
    } catch (e) { console.warn("[bill-batch] adjust failed", e); }
  };

  /* ---------- form side ---------- */
  var FORMS = [
    { sel: "billItemDesc",     type: "billItemType",     add: "#addBillItemBtn,button[onclick='addBillItem()']" },
    { sel: "bulkBillItemDesc", type: "bulkBillItemType", add: "button[onclick='addBulkBillItem()']" },
    { sel: "rbProduct",        type: "rbItemType",       add: "button[onclick='rbAddItem()']" }
  ];

  function planAllows() {
    try { return !window.AcaciaPlans || !window.AcaciaPlans.hasFeatureAccess || window.AcaciaPlans.hasFeatureAccess("batch"); } catch (e) { return true; }
  }

  function setup(cfg) {
    var sel = $(cfg.sel);
    if (!sel) return false;
    if (sel.__acxNB) return true;
    var wrap = $(cfg.sel + "_batchWrap"), bs = $(cfg.sel + "_batchSel");
    if (!wrap || !bs) return false;                 // the existing batch picker is not built yet
    sel.__acxNB = true;

    var nb = document.createElement("div");
    nb.id = cfg.sel + "_newBatchWrap";
    nb.className = "mb-4 hidden";
    nb.innerHTML =
      '<div class="flex flex-wrap gap-2 items-end">' +
      '<div><label class="block text-sm font-semibold mb-1">New batch no.</label><input id="' + cfg.sel + '_nbNo" type="text" class="border p-2 rounded" placeholder="e.g. B-2026-001"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Mfg date (optional)</label><input id="' + cfg.sel + '_nbMfg" type="date" class="border p-2 rounded"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Expiry (optional)</label><input id="' + cfg.sel + '_nbExp" type="date" class="border p-2 rounded"></div>' +
      "</div>";
    wrap.parentNode.insertBefore(nb, wrap.nextSibling);

    function isProduct() {
      var t = cfg.type ? $(cfg.type) : null;
      return String((t && t.value) || "product").toLowerCase() === "product";
    }
    function refresh() {
      var label = wrap.querySelector("label");
      if (!sel.value || !isProduct() || !planAllows()) {
        wrap.classList.add("hidden"); nb.classList.add("hidden");
        if (bs.value === NEW) bs.value = "";
        return;
      }
      if (label) label.textContent = "📦 Batch — pick an existing batch or add a new one:";
      if (!Array.prototype.some.call(bs.options, function (o) { return o.value === NEW; })) {
        var o = document.createElement("option");
        o.value = NEW; o.textContent = "➕ New batch…";
        bs.appendChild(o);
      }
      bs.disabled = false;
      wrap.classList.remove("hidden");
      nb.classList.toggle("hidden", bs.value !== NEW);
    }
    function later() { setTimeout(refresh, 40); setTimeout(refresh, 250); }

    sel.addEventListener("change", later);
    bs.addEventListener("change", refresh);
    if (cfg.type && $(cfg.type)) $(cfg.type).addEventListener("change", refresh);
    document.addEventListener("acx:data-changed", later);

    // runs before the form's own Add handler (capture phase on document)
    document.addEventListener("click", function (ev) {
      var btns = document.querySelectorAll(cfg.add), hit = false;
      Array.prototype.forEach.call(btns, function (b) { if (ev.target === b || b.contains(ev.target)) hit = true; });
      if (!hit || bs.value !== NEW || !isProduct()) return;
      var opt = sel.options[sel.selectedIndex];
      if (!opt || !opt.value) return;                // form will complain "Select a product"
      var no = ($(cfg.sel + "_nbNo").value || "").trim();
      if (!no) {
        ev.stopImmediatePropagation(); ev.preventDefault();
        alert("Enter the new batch number, or pick an existing batch.");
        return;
      }
      var o = { batchNo: no, expiry: $(cfg.sel + "_nbExp").value || "", mfg: $(cfg.sel + "_nbMfg").value || "", qty: "", isNew: true };
      var orig = opt.value, origText = opt.textContent, tag = " | Batch: " + no + (o.expiry ? " (Exp " + o.expiry + ")" : ""), u = orig + tag;
      try {
        var p = JSON.parse(orig);
        if (p && typeof p === "object") { p.name = (p.name || "") + tag; p.batch = o; u = JSON.stringify(p); }
      } catch (e) {}
      opt.value = u;
      setTimeout(function () {
        opt.value = orig; opt.textContent = origText;
        bs.value = "";
        $(cfg.sel + "_nbNo").value = ""; $(cfg.sel + "_nbMfg").value = ""; $(cfg.sel + "_nbExp").value = "";
        nb.classList.add("hidden");
      }, 0);
    }, true);

    refresh();
    return true;
  }

  function boot() {
    var pending = FORMS.slice(), tries = 0;
    (function tick() {
      pending = pending.filter(function (c) { return !setup(c); });
      if (pending.length && ++tries < 60) setTimeout(tick, 1000);
    })();
    document.addEventListener("acx:data-changed", function () { FORMS.forEach(setup); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 600); });
  else setTimeout(boot, 600);
})();
