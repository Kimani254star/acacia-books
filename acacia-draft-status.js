/* Acacia Books — drafts live inside their own module tables.
   1. Removes the "📝 Drafts" submodule from every hub sidebar (and the central Drafts page).
   2. Every module table gets a Status column (added only where it is missing).
   3. A document saved as Draft shows "Draft" in that Status column instead of Paid / Due / Overdue.
   4. Drafts that used to live in a separate store (credit notes, deliveries, sales returns, bulk invoices,
      purchase returns, customers, suppliers) are listed in the module table with Status = Draft.
   5. Draft rows get an Edit button that reopens the draft in its own form (Tax Payment, Manual Transaction,
      Chart of Accounts, Stock Transfer, Shipment, Bundle, Bank Account). The draft is removed only after the
      real Save succeeds.
   6. Bank Accounts and both Costing screens show their drafts inside the main list with Status = Draft.
   7. Gross Payroll, Payslips and Attendance get a Status column.
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
    { id: "movementTableBody",       mains: ["stockMovements", "movements"], drafts: ["stockTransferDrafts"], num: "Transit No.", edit: { stockTransferDrafts: "__acxEditTransfer" } },
    { id: "shipmentTableBody",       mains: ["shipments"],         drafts: ["shipmentDraft"], num: "Shipment No.", edit: { shipmentDraft: "__acxEditShipment" } },
    { id: "bundleTableBody",         mains: ["bundles"],           drafts: ["bundleDrafts"], idle: "Active", edit: { bundleDrafts: "__acxEditBundle" } },
    /* Funds */
    { id: "manualTransactionLogTable", mains: ["manualTransactions"], drafts: ["manualTxDrafts"], edit: { manualTxDrafts: "__acxEditManualTx" } },
    { id: "operationalCostsTable",   mains: ["operationalCosts"] },
    /* Accounting */
    { id: "manualJournalBody",       mains: ["manualJournals"],    drafts: ["manualJournalDraft"], num: "Reference", edit: { manualJournalDraft: "restoreJournalDraft" } },
    { id: "recurringJournalList",    mains: ["recurringJournals"], drafts: ["recurringJournalDraft"], num: "Reference No.", edit: { recurringJournalDraft: "restoreRecurringJournalDraft" } },
    { id: "taxPaymentsTable",        mains: ["taxPayments"],       drafts: ["taxPaymentDrafts"], edit: { taxPaymentDrafts: "__acxEditTax" } },
    { id: "currencyAdjustmentsTable", mains: ["currencyAdjustments"], drafts: ["currencyAdjustmentDraft"], num: "Reference", edit: { currencyAdjustmentDraft: "loadAdjustmentDraft" } },
    { id: "taxAdjustmentsTable",     mains: ["taxAdjustments"] },
    { id: "accountsTable",           mains: ["chartOfAccounts", "accounts"], drafts: ["chartOfAccountsDrafts"], idle: "Active", edit: { chartOfAccountsDrafts: "__acxEditCOA" } },
    { id: "nonCurrentAssetsTableBody", mains: ["nonCurrentAssets"] },
    { id: "equityTableBody",         mains: ["equityRecords", "equity"] },
    { id: "currentAccountsTableBody", mains: ["currentAccounts"] },
    /* Payroll (earnings drafts live inside the earnings list itself, hidden until approved) */
    { id: "employeesTable",          mains: ["employees"],         idle: "Active" },
    { id: "earningsTable",           mains: ["earnings"],          mainDrafts: ["earnings"], edit: { earnings: "editEarning" }, idle: "Approved" },
    { id: "grossPayrollTable",       mains: ["payrollRecords"],    idle: "Processed" },
    { id: "bulkPayslipTableBody",    mains: ["payrollRecords"],    idle: "Generated" },
    { id: "attendanceTableBody",     mains: ["attendance"],        idle: "Recorded" }
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
      try {
        var efn = cfg.edit[key];
        var rec0 = isArrayKey(key) ? rows[i] : read(key)[0];
        if (efn.indexOf("__acx") === 0) window[efn](i, rec0);
        else window[efn](key === "earnings" ? i : undefined);
      } catch (e) { alert("This draft could not be opened: " + (e.message || e)); }
    }
  }, true);


  /* ---------- 5. Edit buttons: reopen a draft in its own form ---------- */
  var EDITING = null;                                   /* {kind, key, fp, at} - the draft currently open for editing */
  function byId(id) { return document.getElementById(id); }
  function fire(el, t) { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (_) {} }
  function setVal(id, val, add) {
    var el = byId(id);
    if (!el || val == null) return;
    if (el.type === "checkbox") { el.checked = !!val; fire(el, "change"); return; }
    val = String(val);
    if (el.tagName === "SELECT" && add && val !== "") {
      var has = false;
      for (var i = 0; i < el.options.length; i++) if (el.options[i].value === val) { has = true; break; }
      if (!has) { var o = document.createElement("option"); o.value = val; o.textContent = val; el.appendChild(o); }
    }
    el.value = val; fire(el, "input"); fire(el, "change");
  }
  function fill(map, add) { Object.keys(map).forEach(function (id) { setVal(id, map[id], add); }); }
  /* the app fills some selects a moment after a tab opens, so the values are applied again twice */
  function later(fn) { [0, 200, 600].forEach(function (ms) { setTimeout(function () { try { fn(); } catch (_) {} }, ms); }); }
  function openTab(t) {
    if (typeof window.showTab === "function") window.showTab(t);
    else { var el = byId(t); if (el) el.classList.remove("hidden"); }
  }
  function begin(kind, key, rec) { EDITING = { kind: kind, key: key, fp: JSON.stringify(rec || {}), at: Date.now() }; }
  function val0(v) { return (v === 0 || v === "0") ? "" : v; }
  function openFundsAccounts() {
    openTab("fundsTab");
    if (typeof window.showFundsTab === "function") { try { window.showFundsTab("accounts"); } catch (_) {} }
  }

  window.__acxEditTax = function (i, rec) {
    rec = rec || {}; begin("tax", "taxPaymentDrafts", rec);
    openTab("taxPaymentsTab");
    if (typeof window.showSingleTax === "function") window.showSingleTax();
    later(function () { fill({ taxDate: rec.date, taxType: rec.type, taxPaymentMode: rec.method, taxBank: rec.bankIndex, taxAmount: val0(rec.amount), taxRef: rec.reference }); });
  };
  window.__acxEditManualTx = function (i, rec) {
    rec = rec || {}; begin("manualtx", "manualTxDrafts", rec);
    openFundsAccounts();
    var list = []; try { list = JSON.parse(localStorage.getItem("banks") || "[]"); } catch (_) {}
    var bi = -1; list.forEach(function (b, n) { if (b && b.name === rec.bankName) bi = n; });
    var sec = byId("bankDetailsSection");
    var openNow = sec && !sec.classList.contains("hidden") && localStorage.getItem("selectedBankName") === rec.bankName;
    if (!openNow && bi >= 0 && typeof window.viewBank === "function") { try { window.viewBank(bi); } catch (_) {} }
    if (typeof window.fundsShowSection === "function") { try { window.fundsShowSection("funds-anchor-addtx"); } catch (_) {} }
    later(function () { fill({ manualBank: rec.bankName, manualType: rec.type, manualAccount: rec.accountCode, manualAmount: rec.amount, manualDate: rec.date, manualRef: rec.ref }); });
  };
  window.__acxEditCOA = function (i, rec) {
    rec = rec || {}; begin("coa", "chartOfAccountsDrafts", rec);
    openTab("chartOfAccountsTab");
    var w = byId("addAccountFormWrap"); if (w) w.classList.remove("hidden");
    try { editingIndex = null; } catch (_) {}
    later(function () {
      fill({ accountName: rec.name, accountCode: rec.code, accountCategory: rec.category, accountType: rec.type, parentAccountName: rec.parentName, parentAccountCode: rec.parentCode, accountAmount: val0(rec.amount) });
      setVal("accountIsParent", rec.isParent); setVal("accountIsSub", rec.isSub);
    });
  };
  window.__acxEditTransfer = function (i, rec) {
    rec = rec || {}; begin("transfer", "stockTransferDrafts", rec);
    openTab("movementTab");
    if (typeof window.trToggleForm === "function") { try { window.trToggleForm(true); } catch (_) {} }
    else { var f = byId("trForm"); if (f) f.classList.remove("hidden"); }
    later(function () {
      setVal("actType", "transfer");
      fill({ transferItem: rec.item, fromLocation: rec.from, toLocation: rec.to, transferQuantity: val0(rec.quantity), transferDate: rec.transferDate || rec.effectiveDate, actNotes: rec.reason }, true);
    });
  };
  window.__acxEditShipment = function (i, rec) {
    rec = rec || {}; begin("shipment", "shipmentDraft", rec);
    openTab("shipmentsTab");
    later(function () { fill({ shipmentCustomer: rec.customer, shipmentDate: rec.date, shipmentItem: rec.item, shipmentOrigin: rec.origin, shipmentDestination: rec.destination, shipmentCarrier: rec.carrier, shipmentTrackingNo: rec.trackingNo }, true); });
  };
  window.__acxEditBundle = function (i, rec) {
    rec = rec || {}; begin("bundle", "bundleDrafts", rec);
    openTab("BundleItems");
    var items = Array.isArray(rec.items) ? rec.items.slice(0, 3) : [];
    for (var n = 2; n <= items.length; n++) if (!byId("bundleItem" + n) && typeof window.addBundleRow === "function") { try { window.addBundleRow(); } catch (_) {} }
    later(function () {
      var m = { bundleFinalName: rec.name, bundleQty: val0(rec.qty), bundleBuyPrice: val0(rec.buyPrice), bundleSellPrice: val0(rec.sellPrice), bundleBuyVAT: rec.buyVAT, bundleSellVAT: rec.sellVAT, bundleToWarehouse: rec.toWarehouse };
      items.forEach(function (it, k) { var n = k + 1; m["bundleFromWarehouse" + n] = it.warehouse; m["bundleItem" + n] = it.item; m["bundleQtyUsed" + n] = val0(it.qtyUsed); });
      fill(m, true);
    });
  };
  window.__acxEditBank = function (i, rec) {
    rec = rec || {}; begin("bank", "bankDrafts", rec);
    openFundsAccounts();
    var f = byId("bankFormSection"), l = byId("bankListSection");
    if (f) f.classList.remove("hidden");
    if (l) l.classList.add("hidden");
    later(function () { fill({ bankName: rec.name, accountNumber: rec.accountNumber, initialBalance: rec.balance, bankCurrency: rec.currency, creditAccount: rec.chartAccount }, true); });
  };

  /* A draft that was reopened is removed only when the module's own Save really changed its records. */
  var FINALS = { tax: "addTaxPayment", manualtx: "manualTransaction", coa: "addAccount", transfer: "saveTransfer", shipment: "addShipment", bundle: "createBundleItem", bank: "addBank" };
  var STORES = { tax: /taxPayments$/, manualtx: /manualTransactions$/, coa: /chartOfAccounts$/, transfer: /ovements$/, shipment: /shipments$/, bundle: /bundles$/, bank: /banks$/ };
  function snap(kind) {
    var out = {}, re = STORES[kind];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && re.test(k) && !/draft/i.test(k)) out[k] = localStorage.getItem(k);
    }
    return out;
  }
  function differs(a, b) {
    var ks = Object.keys(a).concat(Object.keys(b));
    for (var i = 0; i < ks.length; i++) if (a[ks[i]] !== b[ks[i]]) return true;
    return false;
  }
  function gv(id) { var e = byId(id); return e ? String(e.value == null ? "" : e.value).trim() : ""; }
  function sameText(a, b) { return String(a == null ? "" : a).trim() === String(b == null ? "" : b).trim(); }
  /* does the form still hold this draft? (stops an old, abandoned Edit from deleting a draft on an unrelated save) */
  function formMatches(kind, r) {
    switch (kind) {
      case "tax": return r.reference ? sameText(gv("taxRef"), r.reference) : sameText(gv("taxAmount"), r.amount);
      case "manualtx": return r.ref ? sameText(gv("manualRef"), r.ref) : sameText(gv("manualAmount"), r.amount);
      case "coa": return sameText(gv("accountCode"), r.code) || sameText(gv("accountName"), r.name);
      case "transfer": return sameText(gv("transferItem"), r.item);
      case "shipment": return r.trackingNo ? sameText(gv("shipmentTrackingNo"), r.trackingNo) : sameText(gv("shipmentItem"), r.item);
      case "bundle": return sameText(gv("bundleFinalName"), r.name);
      case "bank": return sameText(gv("bankName"), r.name) && sameText(gv("accountNumber"), r.accountNumber);
    }
    return false;
  }
  function findDraft(ed) {
    var rows = read(ed.key);
    for (var i = 0; i < rows.length; i++) if (JSON.stringify(rows[i]) === ed.fp) return { index: i, rec: rows[i], arr: isArrayKey(ed.key) };
    return null;
  }
  function syncBankMemory() {
    try {                                                /* app-2.js keeps its own in-memory copy of bankDrafts */
      if (typeof bankDrafts !== "undefined" && Array.isArray(bankDrafts)) {
        bankDrafts.length = 0;
        Array.prototype.push.apply(bankDrafts, read("bankDrafts"));
      }
    } catch (_) {}
  }
  function dropDraft(ed) {
    if (EDITING !== ed) return;
    var f = findDraft(ed);
    if (!f) { EDITING = null; return; }
    if (!f.arr) localStorage.removeItem(ed.key);
    else { var rows = read(ed.key); rows.splice(f.index, 1); localStorage.setItem(ed.key, JSON.stringify(rows)); }
    if (ed.key === "bankDrafts") syncBankMemory();
    EDITING = null;
    tick();
  }
  function wrapFinals() {
    Object.keys(FINALS).forEach(function (kind) {
      var fn = FINALS[kind], f = window[fn];
      if (typeof f !== "function" || f.__acxW) return;
      var w = function () {
        var ed = EDITING, rec = null, match = false, before = null;
        if (ed && ed.kind === kind && Date.now() - ed.at < 6 * 3600 * 1000) {
          var d = findDraft(ed);
          if (d && formMatches(kind, d.rec)) { match = true; before = snap(kind); }
        }
        var res = f.apply(this, arguments);
        if (match) {
          [800, 2800].forEach(function (ms) {
            setTimeout(function () { try { if (EDITING === ed && differs(before, snap(kind))) dropDraft(ed); } catch (_) {} }, ms);
          });
        }
        return res;
      };
      w.__acxW = true;
      window[fn] = w;
    });
  }

  /* ---------- 6a. Bank Accounts (cards): drafts + Status chip ---------- */
  var CHIP = 'display:inline-block;border-radius:9999px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:6px;vertical-align:middle;color:#fff;background:';
  function processBank() {
    var box = byId("bankTable");
    if (!box || !visible(box)) return;
    var drafts = read("bankDrafts").filter(function (r) { return r && typeof r === "object"; });
    /* Status chip on the real accounts */
    Array.prototype.forEach.call(box.querySelectorAll(".funds-bank-card:not([data-acx-bd])"), function (card) {
      if (card.querySelector("[data-acx-chip]")) return;
      var nm = card.querySelector(".funds-bank-card-name");
      if (!nm) return;
      var chip = document.createElement("span");
      chip.setAttribute("data-acx-chip", "1");
      chip.setAttribute("style", CHIP + "#16a34a");
      chip.textContent = card.classList.contains("is-system") ? "System" : "Active";
      nm.appendChild(chip);
    });
    var sig = JSON.stringify(drafts);
    var have = box.querySelectorAll("[data-acx-bd]");
    if (box.getAttribute("data-acx-bsig") === sig && have.length === drafts.length) return;
    Array.prototype.forEach.call(have, function (n) { n.remove(); });
    box.setAttribute("data-acx-bsig", sig);
    drafts.slice().reverse().forEach(function (d, rev) {
      var idx = drafts.length - 1 - rev;
      var card = document.createElement("div");
      card.className = "funds-bank-card";
      card.setAttribute("data-acx-bd", String(idx));
      card.style.background = "#fffbeb";
      var sub = [d.chartAccount || "-", d.accountNumber || "-", d.currency].filter(Boolean).join(" · ");
      var bal = (d.balance === "" || d.balance == null || isNaN(parseFloat(d.balance))) ? "" : (d.currency || "") + " " + Number(d.balance).toLocaleString();
      var btn = "bg-blue-900 text-white px-2 py-1 rounded text-xs";
      card.innerHTML =
        '<div class="funds-bank-card-main"><div class="funds-bank-card-name">' + esc(d.name || "Untitled draft") + BADGE.replace('style="', 'style="margin-left:6px;') + '</div><div class="funds-bank-card-sub">' + esc(sub) + "</div></div>" +
        '<div class="funds-bank-card-balance">' + esc(bal) + "</div>" +
        '<div class="funds-bank-card-actions">' +
        '<button type="button" data-acx-bd-act="edit" data-i="' + idx + '">Edit</button>' +
        '<button type="button" data-acx-bd-act="approve" data-i="' + idx + '">Approve</button>' +
        '<button type="button" data-acx-bd-act="delete" data-i="' + idx + '">Delete</button></div>';
      box.insertBefore(card, box.firstChild);
    });
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-acx-bd-act]") : null;
    if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    var act = t.getAttribute("data-acx-bd-act"), i = Number(t.getAttribute("data-i"));
    var rows = read("bankDrafts"), rec = rows[i];
    if (!rec) return;
    syncBankMemory();
    if (act === "edit") window.__acxEditBank(i, rec);
    else if (act === "approve") {
      if (typeof window.approveDraft === "function") { try { window.approveDraft(i); } catch (e) { alert("This draft could not be approved: " + (e.message || e)); } }
      tick();
    } else if (act === "delete") {
      if (!window.confirm("Delete this draft? This cannot be undone.")) return;
      rows.splice(i, 1); localStorage.setItem("bankDrafts", JSON.stringify(rows)); syncBankMemory(); tick();
    }
  }, true);

  /* ---------- 6b. Costing + Bulk Costing: drafts inside the main list ---------- */
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function dp() { try { return window.__getDecimalPlaces ? window.__getDecimalPlaces() : 2; } catch (_) { return 2; } }
  function readObj(k) { try { var v = JSON.parse(localStorage.getItem(k) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function hideCard(id) { var c = byId(id); if (c && c.style.display !== "none") c.style.display = "none"; }
  function syncExtraRows(tbody, attr, rows, sig) {
    var have = tbody.querySelectorAll("tr[" + attr + "]");
    if (tbody.getAttribute(attr + "-sig") === sig && have.length === rows.length) return false;
    Array.prototype.forEach.call(have, function (r) { r.remove(); });
    tbody.setAttribute(attr + "-sig", sig);
    rows.slice().reverse().forEach(function (html) {
      var tr = document.createElement("tr");
      tr.setAttribute(attr, "1"); tr.className = "border-b"; tr.style.background = "#fffbeb";
      tr.innerHTML = html;
      tbody.insertBefore(tr, tbody.firstChild);
    });
    return true;
  }
  function dropEmptyRow(tbody, attr) {                   /* the "No ... records" placeholder */
    var real = Array.prototype.filter.call(tbody.rows, function (r) { return !r.hasAttribute(attr); });
    if (real.length === 1 && real[0].cells.length === 1) real[0].remove();
  }
  function processCosting() {
    var tbody = byId("costingTableBody");
    if (!tbody) return;
    hideCard("costingDraftsCard");
    if (!visible(tbody.closest("table") || tbody)) return;
    var all = readObj("costingData"), rows = [], sig = [];
    all.forEach(function (t, i) {
      if (!t || String(t.status || "").toLowerCase() !== "draft") return;
      var m = num(t.effMargin), cls = m >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold", d = dp();
      sig.push(t.id + ":" + (t.updatedAt || ""));
      rows.push(
        '<td class="p-2">' + esc(t.product) + '</td><td class="p-2">KSh ' + num(t.buying).toFixed(d) + '</td><td class="p-2">KSh ' + num(t.extra).toFixed(d) + '</td><td class="p-2">KSh ' + num(t.total).toFixed(d) + "</td>" +
        '<td class="p-2">' + esc(t.margin || 0) + '%</td><td class="p-2">Markup: ' + esc(t.markup || 0) + "%<br>Target Margin: " + esc(t.targetMargin || 0) + '%</td><td class="p-2">Discount: ' + esc(t.discount || 0) + "%</td>" +
        '<td class="p-2">KSh ' + num(t.sellingStandard).toFixed(d) + '<br><small>(Standard)</small></td><td class="p-2">KSh ' + num(t.sellingAdvanced).toFixed(d) + '<br><small>(Advanced)</small></td><td class="p-2">KSh ' + num(t.discountedPrice).toFixed(d) + '<br><small>(After Discount)</small></td>' +
        '<td class="p-2 ' + cls + '">' + m.toFixed(d) + '%</td><td class="p-2">' + BADGE + '</td><td class="p-2">' + esc(t.date || "") + "</td>" +
        '<td class="p-2"><div class="flex gap-2 flex-wrap"><button type="button" onclick="editCosting(' + i + ')" class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800">Edit</button>' +
        '<button type="button" onclick="openCostingApproval(\'' + esc(t.id) + '\')" class="bg-green-700 text-white font-bold px-1 py-1 rounded hover:bg-green-600">Review &amp; Approve</button>' +
        '<button type="button" onclick="deleteCosting(' + i + ')" class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800">Delete</button></div></td>');
    });
    syncExtraRows(tbody, "data-acx-cdraft", rows, sig.join("|"));
    if (rows.length) dropEmptyRow(tbody, "data-acx-cdraft");
  }
  function processBulkCosting() {
    var tbody = byId("bulkCostingSummaryBody");
    if (!tbody) return;
    hideCard("bulkDraftsCard");
    if (!visible(tbody.closest("table") || tbody)) return;
    var all = readObj("bulkConsignments"), rows = [], sig = [];
    all.forEach(function (t, i) {
      if (!t || String(t.status || "").toLowerCase() !== "draft") return;
      var tp = num(t.totalProfit), when = t.timestamp ? new Date(t.timestamp).toLocaleDateString() : (t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "");
      sig.push(t.id + ":" + (t.updatedAt || ""));
      rows.push(
        '<td class="border p-2">' + esc(t.consignmentName || "Consignment " + (i + 1)) + '</td><td class="border p-2">' + esc(t.currency || "") + '</td><td class="border p-2 text-right">' + esc(t.exchangeRate || "") + "</td>" +
        '<td class="border p-2 text-right">' + esc(t.totalCostKES || t.landedTotalKES || "") + '</td><td class="border p-2 text-right">' + esc(t.totalQty || "") + '</td><td class="border p-2 text-right">' + esc(t.costPerUnit || "") + "</td>" +
        '<td class="border p-2 text-right ' + (tp >= 0 ? "text-green-600" : "text-red-600") + ' font-semibold">' + (t.totalProfit !== undefined ? esc(t.totalProfit) : "—") + '</td><td class="border p-2 text-right">' + (t.avgMargin !== undefined ? esc(t.avgMargin) : "—") + "</td>" +
        '<td class="border p-2">' + BADGE + '</td><td class="border p-2">' + esc(when) + "</td>" +
        '<td class="border p-2"><div class="flex gap-1 flex-wrap"><button type="button" onclick="editBulkConsignment(' + i + ')" class="bg-blue-600 text-white px-1 py-1 rounded-lg hover:bg-blue-700">Edit</button>' +
        '<button type="button" onclick="openBulkApproval(\'' + esc(t.id) + '\')" class="bg-green-700 text-white px-1 py-1 rounded-lg hover:bg-green-600">Review &amp; Approve</button>' +
        '<button type="button" onclick="deleteBulkConsignment(' + i + ')" class="bg-blue-600 text-white px-1 py-1 rounded-lg hover:bg-blue-700">Delete</button></div></td>');
    });
    syncExtraRows(tbody, "data-acx-bdraft", rows, sig.join("|"));
    if (rows.length) dropEmptyRow(tbody, "data-acx-bdraft");
  }

  function tick() {
    try { removeDraftsUI(); T.forEach(process); wrapFinals(); processBank(); processCosting(); processBulkCosting(); } catch (e) { /* never break the app */ }
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
