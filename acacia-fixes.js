/* acacia-fixes.js — merged: acacia-fixes.js, -2, -3, -4 and acacia-contrast-fix.js = ALL Acacia fixes + contrast in ONE file */
/* ===================== acacia-fixes.js ===================== */
try{
/*!
 * acacia-fixes.js — fixes from "Acacia Books: Edit / Delete / Clone / Bulk Delete Audit" (6 Oct 2026)
 * Load LAST in index.html. It does not change any other file; it wraps / replaces handlers at runtime.
 *
 *  P1  Every bulk delete now loops the matching single delete (rollback of stock, bank, ledger,
 *      customer/supplier balances, recycle bin, permission + period-lock checks, filtered-index mapping).
 *      Per-item confirms/alerts are suppressed; ONE summary is shown at the end.
 *  P2  One shared afterChange() refresh, called after every save / edit / delete / clone / bulk handler.
 *  P3  Dead refresh names are mapped to the real functions (renderBills -> loadSupplierBills, etc.).
 *  P4  deleteBill removes the bill's Auto Journal and balance-sheet aggregates;
 *      saveSupplierBill (edit) removes the old Auto Journal and subtracts the old amount.
 *  P5  Clones: always a new id; permission check; posting clones (receipt, manual transaction,
 *      supplier payment, tax payment, operational cost, bill, invoice) are saved as UNPOSTED copies,
 *      so deleting a clone no longer reverses bank/stock/ledger effects that were never applied.
 *      Invoice clones drop sourceOrderId and fiscal (e-TIMS) fields.
 *  P6  "Clone Orders" / "Clone Recurring Invoices" now clone only the selected rows, with confirmation;
 *      cloned recurring invoices start paused.
 *  P7  Bulk customer / supplier delete respects the has-transactions guard (via single delete);
 *      permission check restored on deleteReceipt.
 *  P8  bulkDeleteProjectRevenue, bulkDeleteNonCurrentLiabilities, deleteRevenue get a safe fallback
 *      when the script that defines them is not loaded.
 *  P9  Old recurring invoices (made before the recurring flags existed) are tagged and linked to their
 *      template, so they leave Invoices and show under Recurring Invoices, like recurring bills.
 *  P10 Deleting a recurring invoice (single or bulk) now also handles the invoices it generated: delete them
 *      (full reversal like Delete Invoice: receivables, payments, ledger, stock, Recycle Bin) or keep them
 *      as normal invoices. Invoices left behind by templates deleted earlier are offered the same choice once.
 */
(function () {
  "use strict";
  if (window.__acaciaFixes) return;
  window.__acaciaFixes = { version: "2026-10-06" };

  /* ---------------- helpers ---------------- */
  var W = window;
  function fn(n) { return typeof W[n] === "function" ? W[n] : null; }
  function call(n) { var f = fn(n); if (!f) return; try { return f.apply(W, [].slice.call(arguments, 1)); } catch (e) { console.warn("[acacia-fixes] " + n + " failed", e); } }
  function ls(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function glob(name) { try { return (0, eval)("typeof " + name + "!=='undefined'?" + name + ":undefined"); } catch (e) { return undefined; } }
  function setGlob(name, val) { try { W.__acxTmp = val; (0, eval)(name + "=window.__acxTmp"); } catch (e) { W[name] = val; } finally { delete W.__acxTmp; } }
  function newId() { return (W.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function sameRec(a, b) {
    if (!a || !b) return false;
    if (a.id != null && a.id !== "" && b.id != null && b.id !== "") return String(a.id) === String(b.id);
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function hasPerm(tab, action, label) {
    var f = fn("requirePermission");
    if (!f) return true;
    try { return f(tab, action, label) !== false; } catch (e) { return true; }
  }
  function notLocked(modules, date) {
    if (!modules || !date || typeof W.assertNotLocked !== "function") return true;
    try { return W.assertNotLocked(modules, date) !== false; } catch (e) { return true; }
  }

  /* Run fn with confirm/alert/prompt/notifications silenced; returns captured messages */
  function quietly(work) {
    var saved = { c: W.confirm, a: W.alert, p: W.prompt, n: W.showNotification, t: W.notify };
    var msgs = [];
    W.confirm = function () { return true; };
    W.prompt = function (m, d) { return d != null ? d : "DELETE"; };
    W.alert = function (m) { msgs.push(String(m || "")); };
    if (saved.n) W.showNotification = function (m) { msgs.push(String(m || "")); };
    if (saved.t) W.notify = function (m) { msgs.push(String(m || "")); };
    W.__acxQuiet = true;
    try { work(); } finally {
      W.confirm = saved.c; W.alert = saved.a; W.prompt = saved.p;
      if (saved.n) W.showNotification = saved.n;
      if (saved.t) W.notify = saved.t;
      W.__acxQuiet = false;
    }
    return msgs;
  }

  /* ---------------- P3: dead refresh names -> real functions ---------------- */
  var ALIASES = {
    renderBills: "loadSupplierBills", renderSupplierBills: "loadSupplierBills",
    renderBulkBills: "loadBulkBills", renderGRN: "renderGRNTable",
    renderDeliveries: "renderDeliveryTable", renderSalesReturns: "renderSalesReturnList",
    renderInventorySummary: "renderInventoryTable", loadBanks: "renderBankTable",
    loadTransactions: "renderBankTable", renderBankList: "renderBankTable", renderBanks: "renderBankTable",
    renderDashboard: "loadDashboard", renderMovements: "renderMovementTable",
    renderSupplierTable: "renderSuppliers", renderCustomerTable: "renderCustomers",
    renderChartOfAccounts: "renderAccounts", renderPaymentsReceived: "renderReceipts",
    renderAdjustments: "renderBALog", renderAmendments: "renderAmendedWarehouseMovement",
    renderPayroll: "renderGrossPayroll", renderSupplierStatement: "renderSupplierStatementReport"
  };
  function installAliases() {
    Object.keys(ALIASES).forEach(function (dead) {
      if (typeof W[dead] === "function" && !W[dead].__acxAlias) return;
      var real = ALIASES[dead];
      if (typeof W[real] !== "function") return;
      var a = function () { var f = fn(real); return f ? f.apply(this, arguments) : undefined; };
      a.__acxAlias = true;
      W[dead] = a;
    });
  }

  /* ---------------- P2: shared afterChange() ---------------- */
  var REFRESH = [
    "loadDashboard", "updateDashboardTotals", "refreshDashboardCards",
    "recalculateCustomerReceivables", "updateAccountsPayable", "renderAccountsPayable",
    "renderBankTable", "updateBankSummary", "renderInventoryTable", "renderManualJournals",
    "renderAccounts", "renderReports", "refreshReports", "renderProfitLoss", "renderBalanceSheet",
    "renderTrialBalance", "renderCreditcontrolAnalysis"
  ];
  var refreshTimer = 0, refreshing = false;
  function afterChange() {
    if (refreshing) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshing = true;
      try {
        installAliases();
        REFRESH.forEach(function (n) { var f = fn(n); if (f) { try { f.__acxOrig ? f.__acxOrig() : f(); } catch (e) { console.warn("[acacia-fixes] refresh " + n, e); } } });
      } finally { refreshing = false; }
    }, 60);
  }
  W.afterChange = afterChange;

  var WRAP_RE = /^(save|add|edit|delete|bulkDelete|deleteSelected|clone|restore)[A-Z]/;
  var SKIP = /^(update(Dashboard|Bank|AccountsPayable|Profit|Balance|Total|Employee|Supplier|Customer|Lock|Chart)|addEventListener|saveInventory|savePOList|saveQuotes|save$|saveNonCurrent|saveSettings|savePreferences)/;
  function wrapAll() {
    Object.keys(W).forEach(function (n) {
      if (!WRAP_RE.test(n) || SKIP.test(n)) return;
      var f; try { f = W[n]; } catch (e) { return; }
      if (typeof f !== "function" || f.__acxAfter || REFRESH.indexOf(n) >= 0) return;
      var w = function () {
        var r = f.apply(this, arguments);
        if (!refreshing) {
          if (r && typeof r.then === "function") r.then(afterChange, afterChange); else afterChange();
        }
        return r;
      };
      Object.keys(f).forEach(function (k) { try { w[k] = f[k]; } catch (e) {} });
      w.__acxAfter = true; w.__acxOrig = f;
      try { W[n] = w; } catch (e) {}
    });
  }

  /* ---------------- P1: bulk delete = loop of single delete ---------------- */
  function checked(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel + ":checked")); }
  function attr(cb, a) { return a === "value" ? cb.value : cb.dataset[a]; }
  function rowIndex(cb) { var tr = cb.closest("tr"); return tr ? Array.prototype.indexOf.call(tr.parentNode.children, tr) : -1; }

  /* Each config:
     get()   -> full array            sel -> checkbox selector
     pick    -> "id:<attr>" | "index:<attr>" | "row" | function() -> ids
     view    -> name of filtered-view global used by single delete (index mapping)
     single  -> name of single delete;  arg -> "id" | "index" | function(rec, arr)
     modules -> period-lock module names;  label -> plural noun;  skip(rec) -> reason to skip */
  var BULK = {
    bulkDeleteInvoices: { get: function () { return ls("invoices", []); }, sel: ".invoiceCheckbox", pick: "id:value", single: "deleteInvoice", arg: "id", modules: ["Invoices", "Sales"], label: "invoice(s)" },
    bulkDeleteQuotes: { get: function () { return ls("quotes", []); }, sel: ".quoteCheck", pick: "index:index", view: "__acxQuotesView", single: "deleteQuote", arg: "index", modules: ["Quotes", "Sales"], label: "quote(s)" },
    bulkDeleteOrders: { get: function () { return ls("orders", []); }, sel: ".orderCheck", pick: "index:index", view: "__acxOrdersView", single: "deleteOrder", arg: "index", modules: ["Orders", "Sales"], label: "order(s)" },
    bulkDeleteCreditNotes: { get: function () { return ls("creditNotes", []); }, pick: function () { return call("getSelectedCreditIds") || []; }, single: "deleteCreditNote", arg: "id", modules: ["Credit Notes", "Sales"], label: "credit note(s)" },
    bulkDeleteSalesReturns: { get: function () { return ls("salesReturns", []); }, sel: ".salesReturnCheck", pick: "index:index", single: "deleteSalesReturn", arg: "index", modules: ["Sales Returns", "Sales"], label: "sales return(s)" },
    bulkDeleteDeliveries: { get: function () { return ls("deliveries", []); }, sel: ".deliveryCheck", pick: "id:id", single: "deleteDelivery", arg: "index", modules: ["Delivery", "Sales"], label: "deliver(ies)" },
    bulkDeleteReceipts: { get: function () { return ls("receipts", []); }, sel: ".receiptCheck", pick: "id:id", single: "deleteReceipt", arg: "id", modules: ["Receipts", "Payments", "Sales"], label: "receipt(s)" },
    bulkDeleteJournals: { get: function () { return ls("manualJournals", []); }, sel: ".journal-select", pick: "index:index", single: "deleteJournal", arg: "index", modules: ["Manual Journals", "Journals"], label: "journal(s)",
      skip: function (r) { return (W.__acxIsSystemJournal && W.__acxIsSystemJournal(r)) ? "system-posted journal (delete it individually)" : ""; } },
    bulkDeleteCustomers: { get: function () { return ls("customers", []); }, sel: ".customerCheck", pick: "id:id", single: "deleteCustomer", arg: "index", label: "customer(s)" },
    bulkDeleteManualTransactions: { get: function () { return ls("manualTransactions", []); }, sel: ".manual-checkbox", pick: "id:id", single: "deleteManualTransaction", arg: "id", modules: ["Banking", "Manual Transactions"], label: "transaction(s)" },
    bulkDeleteAccounts: { get: function () { return ls("chartOfAccounts", []); }, sel: ".account-select", pick: "index:index", single: "deleteAccount", arg: "index", label: "account(s)" },
    bulkDeleteCurrencyAdjustments: { get: function () { return ls("currencyAdjustments", []); }, sel: ".currency-adjustment-select", pick: "index:index", single: "deleteCurrencyAdjustment", arg: "index", modules: ["Currency Adjustments"], label: "adjustment(s)" },
    bulkDeleteTaxAdjustments: { get: function () { return ls("taxAdjustments", []); }, sel: ".tax-adjustment-select", pick: "index:index", single: "deleteTaxAdjustment", arg: "index", modules: ["Tax Adjustments"], label: "adjustment(s)" },
    bulkDeleteEquity: { get: function () { return ls("equityRecords", []); }, sel: ".equity-select", pick: "index:index", single: "deleteEquity", arg: "index", modules: ["Equity"], label: "equity record(s)" },
    bulkDeleteAdjustments: { get: function () { return ls("baLog", []); }, sel: ".baCheckbox", pick: "index:index", single: "deleteBALog", arg: "index", modules: ["Inventory"], label: "adjustment(s)" },
    bulkDeleteMovements: { get: function () { return ls("movements", []); }, sel: ".movementCheckbox", pick: "index:index", single: "deleteMovement", arg: "index", modules: ["Inventory"], label: "movement(s)" },
    bulkDeletePriceList: { get: function () { return ls("priceList", []); }, sel: ".priceCheckbox", pick: "row", single: "deletePriceMerged", arg: function (r) { return [r.item, r.warehouse]; }, label: "price entr(ies)" },
    bulkDeleteAmendments: { get: function () { return ls("amendments", []); }, sel: ".amendCheckbox", pick: "row", single: "deleteAmendment",
      arg: function (r, arr) { var f = arr.filter(function (x) { return x.warehouse === r.warehouse; }); var i = -1; f.some(function (x, k) { if (sameRec(x, r)) { i = k; return true; } }); return [i, r.warehouse]; }, modules: ["Inventory"], label: "amendment(s)" },
    bulkDeleteEmployees: { get: function () { return ls("employees", []); }, sel: ".employee-select", pick: "index:index", single: "deleteEmployee", arg: "index", label: "employee(s)" },
    bulkDeleteGrossPayroll: { get: function () { return ls("payrollRecords", []); }, sel: ".gross-payroll-select", pick: "id:id", single: "deletePayrollRecord", arg: "id", modules: ["Payroll"], label: "payroll record(s)" },
    bulkDeleteCurrentAccounts: { get: function () { return glob("currentAccounts") || []; }, sel: ".current-account-select", pick: "index:index", single: "deleteCurrentAccount", arg: "index", modules: ["Current Accounts"], label: "account(s)" },
    bulkDeleteNonCurrentAssets: { get: function () { var b = glob("balanceSheet") || W.balanceSheet || {}; return b.nonCurrentAssets || []; }, sel: ".non-current-asset-select", pick: "index:index", single: "deleteNonCurrentAsset", arg: "index", modules: ["Non-Current Assets"], label: "asset(s)" },
    deleteSelectedBills: { get: function () { return ls("bills", []); }, sel: ".bill-checkbox", pick: "index:value", view: "__acxSupplierBillsView", single: "deleteBill", arg: "index", modules: ["Bills", "Purchases"], label: "bill(s)" },
    deleteSelectedDebitNotes: { get: function () { return ls("supplierDebitNotes", []); }, sel: ".debit-note-checkbox", pick: "index:value", single: "deleteDebitNote", arg: "index", modules: ["Debit Notes", "Purchases"], label: "debit note(s)" },
    deleteSelectedOperationalCosts: { get: function () { return ls("operationalCosts", []); }, sel: ".operational-cost-checkbox", pick: "index:value", single: "deleteOperationalCost", arg: "index", modules: ["Operational Costs", "Expenses"], label: "cost(s)" },
    deleteSelectedPurchaseOrders: { get: function () { return call("getPOList") || []; }, sel: ".po-checkbox", pick: "index:value", single: "deletePurchaseOrder", arg: "index", modules: ["Purchase Orders", "Purchases"], label: "purchase order(s)" },
    deleteSelectedSupplierQuotes: { get: function () { return call("getQuotes") || []; }, sel: ".supplier-quote-checkbox", pick: "index:value", single: "deleteSupplierQuote", arg: "index", label: "quote(s)" },
    deleteSelectedTaxPayments: { get: function () { return ls("taxPayments", []); }, sel: ".tax-payment-checkbox", pick: "index:value", single: "deleteTaxPayment", arg: "index", modules: ["Tax Payments"], label: "tax payment(s)" },
    deleteSelectedSuppliers: { get: function () { return ls("suppliers", []); }, sel: ".supplier-checkbox", pick: "index:value", single: "deleteSupplier", arg: "index", label: "supplier(s)" }
  };

  function selectedRecords(cfg) {
    var arr = cfg.get() || [];
    var out = [];
    if (typeof cfg.pick === "function") {
      var ids = (cfg.pick() || []).map(String);
      arr.forEach(function (r) { if (r && ids.indexOf(String(r.id)) >= 0) out.push(r); });
      return out;
    }
    var boxes = checked(cfg.sel);
    if (cfg.pick === "row") {
      boxes.forEach(function (cb) { var r = arr[rowIndex(cb)]; if (r) out.push(r); });
      return out;
    }
    var p = cfg.pick.split(":"), mode = p[0], a = p[1];
    boxes.forEach(function (cb) {
      var v = attr(cb, a);
      if (mode === "id") {
        var hit = arr.find(function (r) { return r && String(r.id) === String(v); });
        if (hit) out.push(hit);
      } else {
        var i = parseInt(v, 10);
        if (isNaN(i)) return;
        var view = cfg.view ? W[cfg.view] : null;
        if (view && Array.isArray(view) && W.__acxResolveRowIndex) i = W.__acxResolveRowIndex(arr, view, i, []);
        if (arr[i]) out.push(arr[i]);
      }
    });
    // de-duplicate
    return out.filter(function (r, k) { return out.indexOf(r) === k; });
  }

  function makeBulk(name, cfg) {
    var bulk = function () {
      var recs = selectedRecords(cfg);
      if (!recs.length) { (W.alert)("No " + cfg.label + " selected."); return; }
      if (!fn(cfg.single)) { console.warn("[acacia-fixes] missing " + cfg.single); return; }
      if (!W.confirm("Delete " + recs.length + " " + cfg.label + "?\n\nEach one is reversed exactly like a single delete (stock, bank, ledger, balances) and moved to the Recycle Bin where supported.")) return;

      var done = 0, skipped = [], reasons = {};
      var snapshot = recs.map(function (r) { return JSON.parse(JSON.stringify(r)); });
      var viewSaved = cfg.view ? W[cfg.view] : undefined;

      var msgs = quietly(function () {
        snapshot.forEach(function (rec) {
          var why = cfg.skip ? cfg.skip(rec) : "";
          if (!why && cfg.modules && rec.date && !notLocked(cfg.modules, rec.date)) why = "period is locked";
          if (why) { skipped.push(rec); reasons[why] = 1; return; }

          var arr = cfg.get() || [];
          var idx = -1;
          arr.some(function (x, k) { if (sameRec(x, rec)) { idx = k; return true; } });
          if (idx < 0) { done++; return; } // already gone (e.g. cascaded)

          var args = typeof cfg.arg === "function" ? cfg.arg(arr[idx], arr) : [cfg.arg === "id" ? arr[idx].id : idx];
          if (cfg.view) W[cfg.view] = null; // single delete then uses the full-array index directly
          try { W[cfg.single].apply(W, args); } catch (e) { console.warn("[acacia-fixes] " + cfg.single, e); reasons["error: " + e.message] = 1; }
          finally { if (cfg.view) W[cfg.view] = viewSaved; }

          var still = (cfg.get() || []).some(function (x) { return sameRec(x, rec); });
          if (still) skipped.push(rec); else done++;
        });
      });

      // collect blocking messages from the single deletes (permission / lock / has transactions)
      msgs.forEach(function (m) {
        if (/cannot|can't|not allowed|permission|locked|has (existing )?transactions|linked|denied|🚫|⚠️|❌/i.test(m)) reasons[m.replace(/\s+/g, " ").slice(0, 160)] = 1;
      });
      checked(cfg.sel || "input.__none").forEach(function (cb) { cb.checked = false; });

      var text = "✅ Deleted " + done + " of " + snapshot.length + " " + cfg.label + ".";
      if (skipped.length) text += "\n\n⚠️ " + skipped.length + " not deleted:\n• " + Object.keys(reasons).slice(0, 5).join("\n• ");
      W.alert(text);
      afterChange();
    };
    bulk.__acxBulk = true; bulk.__acxAfter = true; bulk.__erpPatched = true; bulk.__lockGuarded = true;
    return bulk;
  }

  function installBulk() {
    Object.keys(BULK).forEach(function (n) {
      if (W[n] && W[n].__acxBulk) return;
      W[n] = makeBulk(n, BULK[n]);
    });
    // inventory: only when a warehouse is selected (otherwise keep original "delete all" flow)
    var origInv = W.bulkDeleteInventory;
    if (origInv && !origInv.__acxBulk) {
      var invCfg = {
        get: function () { var wh = (document.getElementById("warehouseSelect") || {}).value; return wh && fn("getInventory") ? W.getInventory(wh) : []; },
        sel: ".itemCheckbox", pick: "index:index", single: "deleteItem", arg: "index", modules: ["Inventory"], label: "item(s)"
      };
      var invBulk = makeBulk("bulkDeleteInventory", invCfg);
      var w = function () {
        var wh = (document.getElementById("warehouseSelect") || {}).value;
        return wh ? invBulk.apply(this, arguments) : origInv.apply(this, arguments);
      };
      w.__acxBulk = true; w.__acxAfter = true;
      W.bulkDeleteInventory = w;
    }
  }

  /* ---------------- P5: clones ---------------- */
  var CLONES = {
    cloneReceipt: { key: "receipts", tab: "receiptsTab", posting: true },
    cloneManualTransaction: { key: "manualTransactions", tab: null, posting: true },
    cloneSupplierPayment: { key: "billPayments", tab: "supplierPaymentsTab", posting: true },
    cloneTaxPayment: { key: "taxPayments", tab: "taxPaymentsTab", posting: true },
    cloneOperationalCost: { key: "operationalCosts", tab: "OperationalCostsTab", posting: true },
    cloneBill: { key: "bills", tab: "supplierBillsTab", posting: true },
    cloneInvoice: { key: "invoices", tab: "invoicesTab", posting: true, invoice: true },
    cloneJournal: { key: "manualJournals", tab: "manualJournalsTab" },
    cloneQuote: { key: "quotes", tab: "quotesTab" },
    cloneCreditNote: { key: "creditNotes", tab: "creditNoteTab" },
    cloneSalesReturn: { key: "salesReturns", tab: "salesReturnTab" },
    cloneDelivery: { key: "deliveries", tab: "deliveryTab" },
    cloneOrder: { key: "orders", tab: "ordersTab" }
  };
  var FISCAL_RE = /etims|kra|fiscal|^cu(Invoice)?(No|Number)$|^qr|signature|^scu|receiptSign|intrlData|invcNo|controlUnit/i;

  function installClones() {
    Object.keys(CLONES).forEach(function (n) {
      var f = W[n], cfg = CLONES[n];
      if (typeof f !== "function" || f.__acxClone) return;
      var w = function () {
        if (cfg.tab && !hasPerm(cfg.tab, "add", "clone records")) return;
        var before = ls(cfg.key, []);
        var oldLen = before.length;
        var ids = {};
        before.forEach(function (r) { if (r && r.id != null) ids[String(r.id)] = 1; });
        var res = f.apply(this, arguments);
        var after = ls(cfg.key, []);
        if (after.length > oldLen) {
          for (var i = oldLen; i < after.length; i++) {
            var r = after[i]; if (!r || typeof r !== "object") continue;
            if (r.id == null || ids[String(r.id)]) r.id = typeof before[0] === "object" && typeof (before[0] || {}).id === "number" ? Date.now() + i : newId();
            ids[String(r.id)] = 1;
            if (cfg.posting) { r.__acxUnposted = true; r.status = r.status || "Draft"; }
            if (cfg.invoice) {
              delete r.sourceOrderId;
              Object.keys(r).forEach(function (k) { if (FISCAL_RE.test(k)) delete r[k]; });
            }
          }
          lsSet(cfg.key, after);
          if (cfg.posting && !W.__acxQuiet) {
            setTimeout(function () {
              call("showNotification", "Copy saved as unposted — it does not affect bank, stock or ledger. Edit and save it to post.", "info");
            }, 50);
          }
        }
        afterChange();
        return res;
      };
      w.__acxClone = true; w.__acxAfter = true;
      W[n] = w;
    });

    // P6: clone selected only, with confirmation
    function cloneSelected(key, sel, label, render, mutate) {
      var arr = ls(key, []);
      var picks = checked(sel).map(function (cb) { return arr[parseInt(cb.dataset.index, 10)]; }).filter(Boolean);
      if (!picks.length) return W.alert("Select the " + label + " to clone first.");
      if (!W.confirm("Clone " + picks.length + " selected " + label + "?")) return;
      picks.forEach(function (p) { var c = JSON.parse(JSON.stringify(p)); c.id = newId(); mutate(c); arr.push(c); });
      lsSet(key, arr);
      if (key === "recurringInvoices") { try { setGlob("recurringInvoices", arr); } catch (e) {} }
      call(render);
      W.alert("✅ Cloned " + picks.length + " " + label + ".");
      afterChange();
    }
    if (fn("cloneOrders") && !W.cloneOrders.__acxClone) {
      W.cloneOrders = function () {
        if (!hasPerm("ordersTab", "add", "clone orders")) return;
        cloneSelected("orders", ".orderCheck", "order(s)", "renderOrders", function (c) {
          c.orderNumber = "CLONE-" + (c.orderNumber || c.number || ""); c.converted = false; c.status = "pending";
        });
      };
      W.cloneOrders.__acxClone = true;
    }
    if (fn("cloneRecurringInvoices") && !W.cloneRecurringInvoices.__acxClone) {
      W.cloneRecurringInvoices = function () {
        if (!hasPerm("recurringInvoicesTab", "add", "clone recurring invoices")) return;
        cloneSelected("recurringInvoices", ".recurringCheck", "recurring invoice(s)", "renderRecurringInvoices", function (c) {
          c.number = "CLONE-" + (c.number || ""); c.paused = true; c.active = false; c.status = "Paused";
        });
      };
      W.cloneRecurringInvoices.__acxClone = true;
    }
  }

  /* Deleting an unposted clone: remove the record only (nothing to reverse) */
  var UNPOSTED_DELETES = {
    deleteReceipt: { key: "receipts", by: "id", tab: "receiptsTab", render: "renderReceipts" },
    deleteManualTransaction: { key: "manualTransactions", by: "id", render: "renderManualTransactions" },
    deleteSupplierPayment: { key: "billPayments", by: "index", tab: "supplierPaymentsTab", render: "renderSupplierPayments" },
    deleteTaxPayment: { key: "taxPayments", by: "index", tab: "taxPaymentsTab", render: "renderTaxPayments" },
    deleteOperationalCost: { key: "operationalCosts", by: "index", tab: "OperationalCostsTab", render: "renderOperationalCosts" },
    deleteBill: { key: "bills", by: "index", view: "__acxSupplierBillsView", tab: "supplierBillsTab", render: "loadSupplierBills" },
    deleteInvoice: { key: "invoices", by: "id", tab: "invoicesTab", render: "renderInvoices" }
  };
  function installUnpostedDeletes() {
    Object.keys(UNPOSTED_DELETES).forEach(function (n) {
      var f = W[n], cfg = UNPOSTED_DELETES[n];
      if (typeof f !== "function" || f.__acxUnpostedDel) return;
      var w = function (e) {
        var arr = ls(cfg.key, []), i;
        if (cfg.by === "id") i = arr.findIndex(function (r) { return r && String(r.id) === String(e); });
        else { i = e; if (cfg.view && Array.isArray(W[cfg.view]) && W.__acxResolveRowIndex) i = W.__acxResolveRowIndex(arr, W[cfg.view], e, []); }
        var rec = arr[i];
        if (rec && rec.__acxUnposted) {
          if (cfg.tab && !hasPerm(cfg.tab, "delete", "delete records")) return;
          if (!W.confirm("Delete this unposted copy?")) return;
          try { if (fn("moveToRecycle")) W.moveToRecycle(rec, "File", cfg.key.charAt(0).toUpperCase() + cfg.key.slice(1)); } catch (x) {}
          arr.splice(i, 1); lsSet(cfg.key, arr);
          call(cfg.render); afterChange();
          return;
        }
        return f.apply(this, arguments);
      };
      Object.keys(f).forEach(function (k) { try { w[k] = f[k]; } catch (x) {} });
      w.__acxUnpostedDel = true;
      W[n] = w;
    });
  }

  /* ---------------- P4: supplier bill ledger fixes ---------------- */
  function removeBillJournals(billNumber, keepLast) {
    if (!billNumber) return;
    var js = ls("manualJournals", []);
    var hits = [];
    js.forEach(function (j, k) { if (j && j.source === "Auto" && String(j.billNumber) === String(billNumber)) hits.push(k); });
    if (keepLast) hits.pop();
    if (!hits.length) return;
    js = js.filter(function (j, k) { return hits.indexOf(k) < 0; });
    lsSet("manualJournals", js);
    call("renderManualJournals");
  }
  function adjustBillAggregates(bill, sign) {
    var amt = parseFloat(bill && bill.subtotal);
    if (!amt) return;
    var bs = ls("balanceSheet", {});
    bs.currentAssets = bs.currentAssets || {}; bs.currentLiabilities = bs.currentLiabilities || {};
    bs.currentAssets.inventory = (bs.currentAssets.inventory || 0) + sign * amt;
    bs.currentLiabilities.accountsPayable = (bs.currentLiabilities.accountsPayable || 0) + sign * amt;
    lsSet("balanceSheet", bs);
  }
  function installBillFixes() {
    var del = W.deleteBill;
    if (typeof del === "function" && !del.__acxBillFix) {
      var w = function (e) {
        var arr = ls("bills", []);
        var i = W.__acxResolveRowIndex ? W.__acxResolveRowIndex(arr, W.__acxSupplierBillsView, e, ["billNumber", "supplier", "date"]) : e;
        var bill = arr[i] ? JSON.parse(JSON.stringify(arr[i])) : null;
        var r = del.apply(this, arguments);
        if (bill && !bill.__acxUnposted && !ls("bills", []).some(function (x) { return sameRec(x, bill); })) {
          removeBillJournals(bill.billNumber, false);
          adjustBillAggregates(bill, -1);
          afterChange();
        }
        return r;
      };
      Object.keys(del).forEach(function (k) { try { w[k] = del[k]; } catch (x) {} });
      w.__acxBillFix = true;
      W.deleteBill = w;
    }
    var save = W.saveSupplierBill;
    if (typeof save === "function" && !save.__acxBillFix) {
      var s = function () {
        var editIdx = glob("currentEditingBillIndex");
        var old = (typeof editIdx === "number" && editIdx >= 0) ? ls("bills", [])[editIdx] : null;
        old = old ? JSON.parse(JSON.stringify(old)) : null;
        var jBefore = ls("manualJournals", []).length;
        var r = save.apply(this, arguments);
        var posted = ls("manualJournals", []).length > jBefore;
        if (old && posted) {
          removeBillJournals(old.billNumber, true);  // keep the freshly posted journal
          adjustBillAggregates(old, -1);             // subtract the old amount
          var bills = ls("bills", []);               // edited copy is now posted
          if (bills[editIdx] && bills[editIdx].__acxUnposted) { delete bills[editIdx].__acxUnposted; lsSet("bills", bills); }
          afterChange();
        }
        return r;
      };
      Object.keys(save).forEach(function (k) { try { s[k] = save[k]; } catch (x) {} });
      s.__acxBillFix = true;
      W.saveSupplierBill = s;
    }
  }

  /* ---------------- P7: permission on deleteReceipt ---------------- */
  function installReceiptPerm() {
    var f = W.deleteReceipt;
    if (typeof f !== "function" || f.__acxPerm) return;
    var w = function () { if (!hasPerm("receiptsTab", "delete", "delete receipts")) return; return f.apply(this, arguments); };
    Object.keys(f).forEach(function (k) { try { w[k] = f[k]; } catch (x) {} });
    w.__acxPerm = true;
    W.deleteReceipt = w;
  }

  /* ---------------- P8: missing handlers ---------------- */
  function installMissing() {
    ["bulkDeleteProjectRevenue", "bulkDeleteNonCurrentLiabilities", "deleteRevenue"].forEach(function (n) {
      if (typeof W[n] === "function") return;
      W[n] = function () {
        console.warn("[acacia-fixes] " + n + " is not loaded (its script is missing).");
        W.alert("This action isn't available right now. Please refresh the page; if it persists, contact support.");
      };
      W[n].__acxMissing = true;
    });
  }

  /* ---------------- P9: old recurring invoices -> Recurring Invoices ---------------- */
  /* Older versions saved generated invoices with no recurring flags, so Invoices still listed them.
     Tag them (fromRecurring + recurringRef) so renderInvoices hides them and recurring-split.js lists them
     under their template. Linked only when exactly one template matches (customer, then currency). */
  function migrateOldRecurring() {
    try {
      var tpls = ls("recurringInvoices", []), invoices = ls("invoices", []);
      if (!tpls.length || !invoices.length) return false;
      var tnums = {}; tpls.forEach(function (t) { if (t) tnums[String(t.number)] = 1; });
      var low = function (x) { return String(x == null ? "" : x).trim().toLowerCase(); }, changed = false;
      invoices.forEach(function (i) {
        if (!i || i.fromBulk || i.isBulk || i.source === "bulk") return;
        if (i.recurringRef != null && i.recurringRef !== "") { if (!i.fromRecurring) { i.fromRecurring = true; changed = true; } return; }
        var no = String(i.invoiceNumber || "");
        var old = (/^RINV-/.test(no) && !tnums[no]) || i.source === "Recurring Invoice" || i.recurringRunNumber;
        if (!old) return;
        var c = tpls.filter(function (t) { return t && low(t.customerName || t.customer) === low(i.customer); });
        if (c.length > 1) { var c2 = c.filter(function (t) { return (t.currency || "KES") === (i.currency || "KES"); }); if (c2.length) c = c2; }
        if (c.length !== 1) return;
        i.recurringRef = c[0].id; i.fromRecurring = true; changed = true;
      });
      if (changed) lsSet("invoices", invoices);
      return changed;
    } catch (e) { console.warn("[acacia-fixes] migrateOldRecurring", e); return false; }
  }
  function installRecurringMigration() {
    var f = W.renderInvoices;
    if (typeof f === "function" && !f.__acxRecMig) {
      var w = function () { migrateOldRecurring(); return f.apply(this, arguments); };
      Object.keys(f).forEach(function (k) { try { w[k] = f[k]; } catch (x) {} });
      w.__acxRecMig = true;
      W.renderInvoices = w;
    }
    if (migrateOldRecurring()) { call("renderInvoices"); call("renderRecurringInvoices"); }
  }

  /* ---------------- P10: deleting a recurring invoice handles its generated invoices ---------------- */
  function tplIds() { return ls("recurringInvoices", []).filter(Boolean).map(function (t) { return String(t.id); }); }
  function linkId(i) {
    if (i.recurringRef != null && i.recurringRef !== "") return String(i.recurringRef);
    if (i.recurringId != null && i.recurringId !== "") return String(i.recurringId);
    return "";
  }
  function invExists(id) { return ls("invoices", []).some(function (x) { return x && String(x.id) === String(id); }); }
  function removeGenerated(list) {
    var del = fn("deleteInvoice"), unwind = fn("__acxUnwindInvoicePayments");
    var sc = W.confirm, st = W.showToast, done = 0, kept = [];
    W.confirm = function () { return true; };
    if (st) W.showToast = function () {};
    try {
      list.forEach(function (inv) {
        if (invExists(inv.id)) {
          if (del) { try { del.call(W, inv.id); } catch (e) { console.warn("[acacia-fixes] deleteInvoice", e); } }
          if (invExists(inv.id)) kept.push(inv.invoiceNumber || inv.id); else done++;
        } else {
          /* already dropped by the old delete without reversing its payments / ledger */
          if (unwind) { try { unwind(inv); } catch (e) { console.warn("[acacia-fixes] unwind", e); } }
          done++;
        }
      });
    } finally { W.confirm = sc; if (st) W.showToast = st; }
    return { done: done, kept: kept };
  }
  function detachGenerated(list) {
    var arr = ls("invoices", []);
    list.forEach(function (inv) {
      var i = arr.findIndex(function (x) { return x && String(x.id) === String(inv.id); });
      var rec = i >= 0 ? arr[i] : JSON.parse(JSON.stringify(inv));
      delete rec.recurringRef; delete rec.recurringId; delete rec.fromRecurring; delete rec.isRecurring;
      rec.source = "recurring-removed";
      if (i >= 0) arr[i] = rec; else arr.push(rec);
    });
    lsSet("invoices", arr);
    try { W.invoices = arr; } catch (e) {}
  }
  function afterRecurringCleanup() {
    ["renderInvoices", "renderRecurringInvoices", "renderRecurringInvoiceReport", "renderCustomers", "renderAccountsReceivable",
     "renderCustomerStatement", "updateDashboardTotals", "loadDashboard"].forEach(function (n) { call(n); });
    call("afterChange");
  }
  function askAndHandle(gen, intro) {
    if (!gen.length) return;
    var delIt = W.confirm(intro + "\n\nOK = delete them too (rolls back receivables, payments, stock and ledger; they go to the Recycle Bin).\nCancel = keep them as normal invoices in Invoices.");
    if (delIt) {
      var r = removeGenerated(gen), msg = "✅ Deleted " + r.done + " generated invoice(s).";
      if (r.kept.length) msg += "\n\n⚠️ Not deleted (locked period or error):\n• " + r.kept.slice(0, 8).join("\n• ");
      W.alert(msg);
    } else {
      detachGenerated(gen);
      W.alert("Kept " + gen.length + " invoice(s) as normal invoices.");
    }
    afterRecurringCleanup();
  }
  function installRecurringDelete() {
    ["deleteRecurring", "bulkDeleteRecurringInvoices"].forEach(function (n) {
      var f = W[n];
      if (typeof f !== "function" || f.__acxRecDel) return;
      var w = function () {
        var before = tplIds(), snap = ls("invoices", []).filter(function (i) { return i && linkId(i); });
        var r = f.apply(this, arguments);
        var now = {}; tplIds().forEach(function (id) { now[id] = 1; });
        var removed = {}, any = false;
        before.forEach(function (id) { if (!now[id]) { removed[id] = 1; any = true; } });
        if (any) setTimeout(function () {
          var gen = snap.filter(function (i) { return removed[linkId(i)]; });
          askAndHandle(gen, "The deleted recurring invoice(s) have " + gen.length + " generated invoice(s) that still count in the Dashboard and reports.");
        }, 80);
        return r;
      };
      Object.keys(f).forEach(function (k) { try { w[k] = f[k]; } catch (x) {} });
      w.__acxRecDel = true;
      W[n] = w;
    });
  }
  function findOrphanInvoices() {
    var have = {}; tplIds().forEach(function (id) { have[id] = 1; });
    return ls("invoices", []).filter(function (i) {
      if (!i || i.fromBulk || i.isBulk || i.source === "bulk") return false;
      var id = linkId(i);
      return id && !have[id] && (i.fromRecurring || i.source === "Recurring Invoice" || (i.recurringRef != null && i.recurringRef !== ""));
    });
  }
  W.acxCleanOrphanRecurringInvoices = function () {
    var gen = findOrphanInvoices();
    if (!gen.length) return W.alert("No leftover invoices from deleted recurring invoices were found.");
    askAndHandle(gen, "Found " + gen.length + " invoice(s) from recurring invoices that were deleted earlier. They are hidden from Invoices but still count in the Dashboard and reports.");
  };
  var orphanAsked = false;
  function offerOrphanCleanup() {
    if (orphanAsked) return;
    try { if (sessionStorage.getItem("__acxOrphanAsked") || !localStorage.getItem("loggedInUser")) return; } catch (e) { return; }
    if (!findOrphanInvoices().length) return;
    orphanAsked = true;
    try { sessionStorage.setItem("__acxOrphanAsked", "1"); } catch (e) {}
    W.acxCleanOrphanRecurringInvoices();
  }

  /* ---------------- install ---------------- */
  function install() {
    try {
      installAliases();
      installReceiptPerm();      // permission first (innermost)
      installUnpostedDeletes();  // unposted clone short-circuit
      installBillFixes();
      installClones();
      installBulk();
      installMissing();
      installRecurringMigration();
      installRecurringDelete();
      wrapAll();                 // afterChange around everything (outermost)
    } catch (e) { console.error("[acacia-fixes] install failed", e); }
  }
  install();
  if (document.readyState !== "complete") W.addEventListener("load", function () { setTimeout(install, 0); });
  setTimeout(offerOrphanCleanup, 4000);
  setTimeout(install, 1500); // late scripts (sync.js, recycle-restore.js) may redefine handlers
})();
}catch(e){console.error('[merged:acacia-fixes.js]',e)}
/* ===================== acacia-fixes-2.js ===================== */
try{
/*!
 * acacia-fixes-2.js — finishes the open items left after acacia-fixes.js. Load AFTER acacia-fixes.js.
 *
 *  F1  Editing an "unposted" copy no longer changes balances by the old amount.
 *      - Form edits (manual bank transaction, supplier payment, tax payment, operational cost, invoice):
 *        on save the unposted copy is removed and the form is saved as a NEW record, so it is posted
 *        exactly once with the new amount. If the save is rejected (validation, lock, permission)
 *        the copy is put back untouched.
 *      - Receipts (prompt edit): the old amount the edit subtracts from the bank is added back,
 *        so the bank only changes by the new amount; the copy is then marked as posted.
 *  F2  Locked-period checks on bulk invoices: save, edit, single delete and bulk delete.
 *      Bulk delete of bulk invoices now loops the single delete and shows one summary.
 *  F3  Clone of a bulk invoice: permission check, new id, saved as Draft, e-TIMS fields dropped.
 */
(function () {
  "use strict";
  if (window.__acaciaFixes2) return;
  window.__acaciaFixes2 = { version: "2026-10-06" };
  var W = window;

  function fn(n) { return typeof W[n] === "function" ? W[n] : null; }
  function ls(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function glob(name) { try { return (0, eval)("typeof " + name + "!=='undefined'?" + name + ":undefined"); } catch (e) { return undefined; } }
  function setGlob(name, val) { try { W.__acxTmp2 = val; (0, eval)(name + "=window.__acxTmp2"); } catch (e) { W[name] = val; } finally { delete W.__acxTmp2; } }
  function newId() { return (W.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function hasPerm(tab, action, label) { var f = fn("requirePermission"); if (!f) return true; try { return f(tab, action, label) !== false; } catch (e) { return true; } }
  function notLocked(modules, date) {
    if (!date || typeof W.assertNotLocked !== "function") return true;
    try { return W.assertNotLocked(modules, date) !== false; } catch (e) { return true; }
  }
  function refresh() { if (fn("afterChange")) try { W.afterChange(); } catch (e) {} }
  function copyProps(from, to) { Object.keys(from).forEach(function (k) { try { to[k] = from[k]; } catch (e) {} }); }

  /* ---------------- F1: editing unposted copies ---------------- */
  var FORM_SAVES = {
    manualTransaction:  { key: "manualTransactions", editVar: "manualTxEditingIndex",        by: "index" },
    addSupplierPayment: { key: "billPayments",       editVar: "editingPaymentIndex",         by: "index" },
    addTaxPayment:      { key: "taxPayments",        editVar: "editingTaxPaymentIndex",      by: "index" },
    addOperationalCost: { key: "operationalCosts",   editVar: "editingOperationalCostIndex", by: "index" },
    saveInvoice:        { key: "invoices",           editVar: "editingInvoiceId",            by: "id" }
  };
  function installFormSaves() {
    Object.keys(FORM_SAVES).forEach(function (n) {
      var f = W[n], cfg = FORM_SAVES[n];
      if (typeof f !== "function" || f.__acx2Unposted) return;
      var w = function () {
        var ed = glob(cfg.editVar);
        if (ed === null || ed === undefined || ed === "" || ed === -1) return f.apply(this, arguments);
        var arr = ls(cfg.key, []);
        var i = cfg.by === "id" ? arr.findIndex(function (r) { return r && String(r.id) === String(ed); }) : parseInt(ed, 10);
        var rec = arr[i];
        if (!rec || !rec.__acxUnposted) return f.apply(this, arguments);

        // Unposted copy: take it out and save the form as a brand-new record (posted once, new amount only).
        var backup = JSON.parse(JSON.stringify(rec));
        arr.splice(i, 1); lsSet(cfg.key, arr);
        setGlob(cfg.editVar, null);
        var lenBefore = arr.length, r;
        try { r = f.apply(this, arguments); }
        finally {
          var after = ls(cfg.key, []);
          if (after.length <= lenBefore) {
            // Save was rejected — put the copy back exactly where it was.
            after.splice(Math.min(i, after.length), 0, backup); lsSet(cfg.key, after);
            setGlob(cfg.editVar, ed);
          } else {
            var last = after[after.length - 1];
            if (last && typeof last === "object") {
              delete last.__acxUnposted;
              if (backup.status === "Draft" && last.status === "Draft") delete last.status;
              lsSet(cfg.key, after);
            }
          }
          refresh();
        }
        return r;
      };
      copyProps(f, w);
      w.__acx2Unposted = true; w.__acxAfter = true;
      W[n] = w;
    });
  }
  function installReceiptEdit() {
    var f = W.editReceipt;
    if (typeof f !== "function" || f.__acx2Unposted) return;
    var w = function (id) {
      var rec = ls("receipts", []).find(function (r) { return r && String(r.id) === String(id); });
      if (!rec || !rec.__acxUnposted) return f.apply(this, arguments);
      var oldAmt = parseFloat(rec.amount) || 0, bankIdx = rec.bankIndex;
      var beforeJson = JSON.stringify(rec);
      var r = f.apply(this, arguments);
      var receipts = ls("receipts", []);
      var now = receipts.find(function (x) { return x && String(x.id) === String(id); });
      if (now && JSON.stringify(now) !== beforeJson) {
        // The edit did "balance - old + new"; the old amount was never posted, so add it back.
        var banks = ls("banks", []);
        if (banks[bankIdx]) { banks[bankIdx].balance = (parseFloat(banks[bankIdx].balance) || 0) + oldAmt; lsSet("banks", banks); }
        delete now.__acxUnposted;
        if (now.status === "Draft") delete now.status;
        lsSet("receipts", receipts);
        if (fn("renderReceipts")) try { W.renderReceipts(); } catch (e) {}
        refresh();
      }
      return r;
    };
    copyProps(f, w);
    w.__acx2Unposted = true; w.__acxAfter = true;
    W.editReceipt = w;
  }

  /* ---------------- F2: locked period on bulk invoices ---------------- */
  var BI_MODULES = ["Invoices", "Sales", "Bulk Invoices"];
  function biByNo(no) { return ls("bulkInvoices", []).find(function (x) { return x && x.invoiceNo === no; }); }
  function installBulkInvoiceLocks() {
    var save = W.saveBulkInvoice;
    if (typeof save === "function" && !save.__acx2Lock) {
      var s = function () {
        var d = (document.getElementById("bulkInvoiceDate") || {}).value;
        if (d && !notLocked(BI_MODULES, d)) return;
        var no = (document.getElementById("bulkInvoiceNumber") || {}).value;
        var old = no && biByNo(no);
        if (old && old.date && !notLocked(BI_MODULES, old.date)) return;
        return save.apply(this, arguments);
      };
      copyProps(save, s); s.__acx2Lock = true; W.saveBulkInvoice = s;
    }
    var edit = W.editBulkInvoice;
    if (typeof edit === "function" && !edit.__acx2Lock) {
      var e = function (no) { var inv = biByNo(no); if (inv && inv.date && !notLocked(BI_MODULES, inv.date)) return; return edit.apply(this, arguments); };
      copyProps(edit, e); e.__acx2Lock = true; W.editBulkInvoice = e;
    }
    var del = W.deleteBulkInvoice;
    if (typeof del === "function" && !del.__acx2Lock) {
      var dl = function (no) { var inv = biByNo(no); if (inv && inv.date && !notLocked(BI_MODULES, inv.date)) return; return del.apply(this, arguments); };
      copyProps(del, dl); dl.__acx2Lock = true; W.deleteBulkInvoice = dl;
    }
    var bulk = W.deleteSelectedBulkInvoices;
    if (typeof bulk === "function" && !bulk.__acx2Lock) {
      var b = function () {
        if (!hasPerm("bulkInvoicesTab", "delete", "delete bulk invoices")) return;
        var nos = Array.prototype.map.call(document.querySelectorAll(".bulk-invoice-checkbox:checked"), function (c) { return c.value; });
        if (!nos.length) return W.alert("No bulk invoices selected");
        if (!W.confirm("Delete " + nos.length + " bulk invoice(s)?\n\nEach one is reversed like a single delete and moved to the Recycle Bin.")) return;
        var done = 0, skipped = [], saved = { c: W.confirm, a: W.alert }, msgs = [];
        W.confirm = function () { return true; };
        W.alert = function (m) { msgs.push(String(m || "")); };
        try {
          nos.forEach(function (no) {
            var inv = biByNo(no);
            if (!inv) { done++; return; }
            if (inv.date && !notLocked(BI_MODULES, inv.date)) { skipped.push(no + " (period is locked)"); return; }
            try { del.call(W, no); } catch (x) { console.warn("[acacia-fixes-2] deleteBulkInvoice", x); }
            if (biByNo(no)) skipped.push(no); else done++;
          });
        } finally { W.confirm = saved.c; W.alert = saved.a; }
        Array.prototype.forEach.call(document.querySelectorAll(".bulk-invoice-checkbox:checked"), function (c) { c.checked = false; });
        if (fn("renderBulkInvoices")) try { W.renderBulkInvoices(); } catch (x) {}
        var text = "✅ Deleted " + done + " of " + nos.length + " bulk invoice(s).";
        if (skipped.length) text += "\n\n⚠️ Not deleted:\n• " + skipped.slice(0, 8).join("\n• ");
        W.alert(text);
        refresh();
      };
      b.__acx2Lock = true; b.__acxBulk = true; b.__acxAfter = true;
      W.deleteSelectedBulkInvoices = b;
    }
  }

  /* ---------------- F3: clone bulk invoice ---------------- */
  var FISCAL_RE = /etims|kra|fiscal|^cu(Invoice)?(No|Number)$|^qr|signature|^scu|receiptSign|intrlData|invcNo|controlUnit/i;
  function installBulkClone() {
    var f = W.cloneBulkInvoice;
    if (typeof f !== "function" || f.__acx2Clone) return;
    var w = function () {
      if (!hasPerm("bulkInvoicesTab", "add", "clone bulk invoices")) return;
      var before = ls("bulkInvoices", []).length;
      var r = f.apply(this, arguments);
      var arr = ls("bulkInvoices", []);
      for (var i = before; i < arr.length; i++) {
        var c = arr[i]; if (!c || typeof c !== "object") continue;
        c.id = newId(); c.status = "Draft"; c.paid = 0; c.amountPaid = 0; c.payments = [];
        delete c.sourceOrderId;
        Object.keys(c).forEach(function (k) { if (FISCAL_RE.test(k)) delete c[k]; });
      }
      if (arr.length > before) { lsSet("bulkInvoices", arr); if (fn("renderBulkInvoices")) try { W.renderBulkInvoices(); } catch (x) {} }
      refresh();
      return r;
    };
    copyProps(f, w); w.__acx2Clone = true; w.__acxAfter = true;
    W.cloneBulkInvoice = w;
  }

  function install() {
    try { installFormSaves(); installReceiptEdit(); installBulkInvoiceLocks(); installBulkClone(); }
    catch (e) { console.error("[acacia-fixes-2] install failed", e); }
  }
  install();
  if (document.readyState !== "complete") W.addEventListener("load", function () { setTimeout(install, 50); });
  setTimeout(install, 1700);
})();
}catch(e){console.error('[merged:acacia-fixes-2.js]',e)}
/* ===================== acacia-fixes-3.js ===================== */
try{
/* acacia-fixes-3.js — loaded last.
 * 1. Bulk invoices always feed the dashboard (Accounts Receivable card + Receivables Aging chart)
 * 2. Bulk bills use their own BBIL- number series and show only in the Bulk Bills table
 * 3. Cash flow: Closing Cash = Opening Cash + Cash Inflows − Cash Outflows (report + dashboard card)
 * 4. Organization profile keeps every section's inputs after refresh (auto-save + no stale overwrite)
 * 5. Reports: working Favorites list (star any report) + last-opened tracking
 */
(function () {
  "use strict";
  var W = window;
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function call(n) { try { if (typeof W[n] === "function") W[n](); } catch (e) { console.warn("[fix3] " + n, e); } }
  function wrap(name, after, before) {
    var f = W[name];
    if (typeof f !== "function" || f.__fix3) return;
    var w = function () {
      var ctx = before ? before() : null;
      try { return f.apply(this, arguments); }
      finally { try { after && after(ctx); } catch (e) { console.warn("[fix3] after " + name, e); } }
    };
    for (var k in f) { try { w[k] = f[k]; } catch (e) {} }
    w.__fix3 = true; W[name] = w;
  }

  /* ---------------- 1. Bulk invoices -> dashboard ---------------- */
  function syncBulkInvoiceMirrors() {
    var bulk = J("bulkInvoices", []), inv = J("invoices", []);
    if (!Array.isArray(bulk) || !Array.isArray(inv)) return false;
    var dp = W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2, changed = false, nos = {};
    bulk.forEach(function (b) {
      if (!b || !b.invoiceNo) return;
      nos[b.invoiceNo] = 1;
      var total = num(b.total), vat = num(b.vat), cust = (b.customers || [])[0] || b.customer || "";
      var i = inv.findIndex(function (x) { return x && x.invoiceNumber === b.invoiceNo; });
      if (i === -1) {
        var paid = num(b.paidAmount != null ? b.paidAmount : b.amountPaid);
        inv.push({
          id: Date.now() + Math.random(), invoiceNumber: b.invoiceNo, date: b.date, customer: cust,
          netDays: b.netDays, dueDate: b.dueDate, account: b.account,
          items: (b.items || []).map(function (e) { return { desc: e.itemName || e.desc, sku: e.sku || "", qty: e.qty, price: e.price, discount: e.discount || 0, vatRate: e.tax === "exempt" ? 0 : num(e.tax) }; }),
          total: total.toFixed(dp), vat: vat.toFixed(dp), currency: b.currency, exchangeRate: b.rate || 1, totalKES: total,
          amountPaid: paid, balance: Math.max(total - paid, 0), paid: total > 0 && paid >= total,
          status: b.status || (paid > 0 ? "Partial" : "Unpaid"), source: "bulk"
        });
        changed = true;
      } else if (inv[i].source === "bulk") {
        var m = inv[i];
        if (num(m.total) !== total || m.date !== b.date || (cust && m.customer !== cust) || (b.dueDate && m.dueDate !== b.dueDate)) {
          var p = num(m.amountPaid);
          m.total = total.toFixed(dp); m.vat = vat.toFixed(dp); m.totalKES = total; m.date = b.date;
          if (cust) m.customer = cust; if (b.dueDate) m.dueDate = b.dueDate;
          m.balance = Math.max(total - p, 0); changed = true;
        }
      }
    });
    var kept = inv.filter(function (x) { return !(x && x.source === "bulk" && x.invoiceNumber && !nos[x.invoiceNumber]); });
    if (kept.length !== inv.length) { inv = kept; changed = true; }
    if (changed) S("invoices", inv);
    return changed;
  }
  function refreshDashboard() {
    call("loadDashboard"); call("renderCharts"); call("renderReceivablesAgingChart");
    call("renderAccountsReceivable"); call("recalculateCustomerReceivables");
    call("refreshDashboardCards"); call("updateDashboardTotals"); updateCashCard();
  }
  function afterBulkInvoice() { syncBulkInvoiceMirrors(); refreshDashboard(); }

  /* ---------------- 2. Bulk bills: own BBIL- series, own table ---------------- */
  function nextBBIL(extra) {
    var max = 0;
    J("bulkBills", []).concat(J("bills", [])).forEach(function (b) {
      var m = /^BBIL-(\d+)/.exec(String((b && (b.billNumber || b.billNo)) || ""));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "BBIL-" + String(max + 1 + (extra || 0)).padStart(4, "0");
  }
  function bulkBillNumbers() {
    var set = {};
    J("bulkBills", []).forEach(function (b) { if (b && b.billNumber) set[b.billNumber] = 1; });
    J("bills", []).forEach(function (b) { if (b && (b.source === "bulk" || /^BBIL-/.test(b.billNumber || ""))) set[b.billNumber] = 1; });
    return set;
  }
  function hideBulkFromBillsTable() {
    var body = document.getElementById("supplierBillsList");
    if (!body) return;
    var set = bulkBillNumbers();
    Array.prototype.slice.call(body.rows).forEach(function (tr) {
      var c = tr.cells[1], no = c ? c.textContent.trim() : "";
      if (no && set[no]) tr.parentNode.removeChild(tr);
    });
  }
  function setBulkNumberField() {
    var el = document.getElementById("bulkBillNumber");
    if (el && !/^BBIL-/.test(el.value || "")) el.value = nextBBIL();
  }

  /* ---------------- 3. Cash flow ---------------- */
  function patchCashflowEngine() {
    var FR = W.FR;
    if (!FR || typeof FR.cashflow !== "function" || FR.cashflow.__fix3) return;
    var orig = FR.cashflow;
    var w = function (from, to, opts) {
      var c = orig.apply(this, arguments);
      try {
        var inflow = 0, outflow = 0;
        Object.keys(c.rows || {}).forEach(function (k) { var v = num(c.rows[k]); if (v >= 0) inflow += v; else outflow += -v; });
        c.inflow = inflow; c.outflow = outflow;
        c.net = inflow - outflow;
        c.closing = num(c.opening) + inflow - outflow;
      } catch (e) {}
      return c;
    };
    w.__fix3 = true; FR.cashflow = w;
  }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fyRange() {
    try {
      if (W.__fy && typeof W.__fy.range === "function") {
        var r = W.__fy.range(typeof W.__fy.current === "function" ? W.__fy.current() : undefined);
        if (r && (r.from || r.start)) return { from: r.from || r.start, to: iso(new Date()) };
      }
    } catch (e) {}
    var n = new Date(); return { from: n.getFullYear() + "-01-01", to: iso(n) };
  }
  function fmt(v) { var dp = W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2; return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function updateCashCard() {
    patchCashflowEngine();
    var FR = W.FR; if (!FR || typeof FR.cashflow !== "function") return;
    try {
      var r = fyRange(), c = FR.cashflow(r.from, r.to);
      var cur = W.__getBaseCurrencyEarly ? W.__getBaseCurrencyEarly() : "KES";
      var shown = W.__cvBase ? W.__cvBase(c.closing, "KES") : c.closing;
      var txt = cur + " " + fmt(shown);
      var tip = "Opening " + fmt(c.opening) + " + Inflows " + fmt(c.inflow) + " − Outflows " + fmt(c.outflow) + " = Closing " + fmt(c.closing);
      ["dashCashFlow", "dashCashFlowKPI"].forEach(function (id) { var e = document.getElementById(id); if (e) { e.textContent = txt; e.title = tip; } });
    } catch (e) { console.warn("[fix3] cash card", e); }
  }
  function cashSummaryBox() {
    var host = document.getElementById("cashFlowReport");
    if (!host || !W.FR) return;
    var box = host.querySelector("#fix3CashSummary");
    var from = (document.getElementById("cfStartDate") || {}).value || "", to = (document.getElementById("cfEndDate") || {}).value || "";
    var mo = (document.getElementById("cfSummaryMonth") || {}).value || "";
    if (mo && !from) { var p = mo.split("-"); from = mo + "-01"; to = iso(new Date(+p[0], +p[1], 0)); }
    if (!from) { var r = fyRange(); from = r.from; to = to || r.to; }
    if (!to) to = iso(new Date());
    var c; try { c = W.FR.cashflow(from, to); } catch (e) { return; }
    var html = '<table class="w-full border border-gray-300 text-sm"><thead><tr class="bg-blue-900" style="color:#fff"><th class="border px-3 py-2 text-left" colspan="2">Cash Position (' + from + ' to ' + to + ')</th></tr></thead><tbody>' +
      '<tr><td class="border px-3 py-1">Opening Cash Balance</td><td class="border px-3 py-1 text-right">' + fmt(c.opening) + '</td></tr>' +
      '<tr><td class="border px-3 py-1">Add: Cash Inflows</td><td class="border px-3 py-1 text-right text-green-700">' + fmt(c.inflow) + '</td></tr>' +
      '<tr><td class="border px-3 py-1">Less: Cash Outflows</td><td class="border px-3 py-1 text-right text-red-700">(' + fmt(c.outflow) + ')</td></tr>' +
      '<tr class="bg-gray-100 font-bold"><td class="border px-3 py-1">Closing Cash Balance</td><td class="border px-3 py-1 text-right">' + fmt(c.closing) + '</td></tr>' +
      '</tbody></table><div class="text-xs text-gray-500 mt-1">Closing Cash Balance = Opening Cash Balance + Cash Inflows − Cash Outflows</div>';
    if (!box) { box = document.createElement("div"); box.id = "fix3CashSummary"; box.className = "mt-4 mb-4"; host.appendChild(box); }
    if (box.__h !== html) { box.innerHTML = html; box.__h = html; }
    try {
      S("cashFlowSummary", Object.assign(J("cashFlowSummary", {}) || {}, { openingCash: c.opening, closingCash: c.closing, netChange: c.net, cashInflows: c.inflow, cashOutflows: c.outflow }));
    } catch (e) {}
    // keep the legacy cells consistent with the formula
    var oc = document.getElementById("cfOpeningCash"), nc = document.getElementById("cfNetChange"), cc = document.getElementById("cfClosingCash");
    if (oc && nc && cc) {
      var o = num(String(oc.textContent).replace(/[^0-9.\-]/g, "")), n = num(String(nc.textContent).replace(/[^0-9.\-]/g, ""));
      var want = fmt(o + n);
      if (cc.textContent.indexOf(want) === -1) cc.textContent = (cc.textContent.match(/^[A-Z]{3}\s/) || [""])[0] + want;
    }
  }

  /* ---------------- 4. Organization profile persistence ---------------- */
  function orgKey() { try { var u = J("loggedInUser", {}); return u && u.companyId ? "orgInfo_" + u.companyId : null; } catch (e) { return null; } }
  function reconcileOrg() {
    var k = orgKey(); if (!k) return;
    var plain = J("orgInfo", null), scoped = J(k, null);
    if (!plain || !scoped) return;
    var sameCo = !plain.companyId || !scoped.companyId || String(plain.companyId) === String(scoped.companyId);
    if (!sameCo) return;
    var tp = Date.parse(plain.updatedAt || 0) || 0, ts = Date.parse(scoped.updatedAt || 0) || 0;
    var merged = ts > tp ? Object.assign({}, plain, scoped) : Object.assign({}, scoped, plain);
    var s = JSON.stringify(merged);
    try { localStorage.setItem("orgInfo", s); localStorage.setItem(k, s); } catch (e) {}
  }
  var orgTimer = null, orgSaving = false;
  function silentSaveOrg() {
    if (typeof W.saveOrgInfo !== "function" || orgSaving) return;
    var logo = document.getElementById("orgLogo");
    if (logo && logo.files && logo.files.length) return; // a new logo is saved with the Save button
    orgSaving = true;
    var a = W.alert; W.alert = function () {};
    try { W.saveOrgInfo(); } catch (e) { console.warn("[fix3] org autosave", e); }
    finally { W.alert = a; orgSaving = false; }
  }
  function hookOrgAutosave() {
    var tab = document.getElementById("orgProfileTab");
    if (!tab || tab.__fix3) return;
    tab.__fix3 = true;
    var sched = function (e) {
      if (e && e.target && e.target.type === "file") return;
      clearTimeout(orgTimer); orgTimer = setTimeout(silentSaveOrg, 800);
    };
    tab.addEventListener("input", sched, true);
    tab.addEventListener("change", sched, true);
    tab.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest("button");
      if (b && /remove|delete|×|✕|🗑/i.test((b.getAttribute("onclick") || "") + b.textContent)) sched();
    }, true);
    W.addEventListener("beforeunload", function () { if (orgTimer) { clearTimeout(orgTimer); silentSaveOrg(); } });
  }

  /* ---------------- install ---------------- */
  function install() {
    // 1
    ["saveBulkInvoice", "editBulkInvoice", "updateBulkInvoice", "deleteBulkInvoice", "deleteSelectedBulkInvoices",
     "importBulkInvoices", "convertBulkInvoiceDraft", "cloneBulkInvoice"].forEach(function (n) { wrap(n, afterBulkInvoice); });
    // 2
    wrap("saveBulkBill", function (ctx) {
      W.generateBillNumber = ctx.orig;
      // tag any mirrored rows created by this save
      var bulk = J("bulkBills", []), bills = J("bills", []), ch = false;
      bills.forEach(function (b) { if (b && /^BBIL-/.test(b.billNumber || "") && b.source !== "bulk") { b.source = "bulk"; ch = true; } });
      if (ch) S("bills", bills);
      setBulkNumberField(); hideBulkFromBillsTable(); refreshDashboard();
    }, function () {
      var orig = W.generateBillNumber, n = 0;
      W.generateBillNumber = function () { return nextBBIL(n++); };
      return { orig: orig };
    });
    var gb = W.generateBulkBillNumber;
    W.generateBulkBillNumber = function () { return nextBBIL(); };
    if (gb) W.generateBulkBillNumber.__orig = gb;
    wrap("loadSupplierBills", hideBulkFromBillsTable);
    ["searchSupplierBills", "filterSupplierBills", "filterBills"].forEach(function (n) { wrap(n, hideBulkFromBillsTable); });
    var sbl = document.getElementById("supplierBillsList");
    if (sbl && W.MutationObserver) new MutationObserver(function () { hideBulkFromBillsTable(); }).observe(sbl, { childList: true });
    // 3
    patchCashflowEngine();
    wrap("loadDashboard", updateCashCard);
    ["renderCashFlow", "showReport", "renderReports"].forEach(function (n) { wrap(n, function () { setTimeout(cashSummaryBox, 0); }); });
    var cfr = document.getElementById("cashFlowReport");
    if (cfr && W.MutationObserver) {
      var t = null;
      new MutationObserver(function (muts) {
        var own = muts.every(function (m) { var b = document.getElementById("fix3CashSummary"); return b && (b === m.target || b.contains(m.target)); });
        if (own) return;
        clearTimeout(t); t = setTimeout(cashSummaryBox, 150);
      }).observe(cfr, { childList: true, subtree: true, characterData: true });
    }
    // 4
    reconcileOrg();
    wrap("loadOrgInfo", null, function () { reconcileOrg(); return null; });
    hookOrgAutosave();
  }

  install(); // wrap now, before other scripts capture the original functions on DOMContentLoaded
  function boot() {
    install();
    setTimeout(function () {
      try { if (typeof W.loadOrgInfo === "function") W.loadOrgInfo(); } catch (e) {}
      setBulkNumberField(); hideBulkFromBillsTable();
      if (syncBulkInvoiceMirrors()) refreshDashboard(); else updateCashCard();
      cashSummaryBox();
    }, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

/* ---- 5. Reports: Favorites list + last opened ------------------------------------------ */
(function () {
  "use strict";
  var W = window, FAV_KEY = "reportFavorites_v1", LAST_KEY = "reportLastOpened_v1", MODE_KEY = "reportsHomeMode_v1";
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function favs() { var a = J(FAV_KEY, []); return Array.isArray(a) ? a : []; }
  function lastMap() { var m = J(LAST_KEY, {}); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmt(iso) {
    if (!iso) return "—"; var d = new Date(iso); if (isNaN(d)) return "—";
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function catalog() {
    var map = {}, order = [];
    document.querySelectorAll('.reports-sidebar li[onclick*="showReport("]').forEach(function (li) {
      var m = /showReport\(\s*['"]([^'"]+)['"]/.exec(li.getAttribute("onclick") || "");
      if (!m || m[1] === "reportsHome" || map[m[1]]) return;
      var cat = "Reports", ul = li.closest("ul.rep-cat-children");
      if (ul) {
        var h = document.querySelector('li.rep-cat-header[data-cat="' + ul.getAttribute("data-cat") + '"] .rep-cat-title');
        if (h) cat = h.textContent.trim();
      }
      map[m[1]] = { id: m[1], name: (li.textContent || m[1]).replace(/^[^\w(]+/, "").trim(), cat: cat, li: li };
      order.push(m[1]);
    });
    return { map: map, order: order };
  }
  function setFav(id, on) {
    var a = favs().filter(function (x) { return x !== id; });
    if (on) a.push(id);
    S(FAV_KEY, a); refresh();
  }
  function openReport(id) {
    var c = catalog().map[id];
    if (typeof W.showReport === "function") W.showReport(id, c ? c.li : null);
  }
  function styles() {
    if (document.getElementById("favReportsStyles")) return;
    var st = document.createElement("style"); st.id = "favReportsStyles";
    st.textContent =
      ".reports-sidebar li .rep-star{float:right;cursor:pointer;color:#cbd5e1;font-size:14px;line-height:1.2;margin-left:6px;padding:0 3px}" +
      ".reports-sidebar li .rep-star::before{content:'\\2606'}.reports-sidebar li .rep-star.on{color:#f59e0b}" +
      ".reports-sidebar li .rep-star.on::before{content:'\\2605'}.reports-sidebar li .rep-star:hover{color:#f59e0b}" +
      "#favReportsBox .fav-tabs{display:flex;gap:6px;margin-bottom:10px}" +
      "#favReportsBox .fav-tabs button{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer}" +
      "#favReportsBox .fav-tabs button.on{background:#fef3c7;border-color:#f59e0b;color:#92400e;font-weight:600}" +
      "#favReportsBox .fav-last{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      "#favReportsBox .fav-last button,#favReportsBox .fav-rm{border:1px solid #93c5fd;background:#fff;border-radius:5px;padding:2px 10px;font-size:12px;cursor:pointer}" +
      "#favReportsBox tr.fav-row.is-last{background:#eff6ff}#favReportsBox tr.fav-row:hover{background:#f8fafc}";
    document.head.appendChild(st);
  }
  function syncStars() {
    var f = favs(), c = catalog();
    c.order.forEach(function (id) {
      var li = c.map[id].li, s = li.querySelector(".rep-star");
      if (!s) { s = document.createElement("span"); s.className = "rep-star"; li.appendChild(s); }
      s.setAttribute("data-id", id); s.title = f.indexOf(id) > -1 ? "Remove from favorites" : "Add to favorites";
      s.classList.toggle("on", f.indexOf(id) > -1);
    });
  }
  function homeTable() {
    var home = document.getElementById("reportsHome"); if (!home) return null;
    for (var i = 0; i < home.children.length; i++) if (home.children[i].tagName === "TABLE") return home.children[i];
    return null;
  }
  function syncHomeTable() {
    var t = homeTable(); if (!t) return;
    var f = favs(), last = lastMap();
    t.querySelectorAll("tbody tr").forEach(function (tr) {
      var id = (tr.id || "").replace(/_homeRow$/, ""); if (!id) return;
      var cb = tr.querySelector('input[type="checkbox"]'), nm = tr.querySelector(".report-name"), lv = tr.querySelector(".last-visited");
      if (cb) cb.checked = f.indexOf(id) > -1;
      if (nm) nm.classList.toggle("favorite", f.indexOf(id) > -1);
      if (lv) lv.textContent = last[id] ? fmt(last[id]) : "-";
    });
  }
  function renderBox() {
    var home = document.getElementById("reportsHome"); if (!home) return;
    var box = document.getElementById("favReportsBox");
    if (!box) { box = document.createElement("div"); box.id = "favReportsBox"; home.insertBefore(box, home.firstChild); }
    var mode = J(MODE_KEY, "favorites"), f = favs(), last = lastMap(), c = catalog(), t = homeTable();
    var ids = f.filter(function (id) { var r = c.map[id]; return r && !r.li.classList.contains("hidden"); });
    ids.sort(function (a, b) {
      var x = last[a] || "", y = last[b] || "";
      if (x !== y) return x < y ? 1 : -1;
      return c.order.indexOf(a) - c.order.indexOf(b);
    });
    var lastId = null, lastT = "";
    Object.keys(last).forEach(function (id) { if (c.map[id] && last[id] > lastT) { lastT = last[id]; lastId = id; } });
    var h = '<div class="fav-tabs"><button type="button" data-fav-mode="favorites" class="' + (mode === "favorites" ? "on" : "") + '">\u2B50 Favorites (' + ids.length + ')</button>' +
            '<button type="button" data-fav-mode="all" class="' + (mode === "all" ? "on" : "") + '">All reports</button></div>';
    if (mode === "favorites") {
      if (lastId) h += '<div class="fav-last"><span>Last opened: <b>' + esc(c.map[lastId].name) + '</b> &middot; ' + esc(fmt(lastT)) +
                       '</span><button type="button" data-open="' + esc(lastId) + '">Open</button></div>';
      if (!ids.length) {
        h += '<p class="text-sm" style="color:#64748b;padding:8px 2px">No favorite reports yet. Click the \u2606 next to any report in the list on the left, ' +
             'or open <b>All reports</b> and tick the box beside a report.</p>';
      } else {
        h += '<table class="w-full border text-sm"><thead class="bg-gray-100"><tr><th class="border px-2 py-1 text-left">Report Name</th>' +
             '<th class="border px-2 py-1 text-left">Category</th><th class="border px-2 py-1 text-left">Last Opened</th><th class="border px-2 py-1"></th></tr></thead><tbody>';
        ids.forEach(function (id) {
          var r = c.map[id];
          h += '<tr class="fav-row' + (id === lastId ? " is-last" : "") + '"><td class="border px-2 py-1"><span class="report-name cursor-pointer" data-open="' + esc(id) + '">\uD83D\uDCC1 ' + esc(r.name) + '</span>' +
               (id === lastId ? ' <small style="color:#2563eb">(last opened)</small>' : "") + '</td><td class="border px-2 py-1">' + esc(r.cat) + '</td>' +
               '<td class="border px-2 py-1">' + esc(fmt(last[id])) + '</td><td class="border px-2 py-1 text-center"><button type="button" class="fav-rm" data-unfav="' + esc(id) + '">\u2605 Remove</button></td></tr>';
        });
        h += "</tbody></table>";
      }
    }
    box.innerHTML = h;
    if (t) t.style.display = mode === "all" ? "" : "none";
  }
  function refresh() { try { styles(); syncStars(); syncHomeTable(); renderBox(); } catch (e) { console.warn("[fav-reports]", e); } }

  W.toggleFavorite = function (cb) {
    var tr = cb && cb.closest ? cb.closest("tr") : null, id = tr && tr.id ? tr.id.replace(/_homeRow$/, "") : "";
    if (id) setFav(id, !!cb.checked);
  };

  var wrapped = false, inside = false;
  function wrap() {
    var cur = W.showReport; if (typeof cur !== "function" || cur.__favWrapped) return;
    var w = function (id) {
      var outer = !inside, r; inside = true;
      try { r = cur.apply(this, arguments); } finally { inside = false; }
      if (outer) {
        try {
          if (id === "reportsHome") { refresh(); }
          else if (id) {
            var p = document.getElementById(id);
            if (p && !p.classList.contains("hidden") && p.style.display !== "none") {
              var m = lastMap(); m[id] = new Date().toISOString(); S(LAST_KEY, m); refresh();
            }
          }
        } catch (e) {}
      }
      return r;
    };
    for (var k in cur) { try { w[k] = cur[k]; } catch (e) {} }
    w.__favWrapped = true; W.showReport = w;
  }

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var star = t.closest(".rep-star");
    if (star) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      var id = star.getAttribute("data-id"); setFav(id, favs().indexOf(id) < 0); return;
    }
    var box = t.closest("#favReportsBox"); if (!box) return;
    var el;
    if ((el = t.closest("[data-fav-mode]"))) { S(MODE_KEY, el.getAttribute("data-fav-mode")); renderBox(); }
    else if ((el = t.closest("[data-unfav]"))) { setFav(el.getAttribute("data-unfav"), false); }
    else if ((el = t.closest("[data-open]"))) { openReport(el.getAttribute("data-open")); }
  }, true);

  function boot() {
    wrap(); refresh();
    [800, 2000, 4500, 9000].forEach(function (ms) { setTimeout(function () { wrap(); refresh(); }, ms); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
}catch(e){console.error('[merged:acacia-fixes-3.js]',e)}
/* ===================== acacia-fixes-4.js ===================== */
try{
/*
 * acacia-fixes-4.js — Bank ↔ source sync
 *
 *  1. Operational costs (incl. Plan expenses): when a cost is deleted, or is
 *     paid via a current account, its row is removed from Bank → Manual
 *     Transactions (and the bank "transactions" list). IDs are compared as
 *     text so number/string mismatches no longer leave orphan rows.
 *  2. Current / non-current asset purchases: deleting the asset removes its
 *     bank row; deleting the bank row removes the asset (moved to Recycle Bin).
 *     Same two-way link for operational costs.
 *  3. Stock adjustments: deleting an adjustment immediately re-posts the
 *     adjustment cost, so Cost of Goods Sold / P&L update right away.
 *
 *  Orphan clean-up never changes bank balances: the original delete already
 *  reversed the balance, so touching it again would double count.
 */
(function () {
  "use strict";
  if (window.__acxFix4) return;
  window.__acxFix4 = true;

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function S(v) { return v == null ? "" : String(v); }
  function call(fn) { try { if (typeof window[fn] === "function") window[fn](); } catch (e) {} }
  function recycle(rec, mod) { try { if (typeof moveToRecycle === "function") moveToRecycle(rec, "File", mod); } catch (e) {} }

  /* keep in-memory arrays (used by some renders) in step with storage */
  function syncMem(list) {
    try {
      /* eslint-disable no-undef */
      if (typeof manualTransactions !== "undefined" && Array.isArray(manualTransactions)) {
        manualTransactions.length = 0;
        list.forEach(function (t) { manualTransactions.push(t); });
      }
    } catch (e) {}
  }

  function allAssetIds() {
    var ids = {};
    var bs = get("balanceSheet", {}) || {};
    Object.keys(bs).forEach(function (k) {
      if (Array.isArray(bs[k])) bs[k].forEach(function (a) { if (a && a.id != null && a.status !== "deleted") ids[S(a.id)] = 1; });
    });
    ["currentAssets", "nonCurrentAssets", "fixedAssets"].forEach(function (k) {
      var a = get(k, null); if (Array.isArray(a)) a.forEach(function (x) { if (x && x.id != null) ids[S(x.id)] = 1; });
    });
    return ids;
  }

  function refreshViews() {
    ["renderManualTransactions", "renderBankTable", "updateBankSummary", "renderReconciliationTransactions",
     "renderOperationalCosts", "updateExpensesCard", "renderBalanceSheet", "renderReports", "renderProfitLoss",
     "renderProfitMargin", "phRenderExpenses", "__refreshDashCashFlow"].forEach(call);
  }

  /* ---------- 1 & 2: remove bank rows whose source is gone ---------- */
  function reconcileBank() {
    var costs = get("operationalCosts", []) || [];
    var costById = {};
    costs.forEach(function (c) { if (c && c.id != null) costById[S(c.id)] = c; });
    var assets = allAssetIds();
    var hasAssets = Object.keys(get("balanceSheet", {}) || {}).length > 0;

    function orphan(t) {
      if (!t) return true;
      if (t.operationalCostId != null && t.operationalCostId !== "") {
        var c = costById[S(t.operationalCostId)];
        if (!c) return true;                         // cost deleted
        if (c.paidVia === "current") return true;    // not a bank payment
        if (c.paidVia === "Stock Adjustment" || c.source === "stockAdjustment") return true; // non-cash
      }
      if (t.source === "asset_purchase" && t.assetId != null && hasAssets && !assets[S(t.assetId)]) return true;
      return false;
    }

    var changed = false;
    var manual = get("manualTransactions", []) || [];
    var keep = manual.filter(function (t) { return !orphan(t); });
    if (keep.length !== manual.length) { set("manualTransactions", keep); syncMem(keep); changed = true; }

    var tx = get("transactions", []) || [];
    var keepTx = tx.filter(function (t) { return !(t && t.operationalCostId != null && t.operationalCostId !== "" && orphan(t)); });
    if (keepTx.length !== tx.length) { set("transactions", keepTx); changed = true; }

    /* operational costs created from a bank entry whose bank entry is gone */
    var manIds = {};
    keep.forEach(function (t) { if (t && t.id != null) manIds[S(t.id)] = 1; });
    var keepCosts = costs.filter(function (c) {
      return !(c && c.source === "fundsTransaction" && c.linkedManualTxId != null && !manIds[S(c.linkedManualTxId)]);
    });
    if (keepCosts.length !== costs.length) { set("operationalCosts", keepCosts); changed = true; }

    if (changed) refreshViews();
    return changed;
  }
  window.acxSyncBankLinks = reconcileBank;

  /* ---------- 2b: deleting a bank row also removes its source ---------- */
  function wrapDeleteManual() {
    var orig = window.deleteManualTransaction;
    if (typeof orig !== "function" || orig.__acx4) return;
    var w = function (id) {
      var before = (get("manualTransactions", []) || []).find(function (t) { return t && S(t.id) === S(id); });
      var r = orig.apply(this, arguments);
      try {
        if (!before) return r;
        var still = (get("manualTransactions", []) || []).some(function (t) { return t && S(t.id) === S(id); });
        if (still) return r; // user cancelled
        var touched = false;

        if (before.operationalCostId != null && before.operationalCostId !== "") {
          var costs = get("operationalCosts", []) || [];
          var gone = costs.filter(function (c) { return c && S(c.id) === S(before.operationalCostId); });
          if (gone.length) {
            gone.forEach(function (c) { recycle(c, "OperationalCosts"); });
            set("operationalCosts", costs.filter(function (c) { return !(c && S(c.id) === S(before.operationalCostId)); }));
            var tx = (get("transactions", []) || []).filter(function (t) { return !(t && S(t.operationalCostId) === S(before.operationalCostId)); });
            set("transactions", tx);
            touched = true;
          }
        }

        if (before.source === "asset_purchase" && before.assetId != null) {
          var bs = get("balanceSheet", {}) || {};
          Object.keys(bs).forEach(function (k) {
            if (!Array.isArray(bs[k])) return;
            var hit = bs[k].filter(function (a) { return a && S(a.id) === S(before.assetId); });
            if (!hit.length) return;
            hit.forEach(function (a) { recycle(a, "Assets"); });
            bs[k] = bs[k].filter(function (a) { return !(a && S(a.id) === S(before.assetId)); });
            try { if (typeof balanceSheet !== "undefined" && balanceSheet && Array.isArray(balanceSheet[k])) balanceSheet[k] = bs[k]; } catch (e) {}
            touched = true;
          });
          if (touched) {
            set("balanceSheet", bs);
            ["renderNonCurrentAssets", "renderNonCurrentAssetsSummary", "renderBalanceSheetAssets",
             "syncNonCurrentAssetsToOpeningBalances", "renderCurrentAssets"].forEach(call);
          }
        }
        if (touched) refreshViews();
      } catch (e) { console.error("[acacia-fixes-4] delete sync", e); }
      return r;
    };
    w.__acx4 = true;
    window.deleteManualTransaction = w;
  }

  /* ---------- after any source delete, clean bank immediately ---------- */
  function wrapAfter(name, fn) {
    var orig = window[name];
    if (typeof orig !== "function" || orig["__acx4" + name]) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { fn(); } catch (e) {}
      setTimeout(function () { try { fn(); } catch (e) {} }, 300);
      return r;
    };
    w["__acx4" + name] = true;
    window[name] = w;
  }

  /* ---------- 3: adjustments → Cost of Goods Sold ---------- */
  function syncCOGS() {
    if (typeof window.syncAdjustmentCostsToPnL === "function") {
      try { window.syncAdjustmentCostsToPnL(); } catch (e) {}
    }
    reconcileBank();
    ["renderProfitLoss", "renderProfitMargin", "renderReports", "renderTrialBalance", "renderBalanceSheet",
     "renderOperationalCosts", "updateExpensesCard", "renderAmendedWarehouseMovement", "renderStockReports"].forEach(call);
  }
  window.acxSyncAdjustmentCOGS = syncCOGS;

  function install() {
    wrapDeleteManual();
    ["deleteOperationalCost", "bulkDeleteOperationalCosts", "phDeleteExpense", "deleteNonCurrentAsset",
     "deleteAsset", "deleteCurrentAsset", "bulkDeleteAssets", "saveOperationalCost", "phAddExpense"]
      .forEach(function (n) { wrapAfter(n, reconcileBank); });
    ["deleteAmendment", "bulkDeleteAmendments", "bulkDeleteAdjustments", "deleteBulkAdjustment",
     "deleteAdjustment", "editAmendment"]
      .forEach(function (n) { wrapAfter(n, syncCOGS); });
  }

  function boot() {
    install();
    setTimeout(function () { install(); reconcileBank(); syncCOGS(); }, 2000);
    setInterval(function () { install(); reconcileBank(); }, 5000);
    window.addEventListener("storage", function () { setTimeout(reconcileBank, 400); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
}catch(e){console.error('[merged:acacia-fixes-4.js]',e)}
/* ===================== acacia-contrast-fix.js ===================== */
try{
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
}catch(e){console.error('[merged:acacia-contrast-fix.js]',e)}

/* ===================== bulk-adjustment-edit ===================== */
try{
/* Bulk Adjustments > Bulk Adjustment Log: "Bulk Edit" button (next to Bulk Delete).
 * Tick one or more log entries -> Bulk Edit -> change the Adjustment (+/-) and Reason of all of them in one
 * window -> Save. Stock is corrected the same way the single Edit does it:
 *   Applied entry : stock changes by (new adjustment - old adjustment); New Qty = Old Qty + adjustment.
 *   Draft entry   : only the draft adjustment / reason change, stock is not touched.
 */
(function(){
  "use strict";
  if (window.__acxBulkAdjEdit) return;
  window.__acxBulkAdjEdit = true;

  function $(i){ return document.getElementById(i); }
  function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function lsGet(k, d){ try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function note(m, t){
    if (typeof window.showNotification === "function") { try { window.showNotification(m, t || "success"); return; } catch (e) {} }
    alert(m);
  }
  function chgOf(e){ return Number(e.change != null ? e.change : (e.adjustment || 0)) || 0; }
  function findItem(items, en){
    return items.find(function(x){ return String(x.id || x.sku || x.name) === String(en.itemId || en.sku || en.product); });
  }
  function locate(list, r){
    if (list[r.idx] && list[r.idx].id === r.id) return r.idx;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === r.id && list[i].product === r.product) return i;
    return -1;
  }

  /* ---- selection + button visibility ---- */
  function selected(){
    var out = [];
    document.querySelectorAll("#baLogBody .baLogCheckbox:checked").forEach(function(c){
      out.push({ wh: c.getAttribute("data-wh"), idx: parseInt(c.getAttribute("data-idx"), 10) });
    });
    return out;
  }
  function syncBtn(){
    var b = $("baLogBulkEditBtn"); if (!b) return;
    var n = document.querySelectorAll("#baLogBody .baLogCheckbox:checked").length;
    b.style.display = n > 0 ? "inline-block" : "none";
    b.textContent = n > 1 ? "Bulk Edit (" + n + ")" : "Bulk Edit";
  }
  function later(){ setTimeout(syncBtn, 0); }
  document.addEventListener("change", later, true);
  document.addEventListener("click", later, true);
  (function hookRender(tries){
    if (typeof window.renderBulkAdjustmentLog === "function" && !window.renderBulkAdjustmentLog.__acxEdit) {
      var orig = window.renderBulkAdjustmentLog;
      window.renderBulkAdjustmentLog = function(){
        var r = orig.apply(this, arguments);
        try { syncBtn(); } catch (e) {}
        return r;
      };
      window.renderBulkAdjustmentLog.__acxEdit = true;
    } else if (tries < 40) setTimeout(function(){ hookRender(tries + 1); }, 500);
  })(0);

  /* ---- modal ---- */
  var modal = null, rows = [];
  function closeModal(){ if (modal && modal.parentNode) modal.parentNode.removeChild(modal); modal = null; rows = []; document.removeEventListener("keydown", onKey, true); }
  function onKey(e){ if (e.key === "Escape") closeModal(); }

  function recalc(tr){
    var r = rows[+tr.getAttribute("data-k")];
    var inp = tr.querySelector(".acxAdj"), cell = tr.querySelector(".acxNew");
    var v = parseFloat(inp.value);
    if (r.draft) { cell.textContent = "Draft"; return; }
    cell.textContent = isNaN(v) ? "-" : String(Number(r.oldQty) + v);
  }

  window.bulkEditBAAdjLog = function(){
    var picks = selected();
    if (!picks.length) { note("Select adjustments first", "error"); return; }
    closeModal();
    rows = [];
    picks.forEach(function(p){
      var e = (lsGet("bulkAdjustments_" + p.wh, []) || [])[p.idx];
      if (e) rows.push({ wh: p.wh, idx: p.idx, id: e.id, product: e.product, sku: e.sku || "", oldQty: Number(e.oldQty) || 0, change: chgOf(e), reason: e.reason || "", draft: e.status === "Draft" });
    });
    if (!rows.length) { note("Selected entries were not found", "error"); return; }
    rows.sort(function(a, b){ return a.wh === b.wh ? a.idx - b.idx : (a.wh < b.wh ? -1 : 1); });

    var inpCss = "border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:13px;color:#111827;background:#fff;";
    var body = rows.map(function(r, k){
      return '<tr data-k="' + k + '" style="border-top:1px solid #e5e7eb">' +
        '<td style="padding:8px">' + esc(r.wh) + '</td>' +
        '<td style="padding:8px">' + esc(r.product || "") + (r.draft ? ' <span style="font-size:11px;padding:1px 6px;border-radius:4px;background:#fef3c7;color:#92400e">Draft</span>' : '') + '</td>' +
        '<td style="padding:8px">' + esc(r.sku || "-") + '</td>' +
        '<td style="padding:8px;text-align:right">' + esc(r.oldQty) + '</td>' +
        '<td style="padding:8px"><input type="number" step="any" class="acxAdj" value="' + esc(r.change) + '" style="' + inpCss + 'width:100px;text-align:right"></td>' +
        '<td class="acxNew" style="padding:8px;text-align:right"></td>' +
        '<td style="padding:8px"><input type="text" class="acxReason" value="' + esc(r.reason) + '" style="' + inpCss + 'width:100%;min-width:160px"></td></tr>';
    }).join("");

    modal = document.createElement("div");
    modal.id = "acxBulkAdjEditModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML =
      '<div style="background:#fff;color:#111827;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);width:min(960px,100%);max-height:90vh;display:flex;flex-direction:column;font-family:inherit">' +
        '<div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">' +
          '<div><div style="font-weight:700;font-size:15px">Bulk Edit Adjustments (' + rows.length + ')</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:2px">Change the adjustment (+/-) and reason. Stock is corrected automatically for applied entries; drafts do not touch stock.</div></div>' +
          '<button type="button" id="acxBAEClose" style="font-size:22px;line-height:1;color:#6b7280;background:none;border:0;cursor:pointer">&times;</button></div>' +
        '<div style="padding:10px 18px;border-bottom:1px solid #f3f4f6;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:13px">' +
          '<span>Set for all:</span>' +
          '<input type="text" id="acxBAEAllReason" placeholder="Reason" style="' + inpCss + 'width:220px">' +
          '<button type="button" id="acxBAEAllReasonBtn" style="padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;color:#111827;cursor:pointer">Apply reason</button>' +
          '<input type="number" step="any" id="acxBAEAllAdj" placeholder="Adjustment" style="' + inpCss + 'width:120px">' +
          '<button type="button" id="acxBAEAllAdjBtn" style="padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;color:#111827;cursor:pointer">Apply adjustment</button></div>' +
        '<div style="overflow:auto;padding:0 18px"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
          '<thead><tr style="text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase">' +
          '<th style="padding:8px">Warehouse</th><th style="padding:8px">Product</th><th style="padding:8px">SKU</th><th style="padding:8px;text-align:right">Old Qty</th><th style="padding:8px">Adjustment (+/-)</th><th style="padding:8px;text-align:right">New Qty</th><th style="padding:8px">Reason</th></tr></thead>' +
          '<tbody>' + body + '</tbody></table></div>' +
        '<div style="padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px">' +
          '<button type="button" id="acxBAECancel" style="padding:7px 16px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-size:14px">Cancel</button>' +
          '<button type="button" id="acxBAESave" style="padding:7px 16px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;font-size:14px;font-weight:600">Save Changes</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.addEventListener("keydown", onKey, true);

    modal.querySelectorAll("tr[data-k]").forEach(function(tr){
      recalc(tr);
      tr.querySelector(".acxAdj").addEventListener("input", function(){ recalc(tr); });
    });
    modal.addEventListener("mousedown", function(e){ if (e.target === modal) closeModal(); });
    $("acxBAEClose").onclick = closeModal;
    $("acxBAECancel").onclick = closeModal;
    $("acxBAESave").onclick = saveAll;
    $("acxBAEAllReasonBtn").onclick = function(){
      var v = $("acxBAEAllReason").value;
      modal.querySelectorAll(".acxReason").forEach(function(i){ i.value = v; });
    };
    $("acxBAEAllAdjBtn").onclick = function(){
      var v = $("acxBAEAllAdj").value;
      if (v === "" || isNaN(parseFloat(v))) { note("Enter an adjustment number first", "error"); return; }
      modal.querySelectorAll("tr[data-k]").forEach(function(tr){ tr.querySelector(".acxAdj").value = v; recalc(tr); });
    };
  };

  /* ---- save ---- */
  function saveAll(){
    if (!modal) return;
    var plan = [], bad = false;
    modal.querySelectorAll("tr[data-k]").forEach(function(tr){
      var r = rows[+tr.getAttribute("data-k")];
      var a = tr.querySelector(".acxAdj"), v = parseFloat(a.value);
      if (String(a.value).trim() === "" || isNaN(v)) { bad = true; a.style.borderColor = "#dc2626"; return; }
      a.style.borderColor = "#d1d5db";
      plan.push({ r: r, adj: v, reason: tr.querySelector(".acxReason").value });
    });
    if (bad) { note("Enter a valid adjustment in the highlighted rows", "error"); return; }

    var byWh = {};
    plan.forEach(function(p){ (byWh[p.r.wh] = byWh[p.r.wh] || []).push(p); });

    var lists = {}, invs = {}, invDirty = {}, negatives = [], changed = 0, missing = 0, before = [], after = [];
    Object.keys(byWh).forEach(function(wh){
      var list = lsGet("bulkAdjustments_" + wh, []) || [];
      var items = lsGet("inventory_" + wh, []) || [];
      var listDirty = false;
      byWh[wh].forEach(function(p){
        var i = locate(list, p.r);
        if (i < 0) { missing++; return; }
        var en = list[i], oldChg = chgOf(en), draft = en.status === "Draft";
        var sameAdj = oldChg === p.adj, sameReason = String(en.reason || "") === String(p.reason || "");
        if (sameAdj && sameReason) return;
        if (!sameAdj) {
          var base = Number(en.oldQty) || 0;
          en.change = p.adj; en.adjustment = p.adj;
          if (!draft) {
            en.newQty = base + p.adj;
            var it = findItem(items, en);
            if (it) {
              it.qty = Number(it.qty || 0) + (p.adj - oldChg);
              invDirty[wh] = true;
              if (it.qty < 0) negatives.push((en.product || en.sku || "item") + " (" + wh + "): " + it.qty);
            }
          }
        }
        if (!sameReason) en.reason = p.reason;
        en.editedAt = new Date().toISOString();
        list[i] = en; listDirty = true; changed++;
        before.push((en.product || en.sku) + ": " + oldChg);
        after.push((en.product || en.sku) + ": " + p.adj);
      });
      if (listDirty) lists[wh] = list;
      if (invDirty[wh]) invs[wh] = items;
    });

    if (!changed) { closeModal(); note(missing ? "Entries no longer exist" : "No changes to save", missing ? "error" : "info"); return; }
    if (negatives.length && !confirm("These items would end up with negative stock:\n\n" + negatives.slice(0, 8).join("\n") + (negatives.length > 8 ? "\n…" : "") + "\n\nSave anyway?")) return;

    Object.keys(invs).forEach(function(wh){ lsSet("inventory_" + wh, invs[wh]); });
    Object.keys(lists).forEach(function(wh){ lsSet("bulkAdjustments_" + wh, lists[wh]); });

    closeModal();
    try { var th = document.querySelector('#BulkAdjustment #baLogBody'); th = th && th.closest("table"); var hc = th && th.querySelector('thead input[type="checkbox"]'); if (hc) hc.checked = false; } catch (e) {}
    if (typeof window.renderBulkAdjustmentLog === "function") { try { window.renderBulkAdjustmentLog(); } catch (e) {} }
    if (typeof window.renderBAProducts === "function") { try { window.renderBAProducts(); } catch (e) {} }
    if (Object.keys(invs).length) ["renderInventoryTable", "renderBalanceSheet", "renderInventorySummary", "renderStockValuation"].forEach(function(fn){ if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} } });
    try { if (typeof window.logActivity === "function") window.logActivity({ action: "Edited", module: "Bulk Adjustment", description: "Bulk edited " + changed + " adjustment log entr" + (changed === 1 ? "y" : "ies"), originalValue: before.join("; "), editedValue: after.join("; ") }); } catch (e) {}
    syncBtn();
    note(changed + " adjustment" + (changed === 1 ? "" : "s") + " updated" + (missing ? " (" + missing + " no longer existed)" : ""), "success");
  }
})();
}catch(e){console.error('[merged:bulk-adjustment-edit]',e)}

/* ===================== inventory-import-export-fix ===================== */
try{
/* Inventory > Export / Import now round-trips SKU and the Chart of Account fields.
 *  EXPORT  fixed columns (always present, even when the first item has no SKU/account):
 *          Name, SKU, Quantity, Buying Price, Selling Price, Buying VAT Rule, Selling VAT Rule,
 *          Buying Account Code, Buying Account, Selling Account Code, Selling Account, Description, Active, Batches
 *  IMPORT  headers are matched loosely (SKU / Item Code, Chart of Account / Buying Account / Inventory Account,
 *          Selling Account / Income Account, Qty / Quantity ...). An account may be given as the code OR the
 *          account name; it is stored as the Chart of Accounts code. Numbers typed as text are converted.
 *          History / batches / active status of an item that already exists (same SKU or name) are kept.
 */
(function(){
  "use strict";
  if (window.__acxInvIO) return;
  window.__acxInvIO = true;

  function lsGet(k, d){ try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function wh(){ var s = document.getElementById("warehouseSelect"); return s ? s.value : ""; }
  function coa(){ var a = lsGet("chartOfAccounts", []); return Array.isArray(a) ? a : []; }
  function norm(h){ return String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function str(v){ return v == null ? "" : String(v).trim(); }
  function num(v){
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function accByCode(code){ code = str(code); if (!code) return null; return coa().find(function(a){ return str(a.code) === code; }) || null; }
  function accByName(name){ name = str(name).toLowerCase(); if (!name) return null; return coa().find(function(a){ return str(a.name).toLowerCase() === name; }) || null; }
  function accName(code){ var a = accByCode(code); return a ? str(a.name) : ""; }

  var COLS = [
    ["name", "Name"], ["sku", "SKU"], ["qty", "Quantity"], ["buyPrice", "Buying Price"], ["sellPrice", "Selling Price"],
    ["buyVat", "Buying VAT Rule"], ["sellVat", "Selling VAT Rule"],
    ["buyingAccount", "Buying Account Code"], ["buyingAccountName", "Buying Account"],
    ["sellingAccount", "Selling Account Code"], ["sellingAccountName", "Selling Account"],
    ["sellDescription", "Description"], ["active", "Active"], ["batches", "Batches"]
  ];
  var ALIAS = {
    name: "name item itemname product productname title",
    sku: "sku skucode itemcode productcode partno partnumber stockcode itemsku productsku",
    qty: "qty quantity stock onhand quantityonhand openingstock openingqty stockqty currentqty",
    buyPrice: "buyprice buyingprice costprice cost purchaseprice unitcost buyingcost",
    sellPrice: "sellprice sellingprice price saleprice unitprice retailprice salesprice",
    buyVat: "buyvat buyingvat buyvatrule buyingvatrule purchasevat vatrule vat",
    sellVat: "sellvat sellingvat sellvatrule sellingvatrule salesvat",
    buyingAccount: "buyingaccount buyingaccountcode buyaccount buyaccountcode purchaseaccount inventoryaccount assetaccount chartofaccount chartofaccounts chartaccount chartofaccountcode account accountcode coa coaaccount coacode costaccount",
    buyingAccountName: "buyingaccountname buyaccountname inventoryaccountname chartofaccountname accountname",
    sellingAccount: "sellingaccount sellingaccountcode sellaccount sellaccountcode salesaccount salesaccountcode incomeaccount incomeaccountcode revenueaccount",
    sellingAccountName: "sellingaccountname sellaccountname salesaccountname incomeaccountname",
    sellDescription: "selldescription description desc sellingdescription salesdescription notes",
    active: "active status isactive",
    batches: "batches batchlist",
    batchNo: "batchno batchnumber batch lotno lot",
    mfgDate: "mfgdate manufacturedate manufacturingdate",
    expiryDate: "expirydate expiry expdate expirationdate bestbefore"
  };
  var HMAP = {};
  Object.keys(ALIAS).forEach(function(k){ ALIAS[k].split(" ").forEach(function(a){ if (!HMAP[a]) HMAP[a] = k; }); });

  function batchesToStr(b){
    if (!Array.isArray(b) || !b.length) return "";
    return b.map(function(x){ return [x.batchNo || "", x.mfgDate || "", x.expiryDate || "", x.qty == null ? 0 : x.qty].join("|"); }).join("; ");
  }
  function strToBatches(s){
    s = str(s); if (!s) return [];
    return s.split(";").map(function(p){
      var f = p.split("|").map(function(x){ return x.trim(); });
      return { batchNo: f[0] || "", mfgDate: f[1] || "", expiryDate: f[2] || "", qty: num(f[3]) };
    }).filter(function(b){ return b.batchNo || b.expiryDate || b.qty; });
  }
  function isOff(v){ return /^(false|no|n|0|inactive|disabled)$/i.test(str(v)); }

  /* ---------------- export ---------------- */
  window.exportInventoryExcel = function(){
    var w = wh();
    if (!w) return alert("Please select a warehouse first.");
    var items = lsGet("inventory_" + w, []);
    if (!Array.isArray(items) || !items.length) return alert("No items to export.");
    var rows = items.map(function(it){
      return {
        name: it.name || "", sku: it.sku || "", qty: it.qty == null ? 0 : it.qty,
        buyPrice: it.buyPrice == null ? 0 : it.buyPrice, sellPrice: it.sellPrice == null ? 0 : it.sellPrice,
        buyVat: it.buyVat || "", sellVat: it.sellVat || "",
        buyingAccount: it.buyingAccount || "", buyingAccountName: accName(it.buyingAccount),
        sellingAccount: it.sellingAccount || "", sellingAccountName: accName(it.sellingAccount),
        sellDescription: it.sellDescription || "", active: it.active === false ? "No" : "Yes", batches: batchesToStr(it.batches)
      };
    });
    var head = COLS.map(function(c){ return c[1]; });
    var matrix = rows.map(function(r){ return COLS.map(function(c){ return r[c[0]]; }); });
    var stamp = new Date().toISOString().slice(0, 10);
    var base = String(w).replace(/[^a-z0-9]+/gi, "_") + "_Inventory_" + stamp;
    function doExport(kind){
      if (kind === "excel") {
        if (window.XLSX) {
          var ws = XLSX.utils.aoa_to_sheet([head].concat(matrix)), wb = XLSX.utils.book_new();
          ws["!cols"] = head.map(function(h){ return { wch: Math.max(12, h.length + 2) }; });
          XLSX.utils.book_append_sheet(wb, ws, String(w).slice(0, 31));
          XLSX.writeFile(wb, base + ".xlsx");
          return;
        }
        kind = "excelFallback";
      }
      var t = window.__exportFormatTools;
      if (!t) return alert("Export tools are still loading — please try again in a moment.");
      if (kind === "pdf") t.downloadPDF(base, "Inventory — " + w, head, matrix);
      else if (kind === "excelFallback") t.downloadExcel(base, head, matrix);
      else t.downloadCSV(base, head, matrix);
    }
    if (window.__exportFormatTools && window.__exportFormatTools.askFormat) window.__exportFormatTools.askFormat(doExport);
    else doExport("excel");
  };

  /* ---------------- import ---------------- */
  function convert(rawRows, existing){
    var present = {}, report = { rows: 0, skipped: 0, noSku: 0, noBuyAcc: 0, noSellAcc: 0, unknown: {} };
    var out = [];
    var byKey = {};
    (existing || []).forEach(function(it){
      if (!it) return;
      if (str(it.sku)) byKey["s:" + str(it.sku).toLowerCase()] = it;
      if (str(it.name)) byKey["n:" + str(it.name).toLowerCase()] = it;
    });
    rawRows.forEach(function(raw){
      var f = {}, extra = {}, has = {};
      Object.keys(raw).forEach(function(h){
        var k = HMAP[norm(h)];
        if (k && !has[k]) { f[k] = raw[h]; has[k] = true; present[k] = true; }
        else if (!k) extra[String(h).trim()] = raw[h];
      });
      var name = str(f.name);
      if (!name) { report.skipped++; return; }
      var sku = str(f.sku);
      var old = (sku && byKey["s:" + sku.toLowerCase()]) || byKey["n:" + name.toLowerCase()] || null;

      function acct(codeVal, nameVal, oldVal, label){
        var v = str(codeVal), a = null;
        if (v) { a = accByCode(v) || accByName(v); }
        if (!a && str(nameVal)) { a = accByName(nameVal) || accByCode(nameVal); if (!a && !v) v = str(nameVal); }
        if (a) return str(a.code);
        if (v) { report.unknown[v] = true; return v; }
        return oldVal || "";
      }
      var buyAcc = acct(f.buyingAccount, f.buyingAccountName, old && old.buyingAccount);
      var sellAcc = acct(f.sellingAccount, f.sellingAccountName, old && old.sellingAccount);

      var batches = has.batches ? strToBatches(f.batches) : null;
      if (!batches && (str(f.batchNo) || str(f.expiryDate) || str(f.mfgDate))) {
        batches = [{ batchNo: str(f.batchNo), mfgDate: str(f.mfgDate), expiryDate: str(f.expiryDate), qty: num(f.qty) }];
      }
      if (!batches) batches = old && Array.isArray(old.batches) ? old.batches : [];
      var qty = num(f.qty);
      if (!has.qty && old) qty = num(old.qty);
      if (batches.length && (has.batches || str(f.batchNo) || str(f.expiryDate))) {
        var bs = batches.reduce(function(s, b){ return s + (parseFloat(b.qty) || 0); }, 0);
        if (bs) qty = bs;
      }
      var it = Object.assign({}, extra, {
        name: name, sku: sku || (old ? str(old.sku) : ""), qty: qty, batches: batches,
        buyPrice: has.buyPrice ? num(f.buyPrice) : (old ? num(old.buyPrice) : 0),
        sellPrice: has.sellPrice ? num(f.sellPrice) : (old ? num(old.sellPrice) : 0),
        buyVat: has.buyVat ? str(f.buyVat) : (old ? old.buyVat || "" : ""),
        sellVat: has.sellVat ? str(f.sellVat) : (old ? old.sellVat || "" : ""),
        buyingAccount: buyAcc, sellingAccount: sellAcc,
        sellDescription: has.sellDescription ? str(f.sellDescription) : (old ? old.sellDescription || "" : ""),
        active: has.active && str(f.active) !== "" ? !isOff(f.active) : (old && old.active === false ? false : true),
        history: old && Array.isArray(old.history) ? old.history : []
      });
      if (!it.sku) report.noSku++;
      if (!it.buyingAccount) report.noBuyAcc++;
      if (!it.sellingAccount) report.noSellAcc++;
      out.push(it); report.rows++;
    });
    return { items: out, report: report };
  }

  window.importInventoryExcel = function(ev){
    var input = ev.target, w = wh();
    if (!w) { alert("Please select a warehouse first."); input.value = ""; return; }
    var file = input.files && input.files[0];
    if (!file) return;
    var isCsv = /\.csv$/i.test(file.name || "");
    if (!(isCsv || /\.(xlsx|xls|xlsm)$/i.test(file.name || ""))) {
      alert('❌ Please choose a .xlsx, .xls or .csv file. "' + (file.name || "That file") + "\" doesn't look like a spreadsheet.");
      input.value = ""; return;
    }
    function finish(rows){
      try {
        if (!Array.isArray(rows) || !rows.length) { alert("⚠️ No rows found in that file. Make sure the first sheet has a header row followed by data rows."); return; }
        var existing = lsGet("inventory_" + w, []);
        var res = convert(rows, Array.isArray(existing) ? existing : []);
        if (!res.items.length) { alert("⚠️ No usable rows. Each row needs an item Name (headers such as Name, Item or Product)."); return; }
        /* MERGE (not replace): update items that match by SKU / name, add new ones, keep everything else already in the warehouse */
        var base = Array.isArray(existing) ? existing.slice() : [];
        var idxS = {}, idxN = {};
        base.forEach(function(it, i){
          if (!it) return;
          if (str(it.sku)) idxS[str(it.sku).toLowerCase()] = i;
          if (str(it.name)) idxN[str(it.name).toLowerCase()] = i;
        });
        var added = 0, updated = 0;
        res.items.forEach(function(it){
          var k = str(it.sku).toLowerCase(), n = str(it.name).toLowerCase();
          var at = (k && idxS[k] !== undefined) ? idxS[k] : (n && idxN[n] !== undefined ? idxN[n] : -1);
          if (at >= 0) { base[at] = it; updated++; }
          else {
            base.push(it); added++;
            var ni = base.length - 1;
            if (k) idxS[k] = ni;
            if (n) idxN[n] = ni;
          }
        });
        res.report.added = added; res.report.updated = updated;
        localStorage.setItem("inventory_" + w, JSON.stringify(base));
        ["syncInventoryBalancesToCOA"].forEach(function(fn){ if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} } });
        ["renderInventoryTable", "renderAccounts", "renderBalanceSheet", "renderInventorySummary", "renderStockValuation", "renderStockReports"].forEach(function(fn){
          if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} }
        });
        var r = res.report, msg = "✅ Imported " + r.rows + " item(s): " + r.added + " added, " + r.updated + " updated. Existing items not in the file were kept.";
        if (r.skipped) msg += "\n• " + r.skipped + " row(s) skipped (no item name).";
        var unk = Object.keys(r.unknown);
        if (unk.length) msg += "\n⚠️ Account not found in your Chart of Accounts: " + unk.slice(0, 6).join(", ") + (unk.length > 6 ? " …" : "") + " (add it under Chart of Accounts or fix the file).";
        if (r.noBuyAcc) msg += "\n⚠️ " + r.noBuyAcc + " item(s) have no Buying / Chart of Account.";
        if (r.noSellAcc) msg += "\n⚠️ " + r.noSellAcc + " item(s) have no Selling Account.";
        if (r.noSku) msg += "\n• " + r.noSku + " item(s) have no SKU.";
        alert(msg);
      } catch (e) {
        console.error("Inventory import failed:", e);
        alert("❌ Error reading file: " + (e && e.message ? e.message : e));
      } finally { input.value = ""; }
    }
    var fr = new FileReader();
    fr.onerror = function(){ alert("❌ Could not read that file from disk. Please try picking it again."); input.value = ""; };
    if (isCsv) {
      fr.onload = function(e){
        try { finish((window.__invParseCSV || function(){ return []; })(e.target.result)); }
        catch (err) { console.error(err); alert("❌ Error reading CSV file: " + (err && err.message ? err.message : err)); input.value = ""; }
      };
      fr.readAsText(file); return;
    }
    fr.onload = function(e){
      var buf = e.target.result;
      var ensure = window.__ensureXLSXLib || function(ok){ ok(); };
      ensure(function(){
        try {
          var wb = XLSX.read(new Uint8Array(buf), { type: "array" });
          if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw new Error("The file has no readable sheets.");
          finish(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true }));
        } catch (err) {
          console.error("Inventory Excel import failed:", err);
          alert("❌ Error reading Excel file: " + (err && err.message ? err.message : err) + "\n\nTip: saving it as .csv also works.");
          input.value = "";
        }
      }, function(err){ alert("❌ " + err.message); input.value = ""; });
    };
    fr.readAsArrayBuffer(file);
  };
})();
}catch(e){console.error('[merged:inventory-import-export-fix]',e)}

/* ---- Term days guard (Sales Hub + Purchase Hub): a saved term value must always render in its dropdown ---- */
(function(){
  var IDS=["invoiceNetDays","bulkInvoiceNetDays","orderNetDays","recurringInvoiceNetDays","quoteValidity","creditValidity","poValidity","billTermDays","bulkBillTermDays","rbTermDays"];
  var nativeSet=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value");
  function label(n){return n===0?"Due on Receipt":"On Receipt + "+n+" days"}
  function ensure(sel,v){
    if(v===null||v===undefined||v===""||v==="__add_new__")return;
    var raw=String(v);
    var has=function(x){return Array.prototype.some.call(sel.options,function(o){return o.value===x})};
    if(has(raw))return;
    var m=raw.match(/\d+/); if(!m)return;
    var n=parseInt(m[0],10), val=String(n);
    if(has(val))return;
    var opt=document.createElement("option"); opt.value=val; opt.textContent=label(n);
    var before=null;
    Array.prototype.forEach.call(sel.options,function(o){ if(before||o.value===""||o.value==="__add_new__"){ if(!before&&o.value==="__add_new__")before=o; return; } if(parseInt(o.value,10)>n)before=o; });
    before?sel.insertBefore(opt,before):sel.appendChild(opt);
  }
  function patch(sel){
    if(!sel||sel.__acxTermGuard)return; sel.__acxTermGuard=1;
    /* make sure "Due on Receipt" (0) exists everywhere */
    ensure(sel,"0");
    Object.defineProperty(sel,"value",{configurable:true,
      get:function(){return nativeSet.get.call(sel)},
      set:function(v){var raw=(v===null||v===undefined)?"":String(v); var m=raw.match(/\d+/); ensure(sel, raw!==""&&!/^\d+$/.test(raw)&&m?m[0]:v); nativeSet.set.call(sel, (raw!==""&&!/^\d+$/.test(raw)&&m)?String(parseInt(m[0],10)):v);}
    });
  }
  function run(){IDS.forEach(function(id){document.querySelectorAll('[id="'+id+'"]').forEach(patch)})}
  run();
  if(document.readyState!=="complete")window.addEventListener("load",run);
  try{ var tm=0; new MutationObserver(function(){ if(tm)return; tm=setTimeout(function(){tm=0;run()},400); }).observe(document.body,{childList:true,subtree:true}); }catch(e){}
})();
