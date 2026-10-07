/* books-modules.js - merged: nonCurrentAssets.js + recycle-restore.js + recurring-split.js (+ recurring renumber + duplicate-number fixer).
 * Load LAST (after acacia-fixes-2.js), where recurring-split.js used to load. */

/* ===== nonCurrentAssets.js ===== */
/* scripts/nonCurrentAssets.js — Non-Current Assets support.
 * The full Non-Current Assets module (addNonCurrentAsset,
 * editNonCurrentAsset, deleteNonCurrentAsset, depreciateNonCurrentAsset,
 * getNonCurrentAssets, reports, CSV export, etc.) already lives in
 * app.js / app-3.js. This file only guarantees the balance-sheet data
 * shape exists so those features never read an undefined list. */
(function () {
  "use strict";
  var W = window;

  if (typeof W.getNonCurrentAssets !== "function") {
    W.getNonCurrentAssets = function () {
      try {
        var bs = JSON.parse(localStorage.getItem("balanceSheet") || "{}") || {};
        return bs.nonCurrentAssets || [];
      } catch (e) {
        return [];
      }
    };
  }
})();

;

/* ===== recycle-restore.js ===== */
/* recycle-restore.js — Recycle Bin support.
 * The full Recycle Bin implementation (getRecycleBin, saveRecycleBin,
 * renderRecycleBin, emptyRecycleBin, filterRecycleBin, nextRecyclePage,
 * previousRecyclePage, downloadRecycleItem, printRecycleItem,
 * cloneRecycleItem) already lives in app.js / app-3.js.
 * This file only provides safe fallbacks so index.html never hits a
 * "function is not defined" error if those files fail to load. */
(function () {
  "use strict";
  var W = window;

  function lsGet(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  if (typeof W.getRecycleBin !== "function") {
    W.getRecycleBin = function () {
      return lsGet("recycleBin", []);
    };
  }
  if (typeof W.saveRecycleBin !== "function") {
    W.saveRecycleBin = function (items) {
      lsSet("recycleBin", items || []);
    };
  }

  var page = 0;
  var PAGE_SIZE = 10;

  if (typeof W.renderRecycleBin !== "function") {
    W.renderRecycleBin = function () {
      var list = document.getElementById("recycleList");
      if (!list) return;
      var q = (document.getElementById("recycleSearch") || {}).value || "";
      q = q.toLowerCase();
      var items = W.getRecycleBin().filter(function (it) {
        return !q || JSON.stringify(it).toLowerCase().indexOf(q) !== -1;
      });
      var pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      if (page >= pages) page = pages - 1;
      var slice = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (!slice.length) {
        list.innerHTML =
          '<p style="padding:1rem;color:#666;">Recycle Bin is empty.</p>';
      } else {
        list.innerHTML = slice
          .map(function (it, i) {
            var idx = page * PAGE_SIZE + i;
            var label =
              it.name || it.title || it.description || it.type || "Record";
            return (
              '<div style="display:flex;justify-content:space-between;align-items:center;' +
              'padding:.6rem .8rem;border-bottom:1px solid #eee;">' +
              "<span>" + String(label) + "</span>" +
              '<button onclick="restoreRecycleItem(' + idx + ')" ' +
              'style="padding:.3rem .8rem;border-radius:6px;border:1px solid #ccc;' +
              'background:#f5f5f5;cursor:pointer;">Restore</button></div>'
            );
          })
          .join("");
      }
      var ctrl = document.getElementById("recyclePaginationControls");
      if (ctrl)
        ctrl.querySelector("span") &&
          (ctrl.querySelector("span").textContent =
            "Page " + (page + 1) + " of " + pages);
    };
  }

  if (typeof W.filterRecycleBin !== "function") {
    W.filterRecycleBin = function () {
      page = 0;
      W.renderRecycleBin();
    };
  }
  if (typeof W.nextRecyclePage !== "function") {
    W.nextRecyclePage = function () {
      page++;
      W.renderRecycleBin();
    };
  }
  if (typeof W.previousRecyclePage !== "function") {
    W.previousRecyclePage = function () {
      if (page > 0) page--;
      W.renderRecycleBin();
    };
  }
  if (typeof W.emptyRecycleBin !== "function") {
    W.emptyRecycleBin = function () {
      if (!confirm("Permanently delete everything in the Recycle Bin?")) return;
      W.saveRecycleBin([]);
      W.renderRecycleBin();
    };
  }
  if (typeof W.restoreRecycleItem !== "function") {
    W.restoreRecycleItem = function (idx) {
      var items = W.getRecycleBin();
      var it = items[idx];
      if (!it) return;
      if (it.collection && Array.isArray(lsGet(it.collection, null))) {
        var arr = lsGet(it.collection, []);
        arr.push(it.data || it);
        lsSet(it.collection, arr);
      }
      items.splice(idx, 1);
      W.saveRecycleBin(items);
      W.renderRecycleBin();
    };
  }
})();

;

/* ===== recurring-split.js ===== */
/* recurring-split.js - keeps Recurring Invoices and Recurring Bills in their own sub-modules.
 * - Every invoice a recurring template generates is listed in Recurring Invoices (RINV- series), never in Invoices.
 * - Every bill a recurring template generates is listed in Recurring Bills (RBIL- series), never in Bills.
 * - Both still post to receivables / payables / ledger, so reports (P&L etc.) combine them as before.
 * - Rows use the same buttons as Invoices / Bills: Edit, Delete, Preview, Record Payment, Push to ETIMS, Share, More. */
(function () {
  "use strict";
  if (window.__acxRecurringSplit) return;
  window.__acxRecurringSplit = true;

  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function num(x) { var n = parseFloat(x); return isNaN(n) ? 0 : n; }
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(v, cur) { try { if (typeof window.formatMoneyIn === "function") return window.formatMoneyIn(v, cur); } catch (e) {} return (cur ? cur + " " : "") + num(v).toFixed(2); }
  var BTN = 'class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800"';
  var MI = 'class="w-full text-left px-2 py-2 text-sm text-blue-900 hover:bg-blue-900 hover:text-white"';

  /* ---------- RINV number series shared by templates and generated invoices ---------- */
  function rinvMax(invoices) {
    var max = 0, take = function (v) { var m = /^RINV-(?:[A-Za-z]+\d*-)?(\d+)$/.exec(String(v || "")); if (m) max = Math.max(max, parseInt(m[1], 10)); };
    jget("recurringInvoices", []).forEach(function (r) { if (r) { take(r.number); take(r.invoiceNumber); } });
    (invoices || jget("invoices", [])).forEach(function (i) { if (i) take(i.invoiceNumber); });
    return max;
  }
  window.__acxNextRinv = function (invoices) { return "RINV-" + String(rinvMax(invoices) + 1).padStart(5, "0"); };
  var _gen = window.generateRecurringInvoiceNumber;
  if (typeof _gen === "function") {
    window.generateRecurringInvoiceNumber = function () {
      var n = _gen.apply(this, arguments), m = /(\d+)$/.exec(String(n || ""));
      return m && parseInt(m[1], 10) <= rinvMax() ? window.__acxNextRinv() : n;
    };
  }

  /* ---------- Recurring Invoices table ---------- */
  function generatedFor(rt, invoices) {
    return invoices.filter(function (i) {
      if (!i) return false;
      if (String(i.recurringRef) === String(rt.id)) return true;
      return String(i.recurringId) === String(rt.id) && String(i.invoiceNumber) !== String(rt.number);
    }).sort(function (a, b) { return String(a.invoiceNumber).localeCompare(String(b.invoiceNumber), undefined, { numeric: true }); });
  }
  function invStatus(i) {
    var t = num(i.totalKES) || num(i.total), p = num(i.amountPaid);
    if (i.pendingApproval) return "Pending Approval";
    return t > 0 && p >= t ? "Paid" : p > 0 ? "Partial" : "Unpaid";
  }
  function menu(key, items) {
    return ' <div class="relative inline-block"><button onclick="acxRsMenu(\'' + key + '\')" class="border border-blue-900 text-white bg-blue-900 font-bold px-2 py-1 rounded hover:bg-blue-800">More \u25BE</button>' +
      '<div id="acx-rs-menu-' + key + '" class="hidden absolute right-0 mt-1 w-40 bg-white border rounded shadow z-50 flex flex-col">' + items + "</div></div>";
  }
  function tplActions(o, id) {
    var b = function (fn, arg, l) { return '<button onclick="' + fn + "(" + arg + ')" ' + BTN + ">" + l + "</button> "; };
    var m = function (fn, arg, l) { return '<button onclick="' + fn + "(" + arg + ')" ' + MI + ">" + l + "</button>"; };
    return b("editRecurring", o, "Edit") + b("deleteRecurring", o, "Delete") + b("previewRecurring", "'" + id + "'", "Preview") + b("recordRecurringPayment", o, "Record Payment") + b("pushRecurringToETIMS", o, "Push to ETIMS") + b("shareRecurringEmail", o, "Share") +
      menu("t" + o, m("reverseRecurringPayment", o, "Reverse Payment") + m("applyCreditToRecurringInvoice", o, "Apply Credit") + m("rbiRunDue", "", "Run Due Now"));
  }
  function invActions(id) {
    var b = function (fn, l) { return '<button onclick="acxRsInv(\'' + fn + "'," + id + ')" ' + BTN + ">" + l + "</button> "; };
    var m = function (fn, l) { return '<button onclick="acxRsInv(\'' + fn + "'," + id + ')" ' + MI + ">" + l + "</button>"; };
    return b("editInvoice", "Edit") + b("deleteInvoice", "Delete") + b("previewInvoice", "Preview") + b("recordInvoicePayment", "Record Payment") + b("pushInvoiceToETIMS", "Push to ETIMS") + b("shareInvoice", "Share") +
      menu("i" + id, m("emailInvoice", "Email") + m("reversePayment", "Reverse Payment") + m("applyCredit", "Apply Credit"));
  }
  window.acxRsMenu = function (k) {
    var el = document.getElementById("acx-rs-menu-" + k);
    document.querySelectorAll('[id^="acx-rs-menu-"]').forEach(function (x) { if (x !== el) x.classList.add("hidden"); });
    if (el) el.classList.toggle("hidden");
  };
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest('[id^="acx-rs-menu-"], [onclick^="acxRsMenu"]')) document.querySelectorAll('[id^="acx-rs-menu-"]').forEach(function (x) { x.classList.add("hidden"); });
  });
  window.acxRsInv = function (fn, id) {
    var f = window[fn]; if (typeof f !== "function") return alert("This action is not available.");
    document.querySelectorAll('[id^="acx-rs-menu-"]').forEach(function (x) { x.classList.add("hidden"); });
    try { window.invoices = jget("invoices", []); } catch (e) {}
    f(id);
    setTimeout(function () { try { window.renderRecurringInvoices(); } catch (e) {} }, 400);
  };

  var _rri = window.renderRecurringInvoices;
  if (typeof _rri === "function") {
    window.renderRecurringInvoices = function () {
      var r = _rri.apply(this, arguments);
      try {
        var tb = document.getElementById("recurringInvoiceTable"); if (!tb) return r;
        var tpls = jget("recurringInvoices", []), invoices = jget("invoices", []);
        Array.prototype.slice.call(tb.querySelectorAll("tr")).forEach(function (tr) {
          var cb = tr.querySelector(".recurringCheck"); if (!cb) return;
          var o = parseInt(cb.getAttribute("data-index"), 10), rt = tpls[o]; if (!rt) return;
          var cells = tr.children; if (cells.length) cells[cells.length - 1].innerHTML = tplActions(o, esc(rt.id));
          var after = tr;
          generatedFor(rt, invoices).forEach(function (i) {
            var row = document.createElement("tr"), cur = i.currency || rt.currency;
            row.innerHTML = "<td></td><td>" + esc(i.invoiceNumber) + "</td><td>" + esc(i.date) + "</td><td>" + esc(i.customer || rt.customerName) + "</td><td>" + esc(rt.recurrenceType) + "</td><td>Paid " + money(num(i.amountPaid) / (num(i.exchangeRate) || 1), cur) + "</td><td>" + money(i.total, cur) + "</td><td>" + invStatus(i) + '</td><td style="white-space:nowrap">' + invActions(Number(i.id)) + "</td>";
            after.parentNode.insertBefore(row, after.nextSibling); after = row;
          });
        });
        /* generated invoices are their own RINV- entries: list everything in number order instead of nesting under the template */
        var flat = Array.prototype.slice.call(tb.children).map(function (tr, ix) { var m = /(\d+)\s*$/.exec(tr.cells[1] ? tr.cells[1].textContent : ""); return { tr: tr, ix: ix, n: m ? parseInt(m[1], 10) : 1e12 }; });
        flat.sort(function (x, y) { return x.n - y.n || x.ix - y.ix; });
        flat.forEach(function (o) { tb.appendChild(o.tr); });
      } catch (e) { console.warn("[recurringSplit] invoices", e); }
      return r;
    };
  }

  /* ---------- Bills table: generated recurring bills stay in Recurring Bills ---------- */
  var _lsb = window.loadSupplierBills;
  if (typeof _lsb === "function") {
    var wrapped = function () {
      var r = _lsb.apply(this, arguments);
      try {
        var view = window.__acxSupplierBillsView || [], has = window.__acxRbHasTemplate;
        document.querySelectorAll("#supplierBillsList .bill-checkbox").forEach(function (cb) {
          var b = view[parseInt(cb.value, 10)];
          if (b && b.recurringId && (!has || has(b))) { var tr = cb.closest("tr"); if (tr) tr.style.display = "none"; cb.checked = false; cb.disabled = true; }
        });
      } catch (e) { console.warn("[recurringSplit] bills", e); }
      return r;
    };
    for (var k in _lsb) wrapped[k] = _lsb[k];
    window.loadSupplierBills = wrapped;
  }

  function refresh() {
    try { window.renderRecurringInvoices && window.renderRecurringInvoices(); } catch (e) {}
    try { window.loadSupplierBills && window.loadSupplierBills(); } catch (e) {}
  }
  if (document.readyState === "complete") refresh(); else window.addEventListener("load", refresh);
})();

;

/* ===== renumber.js ===== */
/* ===== renumber-recurring (one-time clean-up of already generated documents) =====
 * Invoices generated from a recurring template that still carry an INV- number are renamed into the
 * RINV- series (RINV-00001 template -> RINV-00002, 00003 ...). Bills still carrying BIL- go into RBIL-.
 * Payments, receipts, journals etc. that point at the old number are updated too. If a normal document
 * shares the old number, only references that also name the same customer / supplier are changed. */
(function () {
  "use strict";
  if (window.__acxRecurringRenumber) return;
  window.__acxRecurringRenumber = true;

  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("[renumber] save failed", k, e); } }
  function pad(n) { return String(n).padStart(5, "0"); }
  function low(x) { return String(x == null ? "" : x).trim().toLowerCase(); }
  function dkey(r) { return String(r.date || r.invoiceDate || r.billDate || ""); }

  var INV_REFS = ["receipts", "customerPayments", "payments", "recurringPayments", "vatReport", "creditNotes", "salesReturns", "deliveries", "manualJournals", "journalEntries", "manualTransactions", "transactions", "coaPostings"];
  var BILL_REFS = ["billPayments", "supplierPayments", "payments", "manualJournals", "journalEntries", "manualTransactions", "transactions", "supplierDebitNotes", "debitNotes", "purchaseReturns", "grns", "vatReport", "coaPostings"];
  var PARTY = ["supplier", "supplierName", "vendor", "customer", "customerName", "party"];

  function partyOf(o) { for (var i = 0; i < PARTY.length; i++) if (typeof o[PARTY[i]] === "string" && o[PARTY[i]]) return low(o[PARTY[i]]); return ""; }
  function walk(node, oldNo, newNo, party, collide) {
    var n = 0;
    if (Array.isArray(node)) { node.forEach(function (c) { n += walk(c, oldNo, newNo, party, collide); }); return n; }
    if (!node || typeof node !== "object") return 0;
    var keys = Object.keys(node), hit = keys.some(function (k) { return node[k] === oldNo; });
    if (hit) {
      var p = partyOf(node);
      if (!collide || (p && party && p === party)) { keys.forEach(function (k) { if (node[k] === oldNo) node[k] = newNo; }); n++; }
    }
    keys.forEach(function (k) { if (node[k] && typeof node[k] === "object") n += walk(node[k], oldNo, newNo, party, collide); });
    return n;
  }
  function renameRefs(keys, oldNo, newNo, party, collide) {
    var seen = {};
    keys.forEach(function (k) {
      if (seen[k]) return; seen[k] = 1;
      var raw = null; try { raw = localStorage.getItem(k); } catch (e) {}
      if (!raw || raw.indexOf('"' + oldNo + '"') < 0) return;
      var data; try { data = JSON.parse(raw); } catch (e) { return; }
      if (walk(data, oldNo, newNo, party, collide)) jset(k, data);
    });
  }

  function run(cfg) {
    var recs = jget(cfg.listKey, []), tpls = jget(cfg.tplKey, []);
    if (!Array.isArray(recs) || !Array.isArray(tpls) || !tpls.length) return 0;
    var tpl = {}; tpls.forEach(function (t) { if (t && t.id != null) tpl[String(t.id)] = t; });
    var counts = {}; recs.forEach(function (r) { var n = r && r[cfg.numField]; if (n) counts[n] = (counts[n] || 0) + 1; });
    var todo = recs.filter(function (r) {
      if (!r) return false;
      var t = tpl[String(r.recurringId != null ? r.recurringId : r.recurringRef)];
      var no = String(r[cfg.numField] || "");
      return t && no && !cfg.re.test(no) && no !== String(t.number || t.invoiceNumber || "");
    }).sort(function (a, b) { return dkey(a).localeCompare(dkey(b)) || String(a[cfg.numField]).localeCompare(String(b[cfg.numField]), undefined, { numeric: true }); });
    if (!todo.length) return 0;
    todo.forEach(function (r) {
      var oldNo = r[cfg.numField], newNo = cfg.next(recs);
      r[cfg.numField] = newNo;
      if (r.number === oldNo) r.number = newNo;
      renameRefs(cfg.refs, oldNo, newNo, low(r.supplier || r.supplierName || r.customer || r.customerName), counts[oldNo] > 1);
    });
    jset(cfg.listKey, recs);
    return todo.length;
  }

  function nextRbil(bills) {
    var max = 0, re = /^RBIL-(?:[A-Za-z]+\d*-)?(\d+)$/;
    (bills || []).forEach(function (b) { var m = re.exec(String((b && b.billNumber) || "")); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    jget("recurringBills", []).forEach(function (t) { var m = re.exec(String((t && t.number) || "")); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return "RBIL-" + pad(max + 1);
  }
  window.__acxNextRbil = nextRbil;

  /* ---------- duplicate numbers anywhere in Invoices / Bills (also appear after sync from another device) ---------- */
  function seriesNext(recs, field, sample, extra) {
    var m = /^(.*?)(\d+)$/.exec(String(sample)); if (!m) return null;
    var prefix = m[1], width = m[2].length, max = 0;
    var take = function (v) { v = String(v == null ? "" : v); if (v.indexOf(prefix) === 0) { var r = /^\d+$/.exec(v.slice(prefix.length)); if (r) max = Math.max(max, parseInt(r[0], 10)); } };
    recs.forEach(function (r) { if (r) take(r[field]); });
    (extra || []).forEach(take);
    return prefix + String(max + 1).padStart(width, "0");
  }
  function isFiscal(r) { return !!(r && (r.etims || r.fiscal || r.qrText || r.etimsStatus)); }
  function dedupe(cfg) {
    var recs = jget(cfg.listKey, []);
    if (!Array.isArray(recs) || recs.length < 2) return 0;
    var groups = {};
    recs.forEach(function (r, i) { var n = r && r[cfg.numField]; if (n) (groups[n] = groups[n] || []).push({ r: r, i: i }); });
    var extra = []; jget(cfg.tplKey, []).forEach(function (t) { if (t) { extra.push(t.number); extra.push(t.invoiceNumber); } });
    var changed = 0;
    Object.keys(groups).forEach(function (no) {
      var g = groups[no]; if (g.length < 2) return;
      /* keep: fiscalised first, then earliest date, then first in list */
      g.sort(function (a, b) { return (isFiscal(b.r) - isFiscal(a.r)) || dkey(a.r).localeCompare(dkey(b.r)) || a.i - b.i; });
      g.slice(1).forEach(function (o) {
        if (isFiscal(o.r)) return;
        var nn = seriesNext(recs, cfg.numField, no, extra); if (!nn) return;
        o.r[cfg.numField] = nn; if (o.r.number === no) o.r.number = nn;
        renameRefs(cfg.refs, no, nn, low(o.r.supplier || o.r.supplierName || o.r.customer || o.r.customerName), true);
        changed++;
      });
    });
    if (changed) jset(cfg.listKey, recs);
    return changed;
  }

  var busy = false, timer = null;
  function pass() {
    if (busy) return; busy = true;
    var a = 0, b = 0, c = 0, d = 0;
    try {
      try { if (typeof window.__acxNextRinv === "function") a = run({ listKey: "invoices", tplKey: "recurringInvoices", numField: "invoiceNumber", re: /^RINV-/, refs: INV_REFS, next: window.__acxNextRinv }); } catch (e) { console.warn("[renumber] invoices", e); }
      try { b = run({ listKey: "bills", tplKey: "recurringBills", numField: "billNumber", re: /^RBIL-/, refs: BILL_REFS, next: nextRbil }); } catch (e) { console.warn("[renumber] bills", e); }
      try { c = dedupe({ listKey: "invoices", tplKey: "recurringInvoices", numField: "invoiceNumber", refs: INV_REFS }); } catch (e) { console.warn("[dedupe] invoices", e); }
      try { d = dedupe({ listKey: "bills", tplKey: "recurringBills", numField: "billNumber", refs: BILL_REFS }); } catch (e) { console.warn("[dedupe] bills", e); }
    } finally { busy = false; }
    if (a || b || c || d) {
      console.info("[renumber] recurring renamed: " + a + " invoice(s), " + b + " bill(s); duplicate numbers fixed: " + c + " invoice(s), " + d + " bill(s)");
      ["renderRecurringInvoices", "renderInvoices", "loadSupplierBills"].forEach(function (n) { try { if (typeof window[n] === "function") window[n](); } catch (e) {} });
      try { if (typeof window.rbPage === "function") window.rbPage(0); } catch (e) {}
    }
  }
  window.__acxFixDuplicateNumbers = pass;
  function schedule() { clearTimeout(timer); timer = setTimeout(pass, 1500); }
  var WATCH = { invoices: 1, bills: 1, recurringInvoices: 1, recurringBills: 1 };
  try { if (window.__companyNS && window.__companyNS.onSetItem) window.__companyNS.onSetItem(function (k) { if (!busy && WATCH[k]) schedule(); }); } catch (e) {}
  window.addEventListener("storage", function (e) { if (!busy && (!e.key || WATCH[e.key])) schedule(); });
  function start() { setTimeout(pass, 2500); }
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();

;
