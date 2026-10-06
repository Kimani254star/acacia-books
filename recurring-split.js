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
            row.style.background = "#f8fafc";
            row.innerHTML = "<td></td><td>&#8627; " + esc(i.invoiceNumber) + "</td><td>" + esc(i.date) + "</td><td>" + esc(i.customer || rt.customerName) + "</td><td>" + esc(rt.recurrenceType) + "</td><td>Paid " + money(num(i.amountPaid) / (num(i.exchangeRate) || 1), cur) + "</td><td>" + money(i.total, cur) + "</td><td>" + invStatus(i) + '</td><td style="white-space:nowrap">' + invActions(Number(i.id)) + "</td>";
            after.parentNode.insertBefore(row, after.nextSibling); after = row;
          });
        });
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
