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
