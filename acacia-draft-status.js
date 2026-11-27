/* Acacia Books — drafts live inside their own module tables.
   1. Removes the "📝 Drafts" submodule from every hub sidebar (and the central Drafts page).
   2. Every module table gets a Status column (added only where it is missing).
   3. A document saved as Draft shows "Draft" in that Status column instead of Paid / Due / Overdue.
   4. Drafts that used to live in a separate store (credit notes, deliveries, sales returns, bulk invoices,
      purchase returns, customers, suppliers) are listed in the module table with Status = Draft.
   Nothing is deleted from storage: existing drafts are kept and simply shown in their tables. */
(function () {
  "use strict";
  if (window.__acxDraftStatus) return;
  window.__acxDraftStatus = true;

  /* ---------- 1. remove the Drafts submodule ---------- */
  function removeDraftsUI() {
    document.querySelectorAll('[onclick*="acxOpenHubDrafts"]').forEach(function (b) {
      var li = b.closest("li");
      if (li) li.remove(); else b.remove();
    });
    var tab = document.getElementById("acxHubDraftsTab");
    if (tab) tab.remove();
  }
  window.acxOpenHubDrafts = function () {};          /* old entry point: do nothing */
  window.acxRefreshHubDrafts = function () {};       /* stops the 2.5s refresh loop in merges.js */

  /* ---------- 2/3/4. Status column + Draft rows ---------- */
  var BADGE = '<span class="acx-draft-badge" style="display:inline-block;background:#f59e0b;color:#fff;border-radius:9999px;padding:1px 8px;font-size:11px;font-weight:700">Draft</span>';
  var T = [
    { id: "invoiceTable",            mains: ["invoices"],          num: "Invoice #" },
    { id: "quoteTable",              mains: ["quotes"],            num: "Quote #" },
    { id: "orderTable",              mains: ["orders", "salesOrders"], num: "Order #" },
    { id: "creditNoteTable",         mains: ["creditNotes"],       drafts: ["creditNoteDrafts"], num: "Credit Note #" },
    { id: "salesReturnTable",        mains: ["salesReturns"],      drafts: ["salesReturnDrafts"] },
    { id: "deliveryTableBody",       mains: ["deliveries"],        drafts: ["deliveryDrafts"], num: "Delivery No." },
    { id: "bulkInvoiceTable",        mains: ["bulkInvoices"],      drafts: ["bulkInvoiceDrafts"], num: "Invoice #" },
    { id: "supplierBillsList",       mains: ["bills"],             num: "Bill #" },
    { id: "bulkBillsList",           mains: ["bulkBills"],         num: "Bill #" },
    { id: "supplierDebitNotesTable", mains: ["supplierDebitNotes", "debitNotes"] },
    { id: "purchaseReturnsTable",    mains: ["purchaseReturns"],   drafts: ["purchaseReturnDrafts"], num: "PR Number" },
    { id: "customerTable",           mains: ["customers"],         drafts: ["customerDrafts"], idle: "Active" },
    { id: "supplierTable",           mains: ["suppliers"],         drafts: ["supplierDrafts"], idle: "Active" },
    { id: "receiptTable",            mains: ["receipts"] },
    { id: "supplierPaymentsTable",   mains: ["supplierPayments", "billPayments"] },
    /* Inventory */
    { id: "movementTableBody",       mains: ["stockMovements", "movements"], drafts: ["stockTransferDrafts"], num: "Transit No." },
    { id: "shipmentTableBody",       mains: ["shipments"],         drafts: ["shipmentDraft"], num: "Shipment No." },
    { id: "bundleTableBody",         mains: ["bundles"],           drafts: ["bundleDrafts"], idle: "Active" },
    /* Funds */
    { id: "manualTransactionLogTable", mains: ["manualTransactions"], drafts: ["manualTxDrafts"] },
    { id: "operationalCostsTable",   mains: ["operationalCosts"] },
    /* Accounting */
    { id: "manualJournalBody",       mains: ["manualJournals"],    drafts: ["manualJournalDraft"], num: "Reference", edit: { manualJournalDraft: "restoreJournalDraft" } },
    { id: "recurringJournalList",    mains: ["recurringJournals"], drafts: ["recurringJournalDraft"], num: "Reference No.", edit: { recurringJournalDraft: "restoreRecurringJournalDraft" } },
    { id: "taxPaymentsTable",        mains: ["taxPayments"],       drafts: ["taxPaymentDrafts"] },
    { id: "currencyAdjustmentsTable", mains: ["currencyAdjustments"], drafts: ["currencyAdjustmentDraft"], num: "Reference", edit: { currencyAdjustmentDraft: "loadAdjustmentDraft" } },
    { id: "taxAdjustmentsTable",     mains: ["taxAdjustments"] },
    { id: "accountsTable",           mains: ["chartOfAccounts", "accounts"], drafts: ["chartOfAccountsDrafts"], idle: "Active" },
    { id: "nonCurrentAssetsTableBody", mains: ["nonCurrentAssets"] },
    { id: "equityTableBody",         mains: ["equityRecords", "equity"] },
    { id: "currentAccountsTableBody", mains: ["currentAccounts"] },
    /* Payroll (earnings drafts live inside the earnings list itself, hidden until approved) */
    { id: "employeesTable",          mains: ["employees"],         idle: "Active" },
    { id: "earningsTable",           mains: ["earnings"],          mainDrafts: ["earnings"], edit: { earnings: "editEarning" }, idle: "Approved" },
    { id: "grossPayrollTable",       mains: ["payrollRecords"] }
  ];
  var NUMF = ["invoiceNumber", "invoiceNo", "invoiceNoBase", "quoteNumber", "orderNumber", "creditNumber",
    "creditNoteNumber", "deliveryNumber", "deliveryNo", "billNumber", "purchaseReturnNumber", "prNumber", "number", "no", "id"];

  function read(k) {
    try {
      var v = JSON.parse(localStorage.getItem(k) || "[]");
      if (Array.isArray(v)) return v;
      return v && typeof v === "object" ? [v] : [];       /* single-record drafts such as manualJournalDraft */
    } catch (_) { return []; }
  }
  function isArrayKey(k) { try { return Array.isArray(JSON.parse(localStorage.getItem(k) || "[]")); } catch (_) { return false; } }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function isDraft(r) { return !!r && (r.isDraft === true || /^\s*draft\s*$/i.test(String(r.status || ""))); }
  function visible(el) { return !!(el && (el.offsetParent !== null || el.getClientRects().length)); }

  function headers(table) {
    var tr = table.tHead && table.tHead.rows[0] ? table.tHead.rows[0] : table.querySelector("tr");
    return tr ? Array.prototype.slice.call(tr.cells) : [];
  }
  function ensureStatusColumn(table, cfg) {
    var ths = headers(table);
    var idx = -1;
    ths.forEach(function (th, i) { if (norm(th.textContent) === "status") idx = i; });
    if (idx >= 0) return { idx: idx, added: table.dataset.acxStatusAdded === "1" };
    if (!ths.length) return null;
    var head = ths[0].parentNode;
    var th = document.createElement("th");
    th.className = ths[ths.length - 1].className;
    th.textContent = "Status";
    th.setAttribute("data-acx-status-th", "1");
    var at = ths.length - 1;                       /* just before the Actions column */
    if (!/action/i.test(ths[at].textContent)) at = ths.length;
    head.insertBefore(th, ths[at] || null);
    table.dataset.acxStatusAdded = "1";
    return { idx: at, added: true };
  }
  function numIndex(table, cfg) {
    if (!cfg.num) return -1;
    var i = -1;
    headers(table).forEach(function (th, n) { if (norm(th.textContent) === norm(cfg.num)) i = n; });
    return i;
  }
  function statusOfRow(cells, numIdx, cfg, mains) {
    if (numIdx < 0 || !cells[numIdx]) return "";
    var txt = norm(cells[numIdx].textContent);
    if (!txt) return "";
    for (var m = 0; m < mains.length; m++) {
      for (var i = 0; i < mains[m].length; i++) {
        var r = mains[m][i];
        for (var f = 0; f < NUMF.length; f++) {
          if (r && r[NUMF[f]] != null && norm(r[NUMF[f]]) === txt) return isDraft(r) ? "Draft" : (typeof r.status === "string" && r.status.trim() ? "s:" + r.status.trim() : "");
        }
      }
    }
    return "";
  }

  /* header text -> value of a draft record */
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) if (r[names[i]] != null && typeof r[names[i]] !== "object" && String(r[names[i]]) !== "") return r[names[i]];
    return "";
  }
  function valueFor(h, r) {
    var k = norm(h).replace(/[^a-z0-9#]/g, "");
    var total = pick(r, ["total", "totalAmount", "grandTotal", "amount"]);
    switch (k) {
      case "date": return pick(r, ["date", "creditDate", "deliveryDate", "returnDate", "purchaseReturnDate"]);
      case "customer": case "customers":
        return Array.isArray(r.customers) ? r.customers.join(", ") : pick(r, ["customer", "customerName", "name"]);
      case "supplier": case "suppliers": return pick(r, ["supplier", "supplierName", "name"]);
      case "name": return pick(r, ["name", "customerName", "supplierName"]) || [r.firstName, r.lastName].filter(Boolean).join(" ");
      case "subtotal": return pick(r, ["subtotal", "subTotal"]);
      case "vat": return pick(r, ["vat"]);
      case "total": case "totalamount": return total;
      case "reason": return pick(r, ["reason"]);
      case "items": return Array.isArray(r.items) ? r.items.length + " item(s)" : pick(r, ["items"]);
      case "invoicenumber": case "attachedinvoice": case "invoice": return pick(r, ["invoiceNumber", "invoice", "invoiceId"]);
      case "invoice#": case "credit note#": case "creditnote#": case "delivery no.": case "deliveryno.":
      case "pr number": case "prnumber": case "bill#": case "billnumber":
        return pick(r, NUMF.slice(0, NUMF.length - 1));
      case "transitno.": return pick(r, ["id", "number", "transitNo"]);
      case "item": case "product": return pick(r, ["item", "description", "name"]) || (Array.isArray(r.items) && r.items[0] ? (r.items[0].desc || r.items[0].name || r.items[0].item || "") : "");
      case "from": case "fromlocation": return pick(r, ["from", "fromLocation", "origin"]);
      case "to": case "tolocation": return pick(r, ["to", "toLocation", "destination"]);
      case "quantity": case "qty": return pick(r, ["quantity", "qty"]);
      case "trackingno.": return pick(r, ["trackingNo", "trackingNumber"]);
      case "shipmentno.": return pick(r, ["shipmentNo", "number"]);
      case "origin": return pick(r, ["origin"]);
      case "destination": return pick(r, ["destination"]);
      case "carrier": return pick(r, ["carrier"]);
      case "bundlename": return pick(r, ["name"]);
      case "components": case "qtyused": return Array.isArray(r.items) ? r.items.filter(function (x) { return x && (x.item || x.qtyUsed); }).length + " item(s)" : "";
      case "buycost": return pick(r, ["buyPrice"]);
      case "sellprice": return pick(r, ["sellPrice"]);
      case "bank": return pick(r, ["bankName", "bank", "bankIndex"]);
      case "type": return pick(r, ["type", "adjustmentType"]);
      case "chartofaccount": return pick(r, ["accountCode", "account"]);
      case "reference": case "referenceno.": return pick(r, ["ref", "reference"]);
      case "taxtype": return pick(r, ["type"]);
      case "mode": return pick(r, ["method", "mode"]);
      case "amount": return pick(r, ["amount"]);
      case "totaldebit": return Array.isArray(r.entries) ? r.entries.reduce(function (a, x) { return a + (parseFloat(x.debit) || 0); }, 0) : (Array.isArray(r.lines) ? r.lines.reduce(function (a, x) { return a + (parseFloat(x.debit) || 0); }, 0) : "");
      case "totalcredit": return Array.isArray(r.entries) ? r.entries.reduce(function (a, x) { return a + (parseFloat(x.credit) || 0); }, 0) : (Array.isArray(r.lines) ? r.lines.reduce(function (a, x) { return a + (parseFloat(x.credit) || 0); }, 0) : "");
      case "startdate": return pick(r, ["startDate", "date"]);
      case "frequency": return pick(r, ["frequency"]);
      case "account": return pick(r, ["account", "creditNoteAccount", "chartAccount", "category"]);
      case "code": return pick(r, ["code"]);
      case "parent": return pick(r, ["parentName"]);
      case "parentcode": return pick(r, ["parentCode"]);
      case "opening": return pick(r, ["amount"]);
      case "employeeid": return pick(r, ["empID"]);
      case "basic": return pick(r, ["basicPay"]);
      case "house": return pick(r, ["houseAllowance"]);
      case "transport": return pick(r, ["transportAllowance"]);
      case "overtime": return pick(r, ["overtimePay"]);
      case "bonus": return pick(r, ["bonusPay"]);
      case "other": return pick(r, ["otherBenefits"]);
      case "gross": return pick(r, ["grossPay"]);
      case "loandeductions": return pick(r, ["totalLoanDeductions"]);
      case "terms(days)": case "terms": return pick(r, ["netDays", "termDays"]);
      case "primaryemail": return pick(r, ["emailPrimary", "email"]);
      case "phone": return pick(r, ["phone"]);
      case "currency": return pick(r, ["currency"]);
      case "location": return pick(r, ["location"]);
      case "driver": return pick(r, ["driver"]);
      case "deliveryoption": return pick(r, ["deliveryOption"]);
      case "truckno.": return pick(r, ["truckNumber"]);
      case "trackno.": return pick(r, ["trackNumber"]);
      default: {
        var camel = norm(h).replace(/[^a-z0-9 ]/g, "").replace(/ (\w)/g, function (_, c) { return c.toUpperCase(); });
        return pick(r, [camel]);
      }
    }
  }
  function label(r) {
    return pick(r, ["name", "empID", "invoiceNoBase", "creditNumber", "deliveryNumber", "invoiceNumber", "purchaseReturnNumber", "customerName", "supplierName", "reference", "description"]) || "Untitled draft";
  }

  function restoreBulk(rec) {
    var tab = document.querySelector('[onclick*="bulkInvoicingTab"]');
    if (typeof window.showTab === "function") window.showTab("bulkInvoicingTab");
    function set(id, val) { var el = document.getElementById(id); if (el && val != null) { el.value = val; el.dispatchEvent(new Event("change", { bubbles: true })); } }
    set("bulkInvoiceDate", rec.date); set("bulkInvoiceNumber", rec.invoiceNoBase); set("bulkInvoiceNetDays", rec.netDays);
    set("bulkInvoiceCurrency", rec.currency); set("bulkInvoiceCurrencyRate", rec.rate); set("bulkChartAccountSelect", rec.account); set("bulkInvoiceSalesPerson", rec.salesPerson);
    var c = document.getElementById("bulkInvoiceCustomers");
    if (c && Array.isArray(rec.customers)) Array.prototype.forEach.call(c.options, function (o) { o.selected = rec.customers.indexOf(o.value) >= 0; });
    try {
      window.bulkInvoiceItems = Array.isArray(rec.items) ? JSON.parse(JSON.stringify(rec.items)) : [];
      if (typeof window.renderBulkInvoiceItems === "function") window.renderBulkInvoiceItems();
      if (typeof window.calculateBulkInvoiceTotals === "function") window.calculateBulkInvoiceTotals();
    } catch (_) {}
  }

  function process(cfg) {
    var tbody = document.getElementById(cfg.id);
    if (!tbody) return;
    var table = tbody.closest("table");
    if (!table || !visible(table)) return;
    var col = ensureStatusColumn(table, cfg);
    if (!col) return;
    var ths = headers(table);
    var numIdx = numIndex(table, cfg);
    var mains = cfg.mains.map(read);
    var idle = cfg.idle || "Posted";

    /* a) status cell for every normal row */
    Array.prototype.forEach.call(tbody.rows, function (tr) {
      if (tr.hasAttribute("data-acx-dr") || tr.hasAttribute("data-acx-draft")) return;
      var cells = tr.cells;
      if (cells.length < 3 || (cells.length === 1)) return;               /* "no records" row */
      var st = statusOfRow(cells, numIdx, cfg, mains);
      if (col.added) {
        var cell = tr.querySelector(":scope > td[data-acx-status]");
        if (!cell) {
          cell = document.createElement("td");
          cell.className = "p-2 border";
          cell.setAttribute("data-acx-status", "1");
          tr.insertBefore(cell, cells[col.idx] || null);
        }
        var html = st === "Draft" ? BADGE : esc(st.indexOf("s:") === 0 ? st.slice(2).replace(/^./, function (c) { return c.toUpperCase(); }) : idle);
        if (cell.getAttribute("data-acx-v") !== html) { cell.innerHTML = html; cell.setAttribute("data-acx-v", html); }
      } else if (cells[col.idx]) {
        var c2 = cells[col.idx];
        var t2 = norm(c2.textContent);
        if ((st === "Draft" || t2 === "draft") && !c2.querySelector(".acx-draft-badge")) c2.innerHTML = BADGE;
      }
    });

    /* a2) generic "Save as Draft" rows (acxUniversalDrafts): put the Draft badge in the Status column */
    Array.prototype.forEach.call(tbody.querySelectorAll("tr[data-acx-draft]"), function (tr) {
      if (tr.cells.length !== ths.length || !tr.cells[col.idx]) return;
      if (!tr.cells[col.idx].querySelector(".acx-draft-badge")) tr.cells[col.idx].innerHTML = BADGE;
      var pill = tr.cells[0] && tr.cells[0].querySelector("span");
      if (pill && /^draft$/i.test(pill.textContent.trim())) pill.remove();
    });

    /* b) drafts that live in a separate store: show them as rows with Status = Draft */
    var list = [];
    (cfg.drafts || []).forEach(function (k) { read(k).forEach(function (r, i) { if (r && typeof r === "object") list.push({ key: k, index: i, rec: r }); }); });
    (cfg.mainDrafts || []).forEach(function (k) { read(k).forEach(function (r, i) { if (isDraft(r)) list.push({ key: k, index: i, rec: r, inMain: true }); }); });
    var sig = list.map(function (d) { return d.key + d.index + (d.rec.id || ""); }).join("|");
    var have = tbody.querySelectorAll("tr[data-acx-dr]");
    if (have.length === list.length && (!have.length || have[0].getAttribute("data-acx-sig") === sig)) return;
    Array.prototype.forEach.call(have, function (r) { r.remove(); });
    list.slice().reverse().forEach(function (d) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-acx-dr", d.key + "|" + d.index);
      tr.setAttribute("data-acx-sig", sig);
      tr.style.background = "#fffbeb";
      var html = "";
      var allHeads = headers(table);
      allHeads.forEach(function (th, i) {
        var h = th.textContent.trim();
        if (i === col.idx) { html += '<td class="p-2 border">' + BADGE + "</td>"; return; }
        if (!h && i === 0) { html += '<td class="p-2 border"></td>'; return; }
        if (/^actions?$/i.test(h)) {
          html += '<td class="p-2 border whitespace-nowrap">' +
            ((d.key === "bulkInvoiceDrafts" || (cfg.edit && cfg.edit[d.key])) ? '<button type="button" class="bg-blue-900 text-white px-2 py-1 rounded text-xs mr-1" data-acx-dr-open="' + esc(d.key + "|" + d.index) + '">Edit</button>' : "") +
            '<button type="button" class="bg-gray-300 text-gray-800 px-2 py-1 rounded text-xs" data-acx-dr-del="' + esc(d.key + "|" + d.index) + '">Delete</button></td>';
          return;
        }
        var v = valueFor(h, d.rec);
        if (v === "" && i === (numIdx >= 0 ? numIdx : 1)) v = label(d.rec);
        html += '<td class="p-2 border">' + (v === "" ? '<span style="color:#9ca3af">—</span>' : esc(v)) + "</td>";
      });
      tr.innerHTML = html;
      tbody.insertBefore(tr, tbody.firstChild);
    });
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-acx-dr-del],[data-acx-dr-open]") : null;
    if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    var del = t.getAttribute("data-acx-dr-del");
    var ref = (del || t.getAttribute("data-acx-dr-open")).split("|");
    var key = ref[0], i = Number(ref[1]);
    var tb = t.closest("tbody");
    var cfg = null;
    T.forEach(function (c) { if (tb && c.id === tb.id) cfg = c; });
    var rows = read(key);
    if (del) {
      if (!window.confirm("Delete this draft? This cannot be undone.")) return;
      if (!isArrayKey(key)) localStorage.removeItem(key);              /* single-record draft */
      else { rows.splice(i, 1); localStorage.setItem(key, JSON.stringify(rows)); }
      var refresh = { earnings: "renderEarnings" }[key];
      if (refresh && typeof window[refresh] === "function") { try { window[refresh](); } catch (_) {} }
      tick();
    } else if (key === "bulkInvoiceDrafts" && rows[i]) {
      restoreBulk(rows[i]);
    } else if (cfg && cfg.edit && cfg.edit[key] && typeof window[cfg.edit[key]] === "function") {
      try { window[cfg.edit[key]](key === "earnings" ? i : undefined); } catch (e) { alert("This draft could not be opened: " + (e.message || e)); }
    }
  }, true);

  function tick() {
    try { removeDraftsUI(); T.forEach(process); } catch (e) { /* never break the app */ }
  }
  var timer = null;
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; tick(); }, 150); }
  function start() {
    tick();
    try { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    setInterval(tick, 2000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
