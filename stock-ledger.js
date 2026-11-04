/* Acacia Books - Stock Ledger + Stock Transit (one file)
 * PART 1  Reports > Inventory Reports > Stock History, the stock count check and the Stock Activity feed.
 * PART 2  Inventory > Stock Transit page: dispatch / receive / cancel transfers and Add Stock Activity.
 * Part 2 saves transfers in "movements" and manual activities in "stockActivities"; Part 1 reads them. */

/* ===================== PART 1: STOCK LEDGER / HISTORY ===================== */
/* Acacia Books - Reports > Inventory Reports > Stock History
 * One list of every stock movement (sold in Books, sold in POS, bills, returns, adjustments, transfers) and a stock count check.
 * Built from what Books already keeps: invoices (Books + POS), item history (bills / returns / write-offs), adjustments, transfers.
 * Nothing here changes stock. Saved counts are kept in the "stockCounts" list. */
(function (w) {
  'use strict';
  var TAB = 'stockHistoryReportPanel';
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
      'purchase return': ['Purchase return', 'Purchase return'], 'purchase return reversed': ['Purchase return', 'Purchase return reversed'], 'stock adjustment': ['Adjustment', 'Write-off'], 'opening balance': ['Opening stock', 'Opening stock'] };
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
      var f = where('', m.item), sku = m.sku || (f && f.it.sku) || '', st = m.status || 'Received', no = m.transitNo || '';
      /* leaves the sending warehouse when dispatched */
      add({ ts: m.date, item: m.item || '', sku: sku, wh: m.from || '', src: 'Transfer', chan: 'Books', type: st === 'In Transit' ? 'Transfer out (in transit)' : 'Transfer out', doc: no, ref: m.reference || '', party: '→ ' + (m.to || ''), qin: 0, qout: q, by: m.dispatchedBy || '', pending: false });
      /* reaches the receiving warehouse only when received */
      if (st === 'Received') add({ ts: m.receivedDate || m.date, item: m.item || '', sku: sku, wh: m.to || '', src: 'Transfer', chan: 'Books', type: 'Transfer in', doc: no, ref: m.reference || '', party: '← ' + (m.from || ''), qin: q, qout: 0, by: m.receivedBy || '', pending: false });
      /* cancelled transit goes back to the sender */
      if (st === 'Cancelled') add({ ts: m.cancelledDate || m.date, item: m.item || '', sku: sku, wh: m.from || '', src: 'Transfer', chan: 'Books', type: 'Transit cancelled (returned)', doc: no, ref: m.reference || '', party: '', qin: q, qout: 0, by: m.cancelledBy || '', pending: false });
    });

    /* 4) manual Stock In / Stock Out / Adjustments added on the Stock Transit page */
    (ls('stockActivities', []) || []).forEach(function (a) {
      if (!a) return; var qi = num(a.qin), qo = num(a.qout); if (!qi && !qo) return;
      add({ ts: a.date, item: a.item || '', sku: a.sku || '', wh: a.warehouse || '', src: 'Adjustment', chan: 'Books', type: a.type || 'Stock activity', doc: a.no || '', ref: a.reference || '', party: a.reason || '', qin: qi, qout: qo, by: a.by || '', pending: false });
    });
    rows.sort(function (a, b) { return b.ts - a.ts; });
    return { rows: rows, inv: inv };
  }

  /* ---------- UI ---------- */
  var cache = null, view = 'ledger', lastCount = null;
  var SRC = ['Books sale', 'POS sale', 'Purchase', 'Sales return', 'Purchase return', 'Adjustment', 'Transfer', 'Opening stock'];
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


  /* ---------- Stock Activity feed (used by the Stock Transit page) ---------- */
  function activityOf(r) {
    if (r.src === 'Books sale' || r.src === 'POS sale') return { a: r.pending ? 'Sale (not yet deducted)' : 'Sale', c: 'Sale' };
    if (r.src === 'Purchase') return { a: r.type === 'Bill deleted' ? 'Purchase (bill deleted)' : 'Purchase', c: 'Purchase' };
    if (r.src === 'Sales return') return { a: 'Sales Return', c: 'Sales Return' };
    if (r.src === 'Purchase return') return { a: r.type === 'Purchase return reversed' ? 'Purchase Return (reversed)' : 'Purchase Return', c: 'Purchase Return' };
    if (r.src === 'Opening stock') return { a: 'Opening Stock', c: 'Opening Stock' };
    if (r.src === 'Transfer') return { a: r.type, c: 'Transfer' };
    return { a: r.type || 'Adjustment', c: 'Adjustment' };
  }
  function pendingDocs() {                          /* documents that do not move stock (yet) */
    var out = [], done = /convert|invoic|receiv|fulfil|complet|closed|cancel|reject|deliver|billed/i;
    [['quotes', 'Quotation', ['quoteNumber', 'number']], ['orders', 'Sales Order', ['orderNumber', 'soNumber', 'number', 'id']], ['purchaseOrders', 'Purchase Order', ['poNumber', 'number']]].forEach(function (k) {
      (ls(k[0], []) || []).forEach(function (d) {
        if (!d) return; var no = ''; k[2].forEach(function (f) { if (!no && d[f] != null && d[f] !== '') no = d[f]; });
        var st = String(d.status || ''), isQ = k[1] === 'Quotation', over = done.test(st), dt = dateOf(d.date || d.orderDate);
        (d.items || []).forEach(function (l) {
          if (!l || !isStock(l)) return; var q = num(l.qty != null ? l.qty : l.quantity); if (!q) return;
          out.push({ ts: dt ? dt.getTime() : 0, date: dt ? ymd(dt) : '', item: l.desc || l.name || l.item || l.product || l.description || '', wh: l.warehouse || '',
            a: k[1] + ' - ' + (isQ || over ? 'No movement' : 'Pending'), c: isQ || over ? 'No movement' : 'Pending', ref: String(no), qin: 0, qout: 0, note: q + ' unit(s)' + (st ? ' - ' + st : '') });
        });
      });
    });
    return out;
  }
  w.acxStockActivity = function () {
    var rows = build().rows.map(function (r) { var x = activityOf(r); return { ts: r.ts, date: r.date, item: r.item, wh: r.wh, a: x.a, c: x.c, ref: r.doc || r.ref || '', qin: r.qin, qout: r.qout, note: r.party || '' }; });
    return rows.concat(pendingDocs()).sort(function (a, b) { return b.ts - a.ts; });
  };

  /* ---------- mount: report under Reports > Inventory Reports ---------- */
  function mount() {
    var area = document.querySelector('.reports-content'), list = document.querySelector('ul.rep-cat-children[data-cat="cat_inventoryReports"]'); if (!area || !list) return false;
    /* the old Stock History entry under Inventory > Stock is gone */
    var old = document.querySelector('#inventorySubmenu [data-stock-history]'); if (old) { var oli = old.closest('li'); (oli || old).remove(); }
    var oldTab = $('stockLedgerTab'); if (oldTab) oldTab.remove();
    if (!$(TAB)) { var d = document.createElement('div'); d.id = TAB; d.className = 'report-view hidden bg-white rounded-lg shadow mb-6 p-6 border-t'; area.appendChild(d); }
    if (!list.querySelector('[data-stock-history]')) {
      var li = document.createElement('li'); li.setAttribute('data-stock-history', '1'); li.textContent = '📁 Stock History';
      li.onclick = function () { w.showReport(TAB, li); };
      var after = list.querySelector('li[onclick*="simpleWarehouseMovementPanel"]');
      after ? after.parentNode.insertBefore(li, after.nextSibling) : list.appendChild(li);
      var head = document.querySelector('.rep-cat-header[data-cat="cat_inventoryReports"] .rep-cat-count');
      if (head) { var n = parseInt(String(head.textContent).replace(/\D/g, ''), 10); if (n >= 0) head.textContent = '(' + (n + 1) + ')'; }
    }
    if (!w.__slHooked && typeof w.showReport === 'function') {
      w.__slHooked = true; var orig = w.showReport;
      w.showReport = function (id) { var r = orig.apply(this, arguments); if (id === TAB) { try { render(); } catch (e) { console.error('[stock-history]', e); } } return r; };
    }
    return true;
  }
  var tries = 0; (function go() { if (!mount() && tries++ < 40) setTimeout(go, 500); })();
  w.renderStockHistory = render;
})(window);

/* ===================== PART 2: STOCK TRANSIT ===================== */
/* Acacia Books - Inventory > Stock Transit
 * Replaces the old "movement" page.
 *  - Transfer from warehouse A to warehouse B goes through TRANSIT:
 *      Dispatch  -> stock leaves the source warehouse now, destination does NOT get it yet (status "In Transit")
 *      Receive   -> destination warehouse gets the stock (status "Received")
 *      Cancel    -> stock goes back to the source warehouse (status "Cancelled")
 *  - "Add Stock Activity" also records Stock In, Stock Out and Adjustments (kept in the "stockActivities" list).
 *  - Transfers are still saved in the existing "movements" list, so Recycle Bin, sync and the Stock Transfers report keep working.
 *    Old transfers (saved before this change, no status) show as Received.
 *  - Everything is read by Reports > Inventory Reports > Stock History (stock-ledger.js). */
(function (w) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n, l) { return String(n).padStart(l, '0'); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var rd = function (k) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  var mv = function () { return rd('movements'); };
  var setMv = function (a) { localStorage.setItem('movements', JSON.stringify(a)); };
  var acts = function () { return rd('stockActivities'); };
  var setActs = function (a) { localStorage.setItem('stockActivities', JSON.stringify(a)); };
  function who() { try { var u = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {}; return u.name || u.fullName || u.username || u.email || ''; } catch (e) { return ''; } }
  var statusOf = function (m) { return (m && m.status) || 'Received'; };
  var same = function (x, m) { return x && ((m.sku && x.sku && low(x.sku) === low(m.sku)) || low(x.name) === low(m.item)); };

  function nextNo(list, prefix, field) {
    var max = list.length;
    list.forEach(function (r) { var d = parseInt(String(r && r[field] || '').replace(/\D/g, ''), 10); if (d > max) max = d; });
    return prefix + pad(max + 1, 4);
  }
  function refresh() {
    ['renderMovementTable', 'renderInventoryTable', 'renderStockTransfer'].forEach(function (f) { try { if (typeof w[f] === 'function') w[f](); } catch (e) { console.error('[stock-transit]', f, e); } });
  }
  function itemsOf(wh) { try { return (wh ? w.getInventory(wh) : w.getAllInventories()) || []; } catch (e) { return []; } }

  /* ---------- page ---------- */
  var BTN = 'bg-blue-900 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-800';
  var INP = 'border p-2 rounded w-full text-sm';
  function tabHtml() {
    return '<h2 class="text-sm font-bold mb-1">Stock Transit</h2>' +
      '<p class="text-xs text-gray-600 mb-3">Move stock between warehouses. Dispatched stock leaves the sending warehouse at once and only reaches the receiving warehouse when it is received. Sales, bills, returns and adjustments are listed in Reports &gt; Inventory Reports &gt; Stock History.</p>' +
      '<div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">' +
        '<div class="flex flex-wrap items-center gap-2">' +
          '<input id="movementSearch" placeholder="Search transit no., item, warehouse" class="border rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" oninput="searchMovement()">' +
          '<select id="trStatus" class="border rounded-md px-2 py-1.5 text-sm" onchange="renderMovementTable()"><option value="">All statuses</option><option>In Transit</option><option>Received</option><option>Cancelled</option></select>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<button id="trAddBtn" class="' + BTN + ' font-semibold" onclick="trToggleForm()">+ Add Stock Activity</button>' +
          '<div id="movementExpertSection" class="relative inline-block text-left"><button id="movementExpertBtn" class="inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-1.5 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">Options</button>' +
          '<div id="movementDropdown" class="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 hidden z-50"><div class="py-1">' +
            '<button onclick="trExport()" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Export transit list (CSV)</button>' +
            '<button onclick="window.print()" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Print</button></div></div></div>' +
        '</div>' +
      '</div>' +
      '<div id="trSummary" class="text-xs text-gray-700 mb-3"></div>' +

      '<div id="trForm" class="bg-white p-6 rounded shadow space-y-4 mb-6 hidden"><h3 class="text-sm font-bold text-gray-700 border-b pb-2">Add Stock Activity</h3>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div><label class="block text-sm font-semibold mb-1">Activity <span class="text-red-500">*</span></label><select id="actType" class="' + INP + '" onchange="trActChange()">' +
            '<option value="transfer">Transfer between warehouses (goes In Transit)</option><option value="in">Stock In</option><option value="out">Stock Out</option><option value="inc">Adjustment - increase</option><option value="dec">Adjustment - decrease</option></select></div>' +
          '<div id="trWhOne" class="hidden"><label class="block text-sm font-semibold mb-1">Warehouse <span class="text-red-500">*</span></label><select id="actWarehouse" class="' + INP + '" onchange="populateMovementItems()"><option value="">Select Warehouse</option></select></div>' +
          '<div id="trWhFrom"><label class="block text-sm font-semibold mb-1">From warehouse (sending) <span class="text-red-500">*</span></label><select id="fromLocation" class="' + INP + '" onchange="populateMovementItems()"><option value="">Select Warehouse</option></select></div>' +
          '<div id="trWhTo"><label class="block text-sm font-semibold mb-1">To warehouse (receiving) <span class="text-red-500">*</span></label><select id="toLocation" class="' + INP + '"><option value="">Select Warehouse</option></select></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Item <span class="text-red-500">*</span></label><select id="transferItem" class="' + INP + '"><option value="">Select Item</option></select></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Quantity <span class="text-red-500">*</span></label><input id="transferQuantity" type="number" min="0" step="any" placeholder="Quantity" class="' + INP + '"></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Date <span class="text-red-500">*</span></label><input id="transferDate" type="date" class="' + INP + '"></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Reference number</label><input id="actRef" placeholder="Invoice, transfer or adjustment no." class="' + INP + '"></div>' +
        '</div>' +
        '<div><label class="block text-sm font-semibold mb-1">Reason / Notes</label><textarea id="actNotes" class="' + INP + ' resize-y" rows="2" placeholder="Reason / notes"></textarea></div>' +
        '<div class="text-right space-x-2 border-t pt-4"><button id="trSave" onclick="saveTransfer()" class="' + BTN + ' font-semibold">Dispatch to Transit</button> <button onclick="cancelTransfer()" class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600">Cancel</button></div>' +
      '</div>' +

      '<div class="bg-white p-4 rounded shadow mb-6"><div class="flex justify-between items-center mb-4"><h3 class="text-sm font-semibold">Stock Transit</h3></div>' +
        '<div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr>' +
          ['Transit No.', 'Date', 'Item', 'SKU', 'From', 'To', 'Quantity', 'Dispatched By', 'Received By', 'Status'].map(function (h) { return '<th class="border p-2 text-left">' + h + '</th>'; }).join('') +
          '<th class="border p-2 text-center">Actions</th></tr></thead><tbody id="movementTableBody"></tbody></table></div>' +
        '<div id="paginationControls" class="flex items-center justify-between mt-4 px-2 text-sm text-gray-600"><div>Total Count: <span id="totalCount">0</span></div><div>Show <select id="itemsPerPageSelect" class="border rounded px-2 py-1 mx-1"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select> per page</div><div class="space-x-1"><button id="prevPageBtn" class="px-2 py-1 border rounded disabled:opacity-50" disabled="disabled">Prev</button> <span id="pageInfo" class="px-2">1 - 0</span> <button id="nextPageBtn" class="px-2 py-1 border rounded disabled:opacity-50" disabled="disabled">Next</button></div></div>' +
      '</div>' +

      '<div class="bg-white p-4 rounded shadow mb-6"><div class="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3"><h3 class="text-sm font-semibold">Stock Activity</h3><div class="flex flex-wrap gap-2">' +
        '<input id="saSearch" placeholder="Search item, warehouse, reference" class="border rounded-md px-3 py-1.5 text-sm w-60" oninput="trRenderActivity()">' +
        '<select id="saCat" class="border rounded-md px-2 py-1.5 text-sm" onchange="trRenderActivity()"><option value="">All activity</option><option>Sale</option><option>Purchase</option><option>Sales Return</option><option>Purchase Return</option><option>Transfer</option><option>Adjustment</option><option>Opening Stock</option><option>Pending</option><option>No movement</option></select></div></div>' +
        '<p class="text-xs text-gray-600 mb-2">Read-only. Filled automatically from invoices, bills, returns, adjustments, transfers and opening stock. Quotations, sales orders and purchase orders do not move stock; they show as Pending or No movement.</p>' +
        '<div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr>' +
        ['Date', 'Item', 'Warehouse', 'Activity', 'Reference', 'In', 'Out'].map(function (h, i) { return '<th class="border p-2 text-' + (i > 4 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') +
        '</tr></thead><tbody id="trActBody"></tbody></table></div><div id="saCount" class="text-xs text-gray-500 mt-2"></div></div>';
  }

  /* ---------- Stock Activity table ---------- */
  w.trRenderActivity = function () {
    var ab = $('trActBody'); if (!ab) return;
    var all = []; try { all = typeof w.acxStockActivity === 'function' ? w.acxStockActivity() : []; } catch (e) { console.error('[stock-activity]', e); }
    var q = low(($('saSearch') || {}).value), c = ($('saCat') || {}).value;
    var rows = all.filter(function (r) { return (!c || r.c === c) && (!q || [r.item, r.wh, r.a, r.ref, r.note].join(' ').toLowerCase().indexOf(q) > -1); });
    var td = 'border p-2', shownRows = rows.slice(0, 300);
    ab.innerHTML = shownRows.length ? shownRows.map(function (r) {
      var np = r.c === 'Pending' || r.c === 'No movement';
      return '<tr' + (np ? ' class="text-gray-500"' : '') + '><td class="' + td + '">' + esc(r.date) + '</td><td class="' + td + '">' + esc(r.item) + '</td><td class="' + td + '">' + esc(r.wh) + '</td><td class="' + td + '">' + esc(r.a) + (np && r.note ? ' <span class="text-xs">(' + esc(r.note) + ')</span>' : '') + '</td><td class="' + td + '">' + esc(r.ref) + '</td>' +
        '<td class="' + td + ' text-right">' + (np ? '' : esc(r.qin || 0)) + '</td><td class="' + td + ' text-right">' + (np ? '' : esc(r.qout || 0)) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="text-center p-4 text-gray-500">No stock activity found.</td></tr>';
    if ($('saCount')) $('saCount').textContent = rows.length > 300 ? 'Showing the latest 300 of ' + rows.length + '. Use the filters, or open Reports > Inventory Reports > Stock History for the full list and CSV.' : rows.length + ' line(s)';
  };

  /* ---------- dropdowns ---------- */
  function fillSelect(el, names, keep) {
    if (!el) return; var cur = keep == null ? el.value : keep;
    el.innerHTML = '<option value="">Select Warehouse</option>' + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    if (cur && names.indexOf(cur) > -1) el.value = cur;
  }
  w.populateMovementWarehouses = function () {
    var names = []; try { names = (JSON.parse(localStorage.getItem('warehouses') || '[]') || []).map(function (x) { return x && x.name; }).filter(Boolean); } catch (e) {}
    fillSelect($('fromLocation'), names); fillSelect($('toLocation'), names); fillSelect($('actWarehouse'), names);
  };
  w.populateMovementItems = function () {
    var sel = $('transferItem'); if (!sel) return;
    var t = $('actType') ? $('actType').value : 'transfer';
    var wh = t === 'transfer' ? ($('fromLocation') || {}).value : ($('actWarehouse') || {}).value;
    var list = (t === 'in' || !wh) ? itemsOf('') : itemsOf(wh), seen = {}, cur = sel.value;
    sel.innerHTML = '<option value="">Select Item</option>';
    list.forEach(function (it) {
      if (!it || !it.name) return; var k = it.sku || it.name; if (seen[k]) return; seen[k] = 1;
      var o = document.createElement('option'); o.value = k; o.textContent = it.name + ' (' + (it.sku || 'No SKU') + ')'; sel.appendChild(o);
    });
    if (cur && seen[cur]) sel.value = cur;
  };
  w.trActChange = function () {
    var t = $('actType').value, tr = t === 'transfer';
    $('trWhOne').classList.toggle('hidden', tr); $('trWhFrom').classList.toggle('hidden', !tr); $('trWhTo').classList.toggle('hidden', !tr);
    $('trSave').textContent = tr ? 'Dispatch to Transit' : 'Save Stock Activity';
    w.populateMovementItems();
  };
  w.trToggleForm = function (show) {
    var f = $('trForm'); if (!f) return; var open = typeof show === 'boolean' ? show : f.classList.contains('hidden');
    f.classList.toggle('hidden', !open);
    if (open) { w.populateMovementWarehouses(); w.trActChange(); if (!$('transferDate').value) $('transferDate').value = today(); }
  };

  /* ---------- save: transfer (dispatch) or stock activity ---------- */
  function findIn(inv, key) { return (inv || []).filter(function (x) { return x && (x.sku === key || x.name === key); })[0]; }
  function templateFor(key) { var all = itemsOf(''); return findIn(all, key); }
  function clean(it, qty) { var c = Object.assign({}, it); delete c.history; c.qty = qty; return c; }

  w.saveTransfer = function () {
    var t = $('actType').value, key = $('transferItem').value, qty = num($('transferQuantity').value), date = $('transferDate').value;
    var ref = $('actRef').value.trim(), note = $('actNotes').value.trim();
    if (!key || !(qty > 0) || !date) return alert('Please choose the item, a quantity above 0 and a date.');
    if (t === 'transfer') {
      var from = $('fromLocation').value, to = $('toLocation').value;
      if (!from || !to) return alert('Please choose the sending and the receiving warehouse.');
      if (from === to) return alert('From and To warehouses cannot be the same.');
      var inv = w.getInventory(from), it = findIn(inv, key);
      if (!it || num(it.qty) < qty) return alert('Insufficient quantity in source warehouse.');
      it.qty = num(it.qty) - qty; w.saveInventory(from, inv);                        /* leaves the sender now; destination waits for Receive */
      var list = mv();
      list.push({ id: 'TR' + Date.now(), transitNo: nextNo(list, 'TRN-', 'transitNo'), item: it.name, sku: it.sku || '', from: from, to: to, quantity: qty, date: date,
        status: 'In Transit', dispatchedBy: who(), receivedBy: '', receivedDate: '', reference: ref, reason: note });
      setMv(list);
      alert('Stock dispatched. It is now In Transit and will be added to ' + to + ' when it is received.');
    } else {
      var wh = $('actWarehouse').value; if (!wh) return alert('Please choose the warehouse.');
      var inc = (t === 'in' || t === 'inc'), invW = w.getInventory(wh) || [], itW = findIn(invW, key);
      if (!inc && (!itW || num(itW.qty) < qty)) return alert('Insufficient quantity in this warehouse.');
      if (!itW) { var tpl = templateFor(key); if (!tpl) return alert('Item not found.'); itW = clean(tpl, 0); invW.push(itW); }
      itW.qty = num(itW.qty) + (inc ? qty : -qty); w.saveInventory(wh, invW);
      var a = acts();
      a.push({ id: 'SA' + Date.now(), no: nextNo(a, 'ACT-', 'no'), type: { in: 'Stock In', out: 'Stock Out', inc: 'Adjustment (increase)', dec: 'Adjustment (decrease)' }[t],
        item: itW.name, sku: itW.sku || '', warehouse: wh, qin: inc ? qty : 0, qout: inc ? 0 : qty, date: date, reference: ref, reason: note, by: who() });
      setActs(a);
      alert('Stock activity saved.');
    }
    w.cancelTransfer(); w.trToggleForm(false); refresh();
  };
  w.cancelTransfer = function () {
    ['transferItem', 'fromLocation', 'toLocation', 'actWarehouse', 'transferQuantity', 'transferDate', 'actRef', 'actNotes'].forEach(function (id) { var e = $(id); if (e) e.value = ''; });
    if ($('actType')) { $('actType').value = 'transfer'; w.trActChange(); }
    w.trToggleForm(false);
  };

  /* ---------- receive / cancel ---------- */
  w.trReceive = function (i) {
    var list = mv(), m = list[i]; if (!m || statusOf(m) !== 'In Transit') return;
    var old = $('trRecv'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'trRecv';
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center';
    box.innerHTML = '<div class="bg-white rounded shadow-lg p-5 w-96 max-w-full"><h3 class="text-sm font-bold mb-1">Receive stock</h3>' +
      '<p class="text-xs text-gray-600 mb-3">' + esc(m.transitNo || '') + ': ' + esc(m.quantity) + ' x ' + esc(m.item) + ' from ' + esc(m.from) + ' to <b>' + esc(m.to) + '</b>. The quantity is added to ' + esc(m.to) + ' now.</p>' +
      '<label class="block text-sm font-semibold mb-1">Received by</label><input id="trRcvBy" class="' + INP + ' mb-3" value="' + esc(who()) + '">' +
      '<label class="block text-sm font-semibold mb-1">Date received</label><input id="trRcvDate" type="date" class="' + INP + ' mb-4" value="' + today() + '">' +
      '<div class="text-right space-x-2"><button id="trRcvNo" class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm">Close</button><button id="trRcvOk" class="' + BTN + ' font-semibold">Confirm receipt</button></div></div>';
    document.body.appendChild(box);
    $('trRcvNo').onclick = function () { box.remove(); };
    $('trRcvOk').onclick = function () {
      var by = $('trRcvBy').value.trim(), dt = $('trRcvDate').value;
      if (!by || !dt) return alert('Please enter who received the stock and the date.');
      var cur = mv(), r = cur[i]; if (!r || statusOf(r) !== 'In Transit') { box.remove(); return; }
      var q = num(r.quantity), dest = w.getInventory(r.to) || [], hit = dest.filter(function (x) { return same(x, r); })[0];
      if (hit) hit.qty = num(hit.qty) + q;
      else { var src = (w.getInventory(r.from) || []).filter(function (x) { return same(x, r); })[0] || templateFor(r.sku || r.item) || { name: r.item, sku: r.sku || '' }; dest.push(clean(src, q)); }
      w.saveInventory(r.to, dest);
      r.status = 'Received'; r.receivedBy = by; r.receivedDate = dt; setMv(cur);
      box.remove(); refresh();
    };
  };
  w.trCancelTransit = function (i) {
    var list = mv(), m = list[i]; if (!m || statusOf(m) !== 'In Transit') return;
    if (!confirm('Cancel this transit? ' + m.quantity + ' x ' + m.item + ' goes back to ' + m.from + '.')) return;
    var q = num(m.quantity), src = w.getInventory(m.from) || [], hit = src.filter(function (x) { return same(x, m); })[0];
    if (hit) hit.qty = num(hit.qty) + q; else src.push(clean(templateFor(m.sku || m.item) || { name: m.item, sku: m.sku || '' }, q));
    w.saveInventory(m.from, src);
    m.status = 'Cancelled'; m.cancelledDate = today(); m.cancelledBy = who(); setMv(list); refresh();
  };
  var origDelete = w.deleteMovement;
  w.deleteMovement = function (i) {
    var m = mv()[i]; if (m && statusOf(m) === 'In Transit') return alert('Receive or cancel this transit before deleting it.');
    return typeof origDelete === 'function' ? origDelete.apply(this, arguments) : undefined;
  };

  /* ---------- transit table ---------- */
  var BADGE = { 'In Transit': 'bg-yellow-100 text-yellow-800', 'Received': 'bg-green-100 text-green-800', 'Cancelled': 'bg-gray-200 text-gray-700' };
  function shown() {
    var q = low(($('movementSearch') || {}).value), st = ($('trStatus') || {}).value, out = [];
    mv().forEach(function (m, i) {
      if (!m) return; var s = statusOf(m); if (st && s !== st) return;
      var no = m.transitNo || ('TRN-' + pad(i + 1, 4));
      if (q && [no, m.item, m.sku, m.from, m.to, m.dispatchedBy, m.receivedBy, m.date, s].join(' ').toLowerCase().indexOf(q) < 0) return;
      out.push({ m: m, i: i, no: no, s: s });
    });
    return out.reverse();
  }
  w.renderMovementTable = function () {
    var body = $('movementTableBody'); if (!body) return;
    var rows = shown(), all = mv(), transitUnits = 0, transitCount = 0;
    all.forEach(function (m) { if (m && statusOf(m) === 'In Transit') { transitCount++; transitUnits += num(m.quantity); } });
    if ($('trSummary')) $('trSummary').innerHTML = 'In transit now: <b>' + transitCount + '</b> transfer(s), <b>' + transitUnits + '</b> unit(s) &nbsp;|&nbsp; Total transfers: <b>' + all.length + '</b>';
    body.innerHTML = rows.length ? rows.map(function (r) {
      var m = r.m, td = 'border p-2';
      return '<tr><td class="' + td + '">' + esc(r.no) + '</td><td class="' + td + '">' + esc(m.date) + '</td><td class="' + td + '">' + esc(m.item) + '</td><td class="' + td + '">' + esc(m.sku || '') + '</td>' +
        '<td class="' + td + '">' + esc(m.from) + '</td><td class="' + td + '">' + esc(m.to) + '</td><td class="' + td + '">' + esc(m.quantity) + '</td>' +
        '<td class="' + td + '">' + esc(m.dispatchedBy || '') + '</td><td class="' + td + '">' + esc(m.receivedBy || '') + '</td>' +
        '<td class="' + td + '"><span class="px-2 py-0.5 rounded text-xs ' + BADGE[r.s] + '">' + r.s + '</span></td>' +
        '<td class="' + td + ' text-center whitespace-nowrap"><button class="' + BTN.replace('px-3 py-1.5', 'px-2 py-1') + ' mr-1" onclick="previewMovement(' + r.i + ')">View</button>' +
        (r.s === 'In Transit' ? '<button class="bg-green-700 text-white px-2 py-1 rounded text-sm hover:bg-green-600 mr-1" onclick="trReceive(' + r.i + ')">Receive</button><button class="bg-gray-600 text-white px-2 py-1 rounded text-sm hover:bg-gray-500" onclick="trCancelTransit(' + r.i + ')">Cancel</button>'
          : '<button class="bg-red-700 text-white px-2 py-1 rounded text-sm hover:bg-red-600" onclick="deleteMovement(' + r.i + ')">Delete</button>') + '</td></tr>';
    }).join('') : '<tr><td colspan="11" class="text-center p-4 text-gray-500">No stock transits recorded.</td></tr>';
    if ($('totalCount')) $('totalCount').textContent = rows.length;
    w.trRenderActivity();
  };

  w.searchMovement = function () { w.renderMovementTable(); };
  w.renderFilteredMovementTable = function () { w.renderMovementTable(); };
  w.showMovementTab = function () { w.populateMovementWarehouses(); w.populateMovementItems(); w.renderMovementTable(); };
  w.trExport = function () {
    var rows = [['Transit No.', 'Date', 'Item', 'SKU', 'From', 'To', 'Quantity', 'Dispatched By', 'Received By', 'Date Received', 'Status', 'Reference', 'Notes']].concat(shown().map(function (r) { var m = r.m; return [r.no, m.date, m.item, m.sku || '', m.from, m.to, m.quantity, m.dispatchedBy || '', m.receivedBy || '', m.receivedDate || '', r.s, m.reference || '', m.reason || '']; }));
    var t = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'stock-transit.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------- mount ---------- */
  function mount() {
    var tab = $('movementTab'); if (!tab) return false;
    if (!tab.getAttribute('data-transit')) {              /* normally the page is already in index.html; this only runs if it is not */
      tab.setAttribute('data-transit', '1'); tab.innerHTML = tabHtml();
      var dd = $('movementExpertBtn'); if (dd) dd.addEventListener('click', function () { $('movementDropdown').classList.toggle('hidden'); });
    }
    var btn = document.querySelector('button[onclick*="movementTab"]');
    if (btn && btn.textContent.trim() !== 'Stock Transit') btn.textContent = 'Stock Transit';
    return true;
  }
  var tries = 0; (function go() { if (!mount() && tries++ < 40) setTimeout(go, 500); })();
  setTimeout(function () { mount(); }, 1500);   /* the language pass can reset the menu label - set it again */
})(window);
