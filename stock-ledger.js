/* Acacia Books - Inventory Hub > Stock History
 * One list of every stock movement (sold in Books, sold in POS, bills, returns, adjustments, transfers) and a stock count check.
 * Built from what Books already keeps: invoices (Books + POS), item history (bills / returns / write-offs), adjustments, transfers.
 * Nothing here changes stock. Saved counts are kept in the "stockCounts" list. */
(function (w) {
  'use strict';
  var TAB = 'stockLedgerTab';
  var ls = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var q2 = function (n) { n = Math.round(num(n) * 100) / 100; return n === 0 ? '0' : String(n); };
  var $ = function (id) { return document.getElementById(id); };
  var isStock = function (l) { return typeof w.__acxLineStock === 'function' ? w.__acxLineStock(l) : (!l.type || low(l.type) === 'product'); };

  /* ---------- data ---------- */
  function inventories() {                         /* {warehouse: [items]} the same keys Books deducts from */
    var out = {};
    Object.keys(localStorage).forEach(function (k) {
      var base = k.replace(/^.*::/, '');
      if (base !== 'inventory' && base.indexOf('inventory_') !== 0) return;
      var a = ls(k, []); if (!Array.isArray(a)) return;
      var name = base === 'inventory' ? 'Main' : base.slice(10);
      if (!out[name] || !out[name].length) out[name] = a;
    });
    return out;
  }
  function dateOf(v) { var d = new Date(v); return isNaN(d) ? null : d; }
  function ymd(d) { var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  function build() {
    var inv = inventories(), rows = [];
    var where = function (sku, name) {              /* same lookup order Books uses when it deducts */
      for (var wh in inv) { var hit = (inv[wh] || []).filter(function (x) { return x && (sku && x.sku ? low(x.sku) === low(sku) : low(x.name) === low(name)); })[0]; if (hit) return { wh: wh, it: hit }; }
      return null;
    };
    var add = function (r) { var d = dateOf(r.ts || r.date); if (!d) return; r.ts = d.getTime(); r.date = ymd(d); rows.push(r); };

    /* 1) sales: Books invoices and POS sales */
    (ls('invoices', []) || []).forEach(function (i) {
      if (!i || i.pendingApproval) return;
      var pos = i.source === 'POS', pend = pos && !i.stockDone && !i.acx;
      (i.items || []).forEach(function (l) {
        if (!l || !isStock(l) || l.stk === false) return;
        var q = num(l.qty); if (!q) return;
        var f = where(l.sku, l.desc || l.name), wh = l.warehouse || (f && f.wh) || '';
        add({ ts: pos && i.pos && i.pos.at ? i.pos.at : i.date, item: l.desc || l.name || '', sku: l.sku || (f && f.it.sku) || '', wh: wh,
          src: pos ? 'POS sale' : 'Books sale', chan: pos ? 'POS' : 'Books', type: 'Sale', doc: i.invoiceNumber || '', ref: pos ? (i.posRef || '') : '',
          party: i.customer || '', qin: 0, qout: q, by: pos ? ((i.pos && i.pos.cashier) || '') + (i.pos && i.pos.till ? ' · ' + i.pos.till : '') : (i.createdBy || i.user || ''), pending: pend });
      });
    });
    (ls('bulkInvoices', []) || []).forEach(function (b) {
      (b.items || []).forEach(function (l) {
        if (!l || !isStock(l)) return; var q = num(l.qty); if (!q) return;
        var nm = l.itemName || l.desc || l.name || '', f = where(l.sku, nm);
        add({ ts: b.date, item: nm, sku: l.sku || (f && f.it.sku) || '', wh: l.warehouse || (f && f.wh) || '', src: 'Books sale', chan: 'Books', type: 'Sale (bulk)',
          doc: b.invoiceNo || '', ref: '', party: (b.customers || []).join(', '), qin: 0, qout: q, by: '', pending: false });
      });
    });

    /* 2) what Books already logs on each item: bills, returns, write-offs */
    var HT = { 'bill': ['Purchase', 'Bill'], 'bill deleted': ['Purchase', 'Bill deleted'], 'sales return': ['Sales return', 'Sales return'],
      'purchase return': ['Purchase return', 'Purchase return'], 'purchase return reversed': ['Purchase return', 'Purchase return reversed'], 'stock adjustment': ['Adjustment', 'Write-off'] };
    Object.keys(inv).forEach(function (wh) {
      (inv[wh] || []).forEach(function (it) {
        (it && Array.isArray(it.history) ? it.history : []).forEach(function (h) {
          var m = HT[low(h && h.type)]; if (!m) return; var q = num(h.qty);
          add({ ts: h.isoDate || h.date, item: it.name || '', sku: it.sku || '', wh: wh, src: m[0], chan: 'Books', type: m[1], doc: h.ref || h.refInvoice || '', ref: '',
            party: h.refSupplier || '', qin: q > 0 ? q : 0, qout: q < 0 ? -q : 0, by: h.user || '', pending: false });
        });
      });
    });

    /* 3) manual adjustments and warehouse transfers */
    (ls('amendments', []) || []).concat((ls('baLog', []) || []).map(function (e) { return { date: e.date, warehouse: e.warehouse, item: e.product, sku: e.sku, quantity: e.change, user: e.user, reason: 'Bulk adjustment' }; })).forEach(function (a) {
      if (!a) return; var q = num(a.quantity), t = low(a.adjustmentType);
      if (t === 'decrease') q = -Math.abs(q); else if (t === 'increase') q = Math.abs(q);
      if (!q) return;
      add({ ts: a.date, item: a.item || '', sku: a.sku || '', wh: a.warehouse || '', src: 'Adjustment', chan: 'Books', type: a.reason || 'Adjustment', doc: '', ref: '', party: '',
        qin: q > 0 ? q : 0, qout: q < 0 ? -q : 0, by: a.user || '', pending: false });
    });
    (ls('movements', []) || []).forEach(function (m) {
      if (!m) return; var q = num(m.quantity); if (!q) return;
      var f = where('', m.item);
      add({ ts: m.date, item: m.item || '', sku: (f && f.it.sku) || '', wh: m.from || '', src: 'Transfer', chan: 'Books', type: 'Transfer out', doc: '', ref: '', party: '→ ' + (m.to || ''), qin: 0, qout: q, by: '', pending: false });
      add({ ts: m.date, item: m.item || '', sku: (f && f.it.sku) || '', wh: m.to || '', src: 'Transfer', chan: 'Books', type: 'Transfer in', doc: '', ref: '', party: '← ' + (m.from || ''), qin: q, qout: 0, by: '', pending: false });
    });
    rows.sort(function (a, b) { return b.ts - a.ts; });
    return { rows: rows, inv: inv };
  }

  /* ---------- UI ---------- */
  var cache = null, view = 'ledger', lastCount = null;
  var SRC = ['Books sale', 'POS sale', 'Purchase', 'Sales return', 'Purchase return', 'Adjustment', 'Transfer'];
  function html() {
    return '<h2 class="text-sm font-bold mb-3">Stock History</h2>' +
      '<div class="flex gap-2 mb-3"><button id="slV1" class="px-3 py-1 rounded border">Movement ledger</button><button id="slV2" class="px-3 py-1 rounded border">Stock count check</button></div>' +
      '<div id="slFilters" class="flex flex-wrap gap-2 items-end mb-3"></div><div id="slBody" class="overflow-x-auto"></div><div id="slSaved" class="mt-4"></div>';
  }
  function whOptions(sel) { return '<option value="">All warehouses</option>' + Object.keys(cache.inv).sort().map(function (k) { return '<option' + (k === sel ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join(''); }
  function field(label, inner) { return '<label class="text-xs text-gray-600 flex flex-col">' + label + inner + '</label>'; }
  var IN = 'border rounded px-2 py-1 text-sm';

  function render() {
    var host = $(TAB); if (!host) return; if (!host.firstChild || !$('slBody')) host.innerHTML = html();
    cache = build();
    $('slV1').style.background = view === 'ledger' ? '#1e3a8a' : ''; $('slV1').style.color = view === 'ledger' ? '#fff' : '';
    $('slV2').style.background = view === 'count' ? '#1e3a8a' : ''; $('slV2').style.color = view === 'count' ? '#fff' : '';
    $('slV1').onclick = function () { view = 'ledger'; render(); }; $('slV2').onclick = function () { view = 'count'; render(); };
    view === 'ledger' ? ledger() : count();
  }
  function keepVal(id, d) { var e = $(id); return e ? e.value : d; }

  function ledger() {
    var keep = { from: keepVal('slFrom', ''), to: keepVal('slTo', ''), wh: keepVal('slWh', ''), src: keepVal('slSrc', ''), q: keepVal('slQ', '') };
    $('slSaved').innerHTML = '';
    $('slFilters').innerHTML =
      field('From', '<input id="slFrom" type="date" class="' + IN + '" value="' + esc(keep.from) + '">') + field('To', '<input id="slTo" type="date" class="' + IN + '" value="' + esc(keep.to) + '">') +
      field('Warehouse', '<select id="slWh" class="' + IN + '">' + whOptions(keep.wh) + '</select>') +
      field('Source', '<select id="slSrc" class="' + IN + '"><option value="">All sources</option><option value="Books sale"' + (keep.src === 'Books sale' ? ' selected' : '') + '>Sold in Books</option><option value="POS sale"' + (keep.src === 'POS sale' ? ' selected' : '') + '>Sold in POS</option>' +
        SRC.slice(2).map(function (s) { return '<option' + (s === keep.src ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>') +
      field('Item / document', '<input id="slQ" class="' + IN + '" placeholder="item, SKU, INV no." value="' + esc(keep.q) + '">') +
      '<button id="slCsv" class="px-3 py-1 rounded bg-blue-900 text-white text-sm">Export CSV</button>';
    ['slFrom', 'slTo', 'slWh', 'slSrc'].forEach(function (id) { $(id).onchange = paintLedger; }); $('slQ').oninput = paintLedger; $('slCsv').onclick = function () { csv(paintLedger(true)); };
    paintLedger();
  }
  function filtered() {
    var f = $('slFrom').value, t = $('slTo').value, wh = $('slWh').value, s = $('slSrc').value, q = low($('slQ').value);
    return cache.rows.filter(function (r) {
      return (!f || r.date >= f) && (!t || r.date <= t) && (!wh || r.wh === wh) && (!s || r.src === s) &&
        (!q || low(r.item + ' ' + r.sku + ' ' + r.doc + ' ' + r.ref + ' ' + r.party).indexOf(q) > -1);
    });
  }
  function paintLedger(ret) {
    var list = filtered(), tin = 0, tout = 0, tb = 0, tp = 0;
    list.forEach(function (r) { if (r.pending) return; tin += r.qin; tout += r.qout; if (r.src === 'Books sale') tb += r.qout; if (r.src === 'POS sale') tp += r.qout; });
    if (ret === true) return list;
    $('slBody').innerHTML = '<p class="text-sm mb-2"><b>' + list.length + '</b> movement(s) · In <b>' + q2(tin) + '</b> · Out <b>' + q2(tout) + '</b> · Sold in Books <b>' + q2(tb) + '</b> · Sold in POS <b>' + q2(tp) + '</b></p>' +
      '<table class="min-w-full text-sm border"><thead><tr class="bg-gray-100">' + ['Date', 'Item', 'SKU', 'Warehouse', 'Source', 'Type', 'Document', 'Party', 'In', 'Out', 'By'].map(function (h, i) { return '<th class="border px-2 py-1 text-' + (i === 8 || i === 9 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (list.slice(0, 1500).map(function (r) {
        var badge = r.chan === 'POS' ? '<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:0 6px">POS</span>' : r.src === 'Books sale' ? '<span style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:0 6px">Books</span>' : esc(r.src);
        return '<tr' + (r.pending ? ' style="opacity:.6"' : '') + '><td class="border px-2 py-1 whitespace-nowrap">' + esc(r.date) + '</td><td class="border px-2 py-1">' + esc(r.item) + '</td><td class="border px-2 py-1">' + esc(r.sku) + '</td><td class="border px-2 py-1">' + esc(r.wh || '—') + '</td><td class="border px-2 py-1">' + badge + '</td><td class="border px-2 py-1">' + esc(r.type) + (r.pending ? ' <i>(not yet deducted)</i>' : '') + '</td><td class="border px-2 py-1">' + esc(r.doc) + (r.ref ? '<br><small class="text-gray-500">till ref ' + esc(r.ref) + '</small>' : '') + '</td><td class="border px-2 py-1">' + esc(r.party) + '</td><td class="border px-2 py-1 text-right">' + (r.qin ? q2(r.qin) : '') + '</td><td class="border px-2 py-1 text-right">' + (r.qout ? q2(r.qout) : '') + '</td><td class="border px-2 py-1">' + esc(r.by) + '</td></tr>';
      }).join('') || '<tr><td colspan="11" class="text-center p-4 text-gray-500">No movements found for these filters.</td></tr>') + '</tbody></table>' + (list.length > 1500 ? '<p class="text-xs text-gray-500">Showing the latest 1500. Narrow the dates or export CSV for everything.</p>' : '');
  }

  /* ---- stock count check ---- */
  function count(preset) {
    var today = ymd(new Date()), first = today.slice(0, 8) + '01';
    var keep = preset || { from: keepVal('scFrom', first), to: keepVal('scTo', today), wh: keepVal('scWh', Object.keys(cache.inv).sort()[0] || '') };
    $('slFilters').innerHTML = field('Count from', '<input id="scFrom" type="date" class="' + IN + '" value="' + keep.from + '">') + field('Counted as at', '<input id="scTo" type="date" class="' + IN + '" value="' + keep.to + '">') +
      field('Warehouse', '<select id="scWh" class="' + IN + '">' + Object.keys(cache.inv).sort().map(function (k) { return '<option' + (k === keep.wh ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>') +
      '<button id="scSave" class="px-3 py-1 rounded bg-green-700 text-white text-sm">Save count</button><button id="scPrint" class="px-3 py-1 rounded border text-sm">Print count sheet</button><button id="scCsv" class="px-3 py-1 rounded bg-blue-900 text-white text-sm">Export CSV</button>';
    ['scFrom', 'scTo', 'scWh'].forEach(function (id) { $(id).onchange = function () { count(); }; });
    var from = $('scFrom').value, to = $('scTo').value, wh = $('scWh').value, items = (cache.inv[wh] || []).filter(function (x) { return x && x.name && x.active !== false; });
    var mv = cache.rows.filter(function (r) { return r.wh === wh && !r.pending; });
    var oldCounts = (preset && preset.counted) || {};
    var lines = items.map(function (it) {
      var mine = mv.filter(function (r) { return it.sku && r.sku ? low(r.sku) === low(it.sku) : low(r.item) === low(it.name); });
      var now = num(it.qty), after = 0, p = { books: 0, pos: 0, recv: 0, ret: 0, adj: 0, trf: 0 };
      mine.forEach(function (r) {
        if (r.date > to) after += r.qin - r.qout;
        if (r.date >= from && r.date <= to) {
          if (r.src === 'Books sale') p.books += r.qout; else if (r.src === 'POS sale') p.pos += r.qout; else if (r.src === 'Purchase') p.recv += r.qin - r.qout;
          else if (r.src === 'Sales return' || r.src === 'Purchase return') p.ret += r.qin - r.qout; else if (r.src === 'Adjustment') p.adj += r.qin - r.qout; else if (r.src === 'Transfer') p.trf += r.qin - r.qout;
        }
      });
      var exp = Math.round((now - after) * 100) / 100, k = (it.sku || it.name);
      return { name: it.name, sku: it.sku || '', now: now, exp: exp, p: p, key: k, counted: oldCounts[k] };
    });
    $('slBody').innerHTML = '<p class="text-xs text-gray-600 mb-2">Expected = stock in the system now, less anything that moved after the "counted as at" date. Type the quantity you counted; the difference shows at once.</p>' +
      '<table class="min-w-full text-sm border"><thead><tr class="bg-gray-100">' + ['Item', 'SKU', 'System now', 'Sold in Books', 'Sold in POS', 'Bills in', 'Returns', 'Adjust.', 'Transfers', 'Expected', 'Counted', 'Difference'].map(function (h, i) { return '<th class="border px-2 py-1 text-' + (i > 1 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (lines.map(function (l, i) {
        return '<tr data-i="' + i + '"><td class="border px-2 py-1">' + esc(l.name) + '</td><td class="border px-2 py-1">' + esc(l.sku) + '</td><td class="border px-2 py-1 text-right">' + q2(l.now) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.books) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.pos) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.recv) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.ret) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.adj) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.trf) + '</td><td class="border px-2 py-1 text-right"><b>' + q2(l.exp) + '</b></td><td class="border px-2 py-1 text-right"><input type="number" step="any" class="scIn border rounded px-1 py-0.5 w-24 text-right" value="' + (l.counted == null ? '' : l.counted) + '"></td><td class="border px-2 py-1 text-right scDiff"></td></tr>';
      }).join('') || '<tr><td colspan="12" class="text-center p-4 text-gray-500">No items in this warehouse.</td></tr>') + '</tbody></table>';
    var paintDiff = function (tr) { var inp = tr.querySelector('.scIn'), d = tr.querySelector('.scDiff'), l = lines[+tr.dataset.i]; if (inp.value === '') { d.textContent = ''; return; } var v = Math.round((num(inp.value) - l.exp) * 100) / 100; d.textContent = (v > 0 ? '+' : '') + q2(v); d.style.color = v === 0 ? '#15803d' : '#b91c1c'; d.style.fontWeight = '700'; };
    document.querySelectorAll('#slBody tbody tr[data-i]').forEach(function (tr) { tr.querySelector('.scIn').oninput = function () { paintDiff(tr); }; paintDiff(tr); });
    var collect = function () { var o = {}; document.querySelectorAll('#slBody tbody tr[data-i]').forEach(function (tr) { var v = tr.querySelector('.scIn').value; if (v !== '') o[lines[+tr.dataset.i].key] = num(v); }); return o; };
    $('scSave').onclick = function () {
      var c = collect(); if (!Object.keys(c).length) return alert('Type at least one counted quantity first.');
      var u = ls('loggedInUser', null) || {}, all = ls('stockCounts', []); if (!Array.isArray(all)) all = [];
      all.unshift({ id: Date.now(), savedAt: new Date().toISOString(), by: u.name || '', warehouse: wh, from: from, to: to, counted: c,
        lines: lines.filter(function (l) { return c[l.key] != null; }).map(function (l) { return { name: l.name, sku: l.sku, expected: l.exp, counted: c[l.key], difference: Math.round((c[l.key] - l.exp) * 100) / 100 }; }) });
      localStorage.setItem('stockCounts', JSON.stringify(all.slice(0, 100))); saved(); alert('Stock count saved.');
    };
    $('scCsv').onclick = function () { var c = collect(); csvRaw([['Item', 'SKU', 'System now', 'Sold in Books', 'Sold in POS', 'Bills in', 'Returns', 'Adjustments', 'Transfers', 'Expected', 'Counted', 'Difference']].concat(lines.map(function (l) { var ct = c[l.key]; return [l.name, l.sku, l.now, l.p.books, l.p.pos, l.p.recv, l.p.ret, l.p.adj, l.p.trf, l.exp, ct == null ? '' : ct, ct == null ? '' : Math.round((ct - l.exp) * 100) / 100]; })), 'stock-count-' + wh + '-' + to + '.csv'); };
    $('scPrint').onclick = function () {
      var win = window.open('', '_blank'); if (!win) return alert('Popup blocked! Please allow pop-ups.');
      win.document.write('<html><head><title>Count sheet</title><style>body{font:13px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:5px}</style></head><body><h3>Stock count sheet - ' + esc(wh) + ' - as at ' + esc(to) + '</h3><table><tr><th>Item</th><th>SKU</th><th>Expected</th><th>Counted</th><th>Difference</th></tr>' + lines.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.sku) + '</td><td align=right>' + q2(l.exp) + '</td><td style="width:90px"></td><td style="width:90px"></td></tr>'; }).join('') + '</table></body></html>'); win.document.close(); win.print();
    };
    saved();
  }
  function saved() {
    var all = ls('stockCounts', []); if (!Array.isArray(all) || !all.length || view !== 'count') { $('slSaved').innerHTML = ''; return; }
    $('slSaved').innerHTML = '<h3 class="text-sm font-bold mb-2">Saved counts</h3><table class="text-sm border"><thead><tr class="bg-gray-100"><th class="border px-2 py-1">Saved</th><th class="border px-2 py-1">Warehouse</th><th class="border px-2 py-1">As at</th><th class="border px-2 py-1">By</th><th class="border px-2 py-1">Items</th><th class="border px-2 py-1">With difference</th><th class="border px-2 py-1"></th></tr></thead><tbody>' +
      all.slice(0, 15).map(function (c, i) { return '<tr><td class="border px-2 py-1">' + esc(new Date(c.savedAt).toLocaleString()) + '</td><td class="border px-2 py-1">' + esc(c.warehouse) + '</td><td class="border px-2 py-1">' + esc(c.to) + '</td><td class="border px-2 py-1">' + esc(c.by) + '</td><td class="border px-2 py-1 text-right">' + c.lines.length + '</td><td class="border px-2 py-1 text-right">' + c.lines.filter(function (l) { return l.difference !== 0; }).length + '</td><td class="border px-2 py-1"><button data-o="' + i + '" class="text-blue-700">Open</button> · <button data-d="' + i + '" class="text-red-600">Delete</button></td></tr>'; }).join('') + '</tbody></table>';
    $('slSaved').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return; var list = ls('stockCounts', []);
      if (b.dataset.o != null) { var c = list[+b.dataset.o]; if (c) { view = 'count'; count({ from: c.from, to: c.to, wh: c.warehouse, counted: c.counted }); } }
      if (b.dataset.d != null && confirm('Delete this saved count?')) { list.splice(+b.dataset.d, 1); localStorage.setItem('stockCounts', JSON.stringify(list)); saved(); }
    };
  }
  function csvRaw(rows, name) {
    var t = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
  }
  function csv(list) { csvRaw([['Date', 'Item', 'SKU', 'Warehouse', 'Source', 'Type', 'Document', 'Till ref', 'Party', 'In', 'Out', 'By', 'Not yet deducted']].concat(list.map(function (r) { return [r.date, r.item, r.sku, r.wh, r.src, r.type, r.doc, r.ref, r.party, r.qin, r.qout, r.by, r.pending ? 'yes' : '']; })), 'stock-history.csv'); }

  /* ---------- mount: menu item under Inventory Hub + tab + render when opened ---------- */
  function mount() {
    var area = $('contentArea'), sub = $('inventorySubmenu'); if (!area || !sub) return false;
    if (!$(TAB)) { var d = document.createElement('div'); d.id = TAB; d.className = 'hidden ml-84 mr-7 p-2'; area.appendChild(d); }
    if (!sub.querySelector('[data-stock-history]')) {
      var mvBtn = sub.querySelector('button[onclick*="movementTab"]'), li = document.createElement('li'), b = document.createElement('button');
      b.setAttribute('data-stock-history', '1'); b.textContent = 'Stock History'; b.className = mvBtn ? mvBtn.className : 'w-full text-left p-1 rounded'; b.onclick = function () { w.showTab(TAB); };
      li.appendChild(b); var anchor = mvBtn && mvBtn.closest('li'); anchor && anchor.parentNode ? anchor.parentNode.insertBefore(li, anchor.nextSibling) : sub.appendChild(li);
    }
    if (!w.__slHooked && typeof w.showTab === 'function') {
      w.__slHooked = true; var orig = w.showTab;
      w.showTab = function (id) { var r = orig.apply(this, arguments); if (id === TAB) { try { render(); } catch (e) { console.error('[stock-history]', e); } } return r; };
    }
    return true;
  }
  var tries = 0; (function go() { if (!mount() && tries++ < 40) setTimeout(go, 500); })();
  w.renderStockHistory = render;
})(window);
