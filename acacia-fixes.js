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
      wrapAll();                 // afterChange around everything (outermost)
    } catch (e) { console.error("[acacia-fixes] install failed", e); }
  }
  install();
  if (document.readyState !== "complete") W.addEventListener("load", function () { setTimeout(install, 0); });
  setTimeout(install, 1500); // late scripts (sync.js, recycle-restore.js) may redefine handlers
})();
