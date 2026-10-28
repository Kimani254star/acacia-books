/* acacia-numbering.js
 * Settings > Customization > Numbering is the single source of truth for document numbers.
 *
 * Every document type below asks acxDocNo(key) for its next number. The number is
 *     prefix + (highest number already used with that prefix + 1, never lower than "Next #") padded + suffix
 * so it never repeats, survives deleted/edited documents and does not burn numbers when a form is opened and closed.
 *
 *   Reset = "never"   : continues forever.
 *   Reset = "yearly"  : only documents dated this year are counted, so the series restarts at 1 each January.
 *   Reset = "monthly" : same, restarting each month.
 *   Reset = "daily"   : same, restarting each day.
 *
 * Loaded after all other app scripts (see index.html).
 */
(function () {
  "use strict";
  if (window.__acxNumbering2) return;
  window.__acxNumbering2 = true;
  var W = window;

  /* where each document type's saved records live (used to find the highest number already issued) */
  var SOURCES = {
    manualJournals: ["manualJournals"],
    recurringJournals: ["recurringJournals"],
    payments: ["billPayments"],
    bills: ["bills"],
    bulkBills: ["bulkBills", "bills"],
    recurringBills: ["recurringBills", "bills"],
    taxPayments: ["taxPayments"],
    operationalCosts: ["operationalCosts"],
    purchaseOrders: ["purchaseOrders"],
    debitNotes: ["supplierDebitNotes", "debitNotes"],
    purchaseReturns: ["purchaseReturns"],
    grns: ["grns"],
    invoices: ["invoices"],
    quotes: ["quotes"],
    orders: ["orders"],
    bulkInvoices: ["bulkInvoices"],
    creditNotes: ["creditNotes"],
    salesReturns: ["salesReturns"],
    receipts: ["receipts"],
    recurringInvoices: ["recurringInvoices", "invoices"],
    deliveries: ["deliveries"]
  };

  function read(k) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function rows() {
    try { if (typeof W.__acxNumberingRows === "function") return W.__acxNumberingRows() || []; } catch (e) {}
    return [];
  }
  function rowFor(key, override) {
    if (override) return override;
    var all = rows();
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].key === key) return all[i];
    return null;
  }
  function matcher(row) {
    /* optional "AB-" style user code between prefix and digits is allowed (multi-user sessions add it) */
    return new RegExp("^" + esc(row.prefix || "") + "(?:[A-Za-z]+\\d*-)?(\\d+)" + esc(row.suffix || "") + "$");
  }
  function isPeriodic(row) { return row.reset === "yearly" || row.reset === "monthly" || row.reset === "daily"; }
  function inPeriod(rec, row) {
    if (!isPeriodic(row)) return true;
    var d = rec.date || rec.invoiceDate || rec.billDate || rec.createdAt;
    var dt = d ? new Date(d) : null;
    if (!dt || isNaN(dt.getTime())) return true;
    var now = new Date();
    if (dt.getFullYear() !== now.getFullYear()) return false;
    if (row.reset === "yearly") return true;
    if (dt.getMonth() !== now.getMonth()) return false;
    return row.reset === "monthly" || dt.getDate() === now.getDate();
  }
  function maxUsed(key, row, extra) {
    var re = matcher(row), max = 0;
    var lists = (SOURCES[key] || []).map(read);
    if (Array.isArray(extra)) lists.push(extra);
    lists.forEach(function (list) {
      list.forEach(function (rec) {
        if (!rec || typeof rec !== "object" || !inPeriod(rec, row)) return;
        Object.keys(rec).forEach(function (f) {
          var v = rec[f];
          if (typeof v !== "string") return;
          var m = re.exec(v);
          if (m) { var n = parseInt(m[1], 10); if (n < 1e9 && n > max) max = n; } /* >= 1e9 is a timestamp id, not a number */
        });
      });
    });
    return max;
  }
  function build(row, n) {
    return (row.prefix || "") + String(n).padStart(+row.pad || 0, "0") + (row.suffix || "");
  }
  function nextN(key, row, opts) {
    var used = maxUsed(key, row, opts && opts.extra);
    var n = used + 1;
    if (!isPeriodic(row)) n = Math.max(parseInt(row.next, 10) || 1, n);
    return n + ((opts && opts.offset) || 0);
  }

  /* next number for a document type, or null when Customization has no row for it */
  W.acxDocNo = function (key, opts) {
    var row = rowFor(key);
    return row ? build(row, nextN(key, row, opts)) : null;
  };
  /* same, for showing a preview in the Customization table (uses the row as currently typed) */
  W.acxPeekNumber = function (key, row) {
    try { var r = rowFor(key, row); return r ? build(r, nextN(key, r)) : null; } catch (e) { return null; }
  };
  /* true when a value already follows the configured prefix/suffix for this document type */
  W.acxDocMatches = function (key, value) {
    var row = rowFor(key);
    return !!(row && matcher(row).test(String(value || "")));
  };

  /* ---------- generators: replace the number logic underneath each existing generateXNumber() ---------- */
  function setIn(id, v) { var el = document.getElementById(id); if (el) el.value = v; }
  function hook(fn, key, opt) {
    var name = fn + "__acxOrig", orig = W[name];
    if (typeof orig !== "function") return false;
    W[name] = function () {
      var n = null;
      try { n = W.acxDocNo(key); } catch (e) { n = null; }
      if (n == null) return orig.apply(this, arguments);
      if (opt && opt.input) setIn(opt.input, n);
      return opt && opt.voidReturn ? undefined : n;
    };
    return true;
  }
  hook("generateInvoiceNumber", "invoices");
  hook("generateQuoteNumber", "quotes", { input: "quoteNumber" });
  hook("generateOrderNumber", "orders");
  hook("generateBulkInvoiceNumber", "bulkInvoices", { input: "bulkInvoiceNumber", voidReturn: true });
  hook("generateCreditNoteNumber", "creditNotes", { input: "creditNumber", voidReturn: true });
  hook("generateReceiptNumber", "receipts");
  hook("generateRecurringInvoiceNumber", "recurringInvoices");
  hook("generateBillNumber", "bills");
  hook("generateBulkBillNumber", "bulkBills");
  hook("generatePONumber", "purchaseOrders");
  hook("generatePurchaseReturnNumber", "purchaseReturns");
  hook("generateNextGRNNumber", "grns");
  hook("nextJournalNumber", "manualJournals");
  hook("nextRecurringJournalNumber", "recurringJournals");
  hook("generateNextTrackNumber", "deliveries", { input: "deliveryTrackNumber", voidReturn: true });

  /* invoices generated by a recurring template continue the recurring series */
  var prevRinv = W.__acxNextRinv;
  W.__acxNextRinv = function (invoices) {
    var n = null;
    try { n = W.acxDocNo("recurringInvoices", { extra: invoices }); } catch (e) {}
    return n != null ? n : (typeof prevRinv === "function" ? prevRinv.apply(this, arguments) : null);
  };
  var prevRbil = W.__acxNextRbil;
  W.__acxNextRbil = function (bills) {
    var n = null;
    try { n = W.acxDocNo("recurringBills", { extra: bills }); } catch (e) {}
    return n != null ? n : (typeof prevRbil === "function" ? prevRbil.apply(this, arguments) : null);
  };

  /* the old Preferences > Documents numbering now follows Customization too */
  var legacyKeys = { inv: "invoices", quote: "quotes", po: "purchaseOrders", rcpt: "receipts", cn: "creditNotes", dn: "debitNotes" };
  var prevNext = W.nextDocNumber;
  W.nextDocNumber = function (t) {
    var key = legacyKeys[t], n = null;
    if (key) { try { n = W.acxDocNo(key); } catch (e) {} }
    return n != null ? n : (typeof prevNext === "function" ? prevNext.apply(this, arguments) : null);
  };

  /* ---------- documents that had no visible number yet: stamp one on every new record ---------- */
  function stampNew(store, key, before) {
    var arr = read(store);
    if (arr.length <= before) return;
    var changed = false;
    for (var i = before; i < arr.length; i++) {
      var r = arr[i];
      if (r && typeof r === "object" && !r.number) {
        var n = W.acxDocNo(key, { extra: arr });
        if (n == null) return;
        r.number = n; changed = true;
      }
    }
    if (changed) { try { localStorage.setItem(store, JSON.stringify(arr)); } catch (e) {} }
  }
  function stamp(fn, store, key) {
    var f = W[fn];
    if (typeof f !== "function" || f.__acxStamped) return;
    var w = function () {
      var before = read(store).length;
      var res = f.apply(this, arguments);
      var done = function () { try { stampNew(store, key, before); } catch (e) {} };
      if (res && typeof res.then === "function") res.then(done, function () {}); else done();
      return res;
    };
    w.__acxStamped = true;
    W[fn] = w;
  }
  stamp("addSupplierPayment", "billPayments", "payments");
  stamp("addTaxPayment", "taxPayments", "taxPayments");
  stamp("addOperationalCost", "operationalCosts", "operationalCosts");
  stamp("saveDebitNote", "supplierDebitNotes", "debitNotes");
  stamp("saveSalesReturn", "salesReturns", "salesReturns");

  /* ---------- Preferences no longer has its own (conflicting) numbering boxes ---------- */
  function replacePrefsGrid() {
    var g = document.getElementById("docNumberingGrid");
    if (!g || g.getAttribute("data-acx-num")) return;
    g.setAttribute("data-acx-num", "1");
    g.innerHTML = '<div class="text-sm text-gray-700 p-2">Document numbers are now set in <b>Settings &rarr; Customization &rarr; Numbering</b>, for every document type. ' +
      '<button type="button" id="acxGoNumbering" class="text-blue-800 underline">Open Numbering</button></div>';
    var b = document.getElementById("acxGoNumbering");
    if (b) b.addEventListener("click", function () {
      try { if (typeof W.showTab === "function") W.showTab("settingstemplateTab"); } catch (e) {}
      setTimeout(function () {
        var n = document.querySelector('#advCustomization [data-cust="cNumber"], #advCustomization button[onclick*="cNumber"]');
        if (n && n.click) n.click();
      }, 50);
    });
  }
  function watchPrefsGrid() {
    replacePrefsGrid();
    var g = document.getElementById("docNumberingGrid");
    if (!g || !W.MutationObserver) return;
    new MutationObserver(function () {
      if (g.querySelector("[data-prefkey]")) { g.removeAttribute("data-acx-num"); replacePrefsGrid(); }
    }).observe(g, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchPrefsGrid); else watchPrefsGrid();

  /* refresh the Customization table once so it shows all document types */
  try { if (typeof W.__initAdvCustomization === "function") W.__initAdvCustomization(); } catch (e) {}
})();
