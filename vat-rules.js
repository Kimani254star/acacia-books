/* VAT Rules manager.
   - Adds a "VAT Rules" card under Settings > Tax > Tax Rates (name, rate %, used for Buy / Sell / Both).
   - Every VAT rule dropdown is filled from that list: Item form (buyVatRule / sellVatRule) and the
     invoice / order line tax dropdowns (invoiceItemTax / orderItemTax).
   - Defaults Zero, 16%, Exempt, 8% are created once, so existing items keep working (item stores the rule name).
   - Does NOT change app.js / app-2.js. Load AFTER app-2.js (before or after item-pricing.js). */
(function () {
  'use strict';
  var KEY = 'vatRules';
  var DEFAULTS = [
    { name: 'Zero', percent: 0, appliesTo: 'both' },
    { name: '16%', percent: 16, appliesTo: 'both' },
    { name: 'Exempt', percent: 0, appliesTo: 'both' },
    { name: '8%', percent: 8, appliesTo: 'both' }
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  function load() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!Array.isArray(v) || !v.length) {
      v = DEFAULTS.map(function (d, i) { return { id: Date.now() + i, name: d.name, percent: d.percent, appliesTo: d.appliesTo }; });
      save(v);
    }
    return v;
  }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

  /* ---------- resolver used by other scripts ---------- */
  function rateOf(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return 0;
    var hit = load().filter(function (r) { return r.name.trim().toLowerCase() === s.toLowerCase(); })[0];
    if (hit) return Number(hit.percent) || 0;
    var m = s.match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : 0;
  }
  window.vatRuleRate = rateOf;
  window.getVatRules = load;

  /* ---------- dropdowns ---------- */
  function label(r) {
    var p = Number(r.percent) || 0;
    return (r.name === p + '%') ? r.name : r.name + ' (' + p + '%)';
  }
  function fillRuleSelect(sel, side) {
    if (!sel) return;
    var cur = sel.value, first = sel.options.length ? sel.options[0] : null;
    var ph = first && first.value === '' ? first.textContent : (side === 'buy' ? 'VAT Rule (Buy)' : 'VAT Rule (Sell)');
    var html = '<option value="">' + esc(ph) + '</option>', seen = {};
    load().forEach(function (r) {
      if (r.appliesTo !== 'both' && r.appliesTo !== side) return;
      seen[r.name] = 1;
      html += '<option value="' + esc(r.name) + '">' + esc(label(r)) + '</option>';
    });
    if (cur && !seen[cur]) html += '<option value="' + esc(cur) + '">' + esc(cur) + '</option>';   // old item whose rule was removed
    sel.innerHTML = html;
    sel.value = cur;
  }
  function fillInvoiceTax(sel) {
    if (!sel) return;
    load().forEach(function (r) {
      var p = Number(r.percent) || 0;
      if (p <= 0) return;
      var v = String(p);
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v) return;
      var o = document.createElement('option'); o.value = v; o.textContent = r.name + ' ' + p + '%';
      sel.appendChild(o);
    });
  }
  /* every line-item tax dropdown: Invoice, Bulk Invoice, Recurring, Quote, Order, Credit note, Bill, Bulk Bill, PO, Debit note */
  var TAX_SELECTS = ['invoiceItemTax', 'bulkInvoiceItemTax', 'recurringInvoiceItemTax', 'quoteItemTax', 'orderItemTax',
                     'creditItemTax', 'billItemTax', 'bulkBillItemTax', 'poItemTax', 'debitItemTax'];
  var BUY_SIDE = { billItemTax: 1, bulkBillItemTax: 1, poItemTax: 1, debitItemTax: 1 };

  function refresh() {
    fillRuleSelect($('buyVatRule'), 'buy');
    fillRuleSelect($('sellVatRule'), 'sell');
    TAX_SELECTS.forEach(function (id) { fillInvoiceTax($(id)); });
    ['buyVatRule', 'sellVatRule'].forEach(function (id) {   // let item-pricing recalc if it is loaded
      var s = $(id); if (s) try { s.dispatchEvent(new Event('change')); } catch (e) {}
    });
  }

  /* make invoices understand custom rates when an item is picked */
  function patchMap() {
    var orig = window.mapVatRuleToOption;
    if (typeof orig !== 'function' || orig.__vat) return;
    window.mapVatRuleToOption = function (rule) {
      var s = String(rule == null ? '' : rule).trim().toLowerCase();
      var hit = load().filter(function (r) { return r.name.trim().toLowerCase() === s; })[0];
      if (hit) {
        var p = Number(hit.percent) || 0;
        if (p === 0) return /exempt/i.test(hit.name) ? 'exempt' : '0';
        return String(p);
      }
      return orig.apply(this, arguments);
    };
    window.mapVatRuleToOption.__vat = true;
  }

  /* When an item is picked on any form, the built-in code only understands 16 / 8 / 0 / Exempt.
     For a custom rule, set the line tax dropdown ourselves (buy rule on Bill/PO/Debit, sell rule elsewhere). */
  function onPick(e) {
    var sel = e.target;
    if (!sel || sel.tagName !== 'SELECT' || /ItemTax$/.test(sel.id || '')) return;
    var o = sel.options[sel.selectedIndex]; if (!o || !o.value) return;
    setTimeout(function () {
      try {
        var box = sel.parentNode, tax = null;
        for (var up = 0; box && up < 6 && !tax; up++, box = box.parentNode) {
          for (var k = 0; k < TAX_SELECTS.length; k++) { var c = box.querySelector && box.querySelector('#' + TAX_SELECTS[k]); if (c) { tax = c; break; } }
        }
        if (!tax) return;
        var name = String(o.value).trim();
        if (name.charAt(0) === '{') { try { name = String(JSON.parse(name).name || '').trim(); } catch (x) {} }
        var inv = (typeof window.getAllInventories === 'function' ? window.getAllInventories() : []) || [];
        var item = inv.filter(function (it) { return it && (String(it.name).trim() === name || String(it.sku || '').trim() === name); })[0];
        if (!item) return;
        var rule = BUY_SIDE[tax.id] ? item.buyVat : item.sellVat;
        var hit = load().filter(function (r) { return r.name.trim().toLowerCase() === String(rule || '').trim().toLowerCase(); })[0];
        if (!hit) return;
        var p = Number(hit.percent) || 0;
        if (p === 0) return;                                     // 0 / Exempt are already handled by the app
        fillInvoiceTax(tax);
        for (var i = 0; i < tax.options.length; i++) if (tax.options[i].value === String(p)) { tax.value = String(p); break; }
        tax.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e2) {}
    }, 0);
  }
  document.addEventListener('change', onPick, true);

  /* ---------- Settings card ---------- */
  function renderTable() {
    var tb = document.querySelector('#vatRulesTable tbody'); if (!tb) return;
    tb.innerHTML = load().map(function (r, i) {
      return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td>' +
        '<td class="p-2 border"><input class="w-full border p-1 rounded vr-name" value="' + esc(r.name) + '"></td>' +
        '<td class="p-2 border"><input type="number" step="0.01" min="0" class="w-24 border p-1 rounded vr-pct" value="' + (Number(r.percent) || 0) + '"></td>' +
        '<td class="p-2 border"><select class="border p-1 rounded vr-for">' +
          ['both', 'buy', 'sell'].map(function (k) { return '<option value="' + k + '"' + (r.appliesTo === k ? ' selected' : '') + '>' + { both: 'Buy & Sell', buy: 'Buy only', sell: 'Sell only' }[k] + '</option>'; }).join('') +
        '</select></td>' +
        '<td class="p-2 border text-center whitespace-nowrap">' +
          '<button data-vr="save" data-i="' + i + '" class="text-blue-700 hover:underline text-sm mr-2">Save</button>' +
          '<button data-vr="del" data-i="' + i + '" class="text-blue-600 hover:underline text-sm">Delete</button></td></tr>';
    }).join('');
  }
  function toast(m) { try { if (typeof window.showToast === 'function') return window.showToast(m); } catch (e) {} try { alert(m); } catch (e) {} }

  function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-vr]'); if (!b) return;
    var act = b.getAttribute('data-vr'), rules = load(), i = parseInt(b.getAttribute('data-i'), 10);
    if (act === 'add') {
      var name = ($('vrName').value || '').trim(), pct = $('vrPercent').value;
      if (!name || pct === '') return toast('Enter a VAT rule name and rate');
      if (rules.some(function (r) { return r.name.toLowerCase() === name.toLowerCase(); })) return toast('A VAT rule with that name already exists');
      rules.push({ id: Date.now(), name: name, percent: parseFloat(pct) || 0, appliesTo: $('vrFor').value });
      $('vrName').value = ''; $('vrPercent').value = '';
    } else if (act === 'save') {
      var tr = b.closest('tr'), n = tr.querySelector('.vr-name').value.trim();
      if (!n) return toast('Name is required');
      if (rules.some(function (r, k) { return k !== i && r.name.toLowerCase() === n.toLowerCase(); })) return toast('A VAT rule with that name already exists');
      rules[i].name = n; rules[i].percent = parseFloat(tr.querySelector('.vr-pct').value) || 0; rules[i].appliesTo = tr.querySelector('.vr-for').value;
    } else if (act === 'del') {
      if (rules.length <= 1) return toast('Keep at least one VAT rule');
      if (!confirm('Delete this VAT rule? Items already using it keep their saved rule.')) return;
      rules.splice(i, 1);
    }
    save(rules); renderTable(); refresh();
  }

  function buildCard() {
    if ($('vatRulesCard')) return true;
    var pane = $('taxPane-rates'); if (!pane) return false;
    var c = document.createElement('div'); c.id = 'vatRulesCard'; c.className = 'bg-white p-4 rounded shadow mb-6';
    c.innerHTML =
      '<h3 class="text-sm font-semibold mb-1">VAT Rules</h3>' +
      '<p class="text-xs text-gray-500 mb-3">These rules appear in every VAT Rule dropdown (Inventory items, invoices, orders).</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-5 gap-3 mb-3">' +
        '<input id="vrName" type="text" placeholder="Rule name (e.g. Standard VAT)" class="border p-2 rounded sm:col-span-2">' +
        '<input id="vrPercent" type="number" step="0.01" min="0" placeholder="Rate %" class="border p-2 rounded">' +
        '<select id="vrFor" class="border p-2 rounded"><option value="both">Buy &amp; Sell</option><option value="buy">Buy only</option><option value="sell">Sell only</option></select>' +
        '<button data-vr="add" class="border border-blue-900 text-white bg-blue-900 font-bold px-2 py-1 rounded hover:bg-blue-800">Add VAT Rule</button>' +
      '</div>' +
      '<table class="min-w-full text-sm border" id="vatRulesTable"><thead class="bg-gray-100"><tr>' +
        '<th class="p-2 border">#</th><th class="p-2 border">Name</th><th class="p-2 border">Rate %</th><th class="p-2 border">Used for</th><th class="p-2 border">Actions</th>' +
      '</tr></thead><tbody></tbody></table>';
    pane.insertBefore(c, pane.firstChild);
    c.addEventListener('click', onClick);
    renderTable();
    return true;
  }

  function boot(n) {
    n = n || 0;
    var ok = buildCard();
    patchMap(); refresh();
    if ((!ok || typeof window.mapVatRuleToOption !== 'function') && n < 40) setTimeout(function () { boot(n + 1); }, 400);
  }
  /* these forms are opened later / re-rendered, so fill them whenever they are touched or added to the page */
  document.addEventListener('mousedown', function (e) { var t = e.target; if (t && /ItemTax$/.test(t.id || '')) fillInvoiceTax(t); }, true);
  document.addEventListener('focusin', function (e) { var t = e.target; if (t && /ItemTax$/.test(t.id || '')) fillInvoiceTax(t); }, true);
  try {
    var tmr = null;
    new MutationObserver(function () { if (tmr) return; tmr = setTimeout(function () { tmr = null; TAX_SELECTS.forEach(function (id) { fillInvoiceTax($(id)); }); }, 300); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  setTimeout(refresh, 1500); setTimeout(refresh, 5000);

  /* item edit / reset code sets select values itself, so re-apply options when the form is opened */
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && (t.id === 'buyVatRule' || t.id === 'sellVatRule')) { var v = t.value; fillRuleSelect(t, t.id === 'buyVatRule' ? 'buy' : 'sell'); t.value = v; }
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); }); else boot();
})();
