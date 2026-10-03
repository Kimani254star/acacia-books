/* VAT rules from Tax Engine -> every VAT dropdown.
   Rates you add under  Tax  >  Tax Rates  (stored in "taxRates") are added to all VAT / tax dropdowns:
     - Item forms (Buy / Sell VAT Rule, Bundle VAT, Price Tax Rate)  : value like "12.5%"
     - Document / cost lines (Invoice, Quote, Order, Credit, Bill, PO, Debit, Operational cost, Expenses) : value like "12.5"
   Built-in options (Zero, 8%, 16%, Exempt ...) are never changed. Withholding rates are skipped.
   A rate set to apply on "purchases" only shows in Buy dropdowns; "sales" only shows in Sell dropdowns; "both" shows everywhere.
   Does NOT change app*.js. Load AFTER app-2.js / app-3.js / item-pricing.js. */
(function () {
  'use strict';
  var KEY = 'taxRates';

  function rates() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function has(sel, v) {
    var t = String(v).toLowerCase();
    for (var i = 0; i < sel.options.length; i++) if (String(sel.options[i].value).toLowerCase() === t && !sel.options[i].dataset.acxVat) return true;
    return false;
  }
  function family(sel) {
    if (sel.multiple || sel.closest && sel.closest('#taxRatesTable')) return null;
    if (sel.id === 'priceTaxRate') return 'item';
    if (has(sel, '16') && has(sel, 'exempt')) return 'doc';
    if (has(sel, '16%') && has(sel, 'exempt')) return 'item';
    return null;
  }
  function side(sel) {
    if (sel.id === 'priceTaxRate') return 'both';
    return /(buy|bill|^po|debit|cost|^phExp)/i.test(sel.id || '') ? 'buy' : 'sell';
  }
  function wanted(sel, fam) {
    var sd = side(sel), out = [];
    rates().forEach(function (r) {
      if (!r || /withhold/i.test(r.type || '')) return;
      var p = parseFloat(r.percent); if (isNaN(p)) return;
      var on = String(r.applicableOn || 'both').toLowerCase();
      if (sd === 'buy' && on === 'sales') return;
      if (sd === 'sell' && on === 'purchases') return;
      var name = String(r.name || '').trim(), value, label;
      if (p === 0) {
        if (/exempt/i.test(name)) { value = fam === 'item' ? 'Exempt' : 'exempt'; }
        else { value = fam === 'item' ? 'Zero' : '0'; }
        label = name || value;
      } else {
        value = fam === 'item' ? (p + '%') : String(p);
        label = fam === 'item' ? (name ? name + ' (' + p + '%)' : p + '%') : (name ? name + ' ' + p + '%' : 'VAT ' + p + '%');
      }
      if (has(sel, value)) return;
      for (var i = 0; i < out.length; i++) if (out[i].value.toLowerCase() === value.toLowerCase()) return;
      out.push({ value: value, label: label });
    });
    return out;
  }
  function decorate(sel) {
    var fam = family(sel); if (!fam) return;
    var want = wanted(sel, fam), map = {};
    want.forEach(function (w) { map[w.value] = w; });
    var i, o;
    /* drop injected options that are no longer defined (keep the one that is currently selected) */
    for (i = sel.options.length - 1; i >= 0; i--) {
      o = sel.options[i];
      if (o.dataset.acxVat && !map[o.value] && sel.selectedIndex !== i) sel.remove(i);
    }
    var anchor = null;
    for (i = 0; i < sel.options.length; i++) if (sel.options[i].value === '__add_new__') anchor = sel.options[i];
    want.forEach(function (w) {
      var ex = null;
      for (var k = 0; k < sel.options.length; k++) if (sel.options[k].dataset.acxVat && sel.options[k].value === w.value) ex = sel.options[k];
      if (ex) { if (ex.textContent !== w.label) ex.textContent = w.label; return; }
      var op = document.createElement('option');
      op.value = w.value; op.textContent = w.label; op.dataset.acxVat = '1';
      sel.insertBefore(op, anchor);
    });
  }
  function scanAll() {
    Array.prototype.forEach.call(document.querySelectorAll('select'), function (s) { try { decorate(s); } catch (e) {} });
  }

  /* keep the new rates in sync with the Tax Rates tab */
  function note() {
    var t = document.getElementById('taxRatesTable');
    if (!t || document.getElementById('acxVatRulesNote')) return;
    var host = t.parentNode, n = document.createElement('div');
    n.id = 'acxVatRulesNote';
    n.style.cssText = 'font-size:12px;color:#475569;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;margin:6px 0';
    n.textContent = 'Rates added here appear automatically in every VAT Rule / Tax Rate dropdown (items, invoices, bills, quotes, orders, costs, expenses). Set "Applicable on" to choose Sales, Purchases or Both.';
    host.insertBefore(n, t);
  }

  var timer = null, pending = [];
  function queue(s) { if (pending.indexOf(s) < 0) pending.push(s); if (!timer) timer = setTimeout(function () { var l = pending; pending = []; timer = null; l.forEach(function (x) { try { decorate(x); } catch (e) {} }); note(); }, 100); }

  function boot() {
    /* items whose saved VAT rule is a custom rate (e.g. "12.5%") must not be treated as exempt */
    var orig = window.mapVatRuleToOption;
    if (typeof orig === 'function' && !orig.__vatRules) {
      window.mapVatRuleToOption = function (rule) {
        var m = String(rule == null ? '' : rule).trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
        return m ? String(parseFloat(m[1])) : orig.apply(this, arguments);
      };
      window.mapVatRuleToOption.__vatRules = true;
    }
    try {
      new MutationObserver(function (ms) {
        ms.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes || [], function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'SELECT') queue(n);
            else if (n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll('select'), queue);
          });
          var t = m.target, s = t && t.nodeType === 1 ? (t.tagName === 'SELECT' ? t : (t.closest && t.closest('select'))) : null;
          if (s && !(m.addedNodes.length && m.addedNodes[0].dataset && m.addedNodes[0].dataset.acxVat)) queue(s);
        });
        note();
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    /* refresh a dropdown right when it is opened, so a rate added a second ago is already there */
    ['mousedown', 'focusin'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { var s = e.target; if (s && s.tagName === 'SELECT') { try { decorate(s); } catch (x) {} } }, true);
    });
    scanAll(); note(); setTimeout(scanAll, 1500); setTimeout(scanAll, 5000);
  }
  window.acxRefreshVatRules = scanAll;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
