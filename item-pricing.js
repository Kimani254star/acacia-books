/* Item pricing calculator for the Inventory "Add / Edit Item" form.
   Buying price + profit margin + sales tax + pricing method  ->  selling price (before tax), tax, final price.

   - Does NOT change app-2.js. Load it AFTER app-2.js (same way as coa-ledger.js).
   - itemSellPrice keeps meaning "selling price BEFORE tax" (invoices add the tax on top),
     so existing invoices / reports keep working.
   - Extra fields are saved on the item: profitMargin, pricingMethod, sellTaxRate, finalPrice.

   Formulas (margin is on the selling price before tax, i.e. gross margin):
     Selling price (before tax) = Cost / (1 - Margin)
     Tax                        = Selling price x Tax rate
     Final price                = Selling price + Tax
   Tax-inclusive:  Final price is the anchor, tax is extracted:
     Selling price = Final / (1 + rate),   Tax = Final - Selling price                     */
(function () {
  'use strict';

  var MARGIN_KEY = 'itemDefaultMargin';

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* "16%" -> 16 ; "Zero" / "Exempt" / "" -> 0 */
  function rateOf(rule) {
    var m = String(rule || '').match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : 0;
  }

  /* ---------- pure calculation (no DOM) ---------- */
  function calc(opts) {
    var cost = Math.max(0, num(opts.cost));
    var t = Math.max(0, num(opts.rate)) / 100;
    var method = opts.method === 'inclusive' ? 'inclusive' : 'exclusive';
    var net, tax, fin, margin;

    if (opts.source === 'net') {                       // user typed the selling price (before tax)
      net = r2(num(opts.net));
      tax = r2(net * t); fin = r2(net + tax);
    } else if (opts.source === 'final') {              // user typed the final price (tax included)
      fin = r2(num(opts.final));
      net = r2(fin / (1 + t)); tax = r2(fin - net);
    } else {                                           // margin (or cost / tax change) drives the price
      var m = Math.min(Math.max(num(opts.margin), 0), 99.99) / 100;
      var rawNet = cost / (1 - m);
      if (method === 'inclusive') {
        fin = r2(rawNet * (1 + t));
        net = r2(fin / (1 + t)); tax = r2(fin - net);
      } else {
        net = r2(rawNet); tax = r2(net * t); fin = r2(net + tax);
      }
    }
    margin = net > 0 ? ((net - cost) / net) * 100 : 0;
    return { cost: cost, net: net, tax: tax, final: fin, margin: margin, rate: t * 100 };
  }

  /* ---------- UI ---------- */
  var busy = false;

  function css() {
    if ($('itemPricingCss')) return;
    var s = document.createElement('style'); s.id = 'itemPricingCss';
    s.textContent =
      '#itemPricingPanel{border:1px solid #c7d2fe;background:#f5f7ff;border-radius:8px;padding:14px 16px;margin:12px 0;max-width:716px}' +
      '#itemPricingPanel h4{font-weight:600;margin:0 0 10px;color:#1e3a8a}' +
      '#itemPricingPanel .ip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}' +
      '#itemPricingPanel label{display:block;font-size:12px;color:#475569;margin-bottom:3px}' +
      '#itemPricingPanel input[type=number],#itemPricingPanel select{border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;width:100%;background:#fff}' +
      '#itemPricingPanel .ip-res{margin-top:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px}' +
      '#itemPricingPanel .ip-row{display:flex;justify-content:space-between;padding:6px 10px;font-size:13px;border-bottom:1px solid #f1f5f9}' +
      '#itemPricingPanel .ip-row:last-child{border-bottom:0}' +
      '#itemPricingPanel .ip-final{font-weight:700;font-size:15px;background:#eef2ff;color:#1e3a8a}' +
      '#itemPricingPanel .ip-note{font-size:11px;color:#64748b;margin-top:8px}' +
      '#itemPricingPanel .ip-auto{display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;margin-top:8px}';
    document.head.appendChild(s);
  }

  function build() {
    if ($('itemPricingPanel')) return true;
    var buy = $('itemBuyPrice'), sell = $('itemSellPrice');
    if (!buy || !sell) return false;
    css();

    var host = buy.closest('.grid') || buy.parentNode;     // the two-column grid that holds buy/sell fields
    var p = document.createElement('div'); p.id = 'itemPricingPanel';
    var saved = localStorage.getItem(MARGIN_KEY);
    p.innerHTML =
      '<h4>Recommended selling price</h4>' +
      '<div class="ip-grid">' +
        '<div><label for="itemMarginPct">Profit margin (%)</label><input id="itemMarginPct" type="number" step="0.01" min="0" max="99.99" value="' + esc(saved != null ? saved : '30') + '"></div>' +
        '<div><label for="itemPricingMethod">Pricing method</label><select id="itemPricingMethod">' +
          '<option value="exclusive">Tax exclusive — add tax to selling price</option>' +
          '<option value="inclusive">Tax inclusive — selling price already includes tax</option></select></div>' +
        '<div><label for="itemFinalPrice">Final price (customer pays)</label><input id="itemFinalPrice" type="number" step="0.01" placeholder="0.00"></div>' +
      '</div>' +
      '<div class="ip-auto"><input type="checkbox" id="itemPricingAuto" checked><label for="itemPricingAuto" style="margin:0">Auto-update selling price when buying price, margin or sell tax changes</label></div>' +
      '<div class="ip-res">' +
        '<div class="ip-row"><span>Buying price</span><span id="ipCost">0.00</span></div>' +
        '<div class="ip-row"><span>Selling price before tax</span><span id="ipNet">0.00</span></div>' +
        '<div class="ip-row"><span id="ipTaxLbl">Tax (0%)</span><span id="ipTax">0.00</span></div>' +
        '<div class="ip-row ip-final"><span>Final selling price</span><span id="ipFinal">0.00</span></div>' +
        '<div class="ip-row"><span>Gross profit per unit</span><span id="ipProfit">0.00</span></div>' +
      '</div>' +
      '<div class="ip-note">Margin is calculated on the selling price before tax. You can also type the Selling Price or the Final price yourself and the margin updates.</div>';
    host.insertAdjacentElement('afterend', p);

    sell.placeholder = 'Selling Price (before tax)';

    function ctx() {
      return { cost: $('itemBuyPrice').value, rate: rateOf(($('sellVatRule') || {}).value), method: $('itemPricingMethod').value, margin: $('itemMarginPct').value };
    }
    function show(r) {
      busy = true;
      $('ipCost').textContent = fmt(r.cost);
      $('ipNet').textContent = fmt(r.net);
      $('ipTaxLbl').textContent = 'Tax (' + r.rate + '%)';
      $('ipTax').textContent = fmt(r.tax);
      $('ipFinal').textContent = fmt(r.final);
      $('ipProfit').textContent = fmt(r.net - r.cost);
      busy = false;
    }
    function run(source) {
      if (busy) return;
      var auto = $('itemPricingAuto').checked, mode = source;
      if (!auto && (source === 'cost' || source === 'margin' || source === 'method' || source === 'tax')) {
        if (source === 'margin') { try { localStorage.setItem(MARGIN_KEY, $('itemMarginPct').value); } catch (e) {} return; }
        mode = 'net';                         // price is locked: keep typed price, refresh margin/tax/final
      }
      var o = ctx();
      o.source = (mode === 'net' || mode === 'final') ? mode : 'margin';
      o.net = $('itemSellPrice').value; o.final = $('itemFinalPrice').value;
      var r = calc(o);
      busy = true;
      if (mode !== 'net') $('itemSellPrice').value = r.net ? r.net.toFixed(2) : '';
      if (mode !== 'final') $('itemFinalPrice').value = r.final ? r.final.toFixed(2) : '';
      if ((mode === 'net' || mode === 'final') && r.net > 0) $('itemMarginPct').value = r2(r.margin);
      busy = false;
      show(r);
      if (source === 'margin') { try { localStorage.setItem(MARGIN_KEY, $('itemMarginPct').value); } catch (e) {} }
    }
    window.__itemPricingRun = run;

    $('itemBuyPrice').addEventListener('input', function () { run('cost'); });
    $('itemMarginPct').addEventListener('input', function () { run('margin'); });
    $('itemPricingMethod').addEventListener('change', function () { run('method'); });
    $('itemSellPrice').addEventListener('input', function () { run('net'); });
    $('itemFinalPrice').addEventListener('input', function () { run('final'); });
    if ($('sellVatRule')) $('sellVatRule').addEventListener('change', function () { run('tax'); });
    return true;
  }

  /* ---------- hooks into the existing item functions ---------- */
  function hookAll() {
    var origSave = window.saveItem;
    if (typeof origSave === 'function' && !origSave.__pricing) {
      window.saveItem = function () {
        var wh = ($('warehouseSelect') || {}).value;
        var snap = {
          name: ($('itemName') || {}).value ? $('itemName').value.trim() : '',
          sku: ($('itemSKU') || {}).value ? $('itemSKU').value.trim() : '',
          cost: parseFloat(($('itemBuyPrice') || {}).value),
          net: parseFloat(($('itemSellPrice') || {}).value),
          margin: num(($('itemMarginPct') || {}).value),
          method: ($('itemPricingMethod') || {}).value || 'exclusive',
          rate: rateOf(($('sellVatRule') || {}).value),
          final: num(($('itemFinalPrice') || {}).value)
        };
        var out = origSave.apply(this, arguments);
        try {
          if (wh && typeof getInventory === 'function' && typeof saveInventory === 'function') {
            var items = getInventory(wh), idx = -1;
            for (var i = items.length - 1; i >= 0; i--) {
              var it = items[i];
              if (it && it.name === snap.name && String(it.sku || '') === snap.sku &&
                  parseFloat(it.sellPrice) === snap.net && parseFloat(it.buyPrice) === snap.cost) { idx = i; break; }
            }
            if (idx > -1) {
              items[idx].profitMargin = r2(snap.margin);
              items[idx].pricingMethod = snap.method;
              items[idx].sellTaxRate = snap.rate;
              items[idx].finalPrice = snap.final;
              saveInventory(wh, items);
            }
          }
        } catch (e) { console.warn('item-pricing: could not store margin fields', e); }
        return out;
      };
      window.saveItem.__pricing = true;
    }

    var origEdit = window.editItem;
    if (typeof origEdit === 'function' && !origEdit.__pricing) {
      window.editItem = function (idx) {
        var out = origEdit.apply(this, arguments);
        setTimeout(function () {
          try {
            var wh = $('warehouseSelect').value, it = getInventory(wh)[idx];
            if (!it || !$('itemPricingPanel')) return;
            $('itemPricingMethod').value = it.pricingMethod || 'exclusive';
            if (it.profitMargin != null) $('itemMarginPct').value = it.profitMargin;
            window.__itemPricingRun('net');          // show margin / tax / final from the saved price, price unchanged
          } catch (e) {}
        }, 0);
        return out;
      };
      window.editItem.__pricing = true;
    }

    ['resetInventoryItemForm', 'cancelItem'].forEach(function (fn) {
      var o = window[fn];
      if (typeof o === 'function' && !o.__pricing) {
        window[fn] = function () {
          var r = o.apply(this, arguments);
          try {
            if ($('itemFinalPrice')) {
              $('itemFinalPrice').value = '';
              $('itemPricingMethod').value = 'exclusive';
              var s = localStorage.getItem(MARGIN_KEY); if (s != null) $('itemMarginPct').value = s;
              window.__itemPricingRun('net');
            }
          } catch (e) {}
          return r;
        };
        window[fn].__pricing = true;
      }
    });
  }

  function boot(n) {
    n = n || 0;
    if (build() && typeof window.saveItem === 'function') { hookAll(); return; }
    if (n < 40) setTimeout(function () { boot(n + 1); }, 300);
  }

  window.itemPricingCalc = calc;      // handy for testing in the console
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); }); else boot();
})();
