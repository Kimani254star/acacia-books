/* ============================================================================
   acacia-invoice-stock.js
   Invoice, Bulk Invoice and Recurring Invoice: the "Item Type" list is removed.
   Every line picked from inventory is treated as a Product, so
     - stock is deducted whenever the invoice is saved / generated, and
     - the existing checks refuse to sell more than the available stock
       (per line, per invoice, per customers x qty on bulk, and on save of a
       recurring invoice).
   Implementation: the three selects are hidden and always report "product",
   so every existing check and deduction (which key off the type) just works.
   Load AFTER app-2.js.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__acxInvoiceStockLoaded) return;
  window.__acxInvoiceStockLoaded = true;

  var IDS = ["invoiceItemType", "bulkItemType", "recurringInvoiceItemType"];
  var setSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

  function lock(id) {
    var el = document.getElementById(id);
    if (!el || el.__acxLocked) return !!el;
    el.__acxLocked = true;
    try { if (setSel && setSel.set) setSel.set.call(el, "product"); } catch (e) {}
    try {
      Object.defineProperty(el, "value", { configurable: true, get: function () { return "product"; }, set: function () {} });
    } catch (e) {}
    el.removeAttribute("required");
    el.style.display = "none";
    Array.prototype.forEach.call(document.querySelectorAll('label[for="' + id + '"]'), function (l) { l.style.display = "none"; });
    // hide the wrapper too when it only held this field
    var p = el.parentElement;
    if (p && !Array.prototype.some.call(p.children, function (c) {
      return c !== el && c.style.display !== "none" && !(c.tagName === "LABEL" && c.getAttribute("for") === id);
    })) p.style.display = "none";
    return true;
  }

  function run() { IDS.forEach(lock); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
  // forms can be built lazily / re-rendered
  var n = 0, iv = setInterval(function () { run(); if (++n > 30) clearInterval(iv); }, 1000);
  document.addEventListener("acx:data-changed", run);
})();
