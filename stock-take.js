/* Acacia Books - Inventory > Assessment (Stock Take)
 * Two screens inside the Assessment page:
 *   1. Stock Take Register  - one row per counting session, summary cards, New Stock Take form.
 *   2. Working Sheet        - item-by-item count: system qty, physical qty, variance, value, reason.
 * Workflow: Draft -> Counting -> Submitted -> Approved -> Posted.
 * Inventory balances change ONLY when a count is Posted. Posting writes one Adjustment per variance
 * line to "stockActivities", so it shows in Reports > Inventory Reports > Stock History.
 * Data: localStorage "stockTakes". */
(function (w) {
  'use strict';
  var KEY = 'stockTakes', TAB = 'assessmentTab';
  var $ = function (id) { return document.getElementById(id); };
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n, l) { return String(n).padStart(l, '0'); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var fmtDate = function (d) { var m = String(d || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (d || ''); };
  var rd = function (k) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  var takes = function () { return rd(KEY); };
  var setTakes = function (a) { localStorage.setItem(KEY, JSON.stringify(a)); };
  function who() { try { var u = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {}; return u.name || u.fullName || u.username || u.email || ''; } catch (e) { return ''; } }
  function role() { try { return String((JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {}).role || '').toLowerCase(); } catch (e) { return ''; } }
  function canApprove() { var r = role(); return !r || r === 'admin' || r === 'account' || r === 'accounts'; }
  function money(v) { try { if (typeof w.formatCurrency === 'function') return w.formatCurrency(v); } catch (e) {} return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function signed(n) { return n > 0 ? '+' + n : String(n); }
  function r4(n) { return Math.round(n * 10000) / 10000; }

  var BTN = 'bg-blue-900 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-800';
  var BTN2 = 'bg-gray-600 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-500';
  var INP = 'border p-2 rounded w-full text-sm';
  var BADGE = { Draft: 'bg-gray-200 text-gray-700', Counting: 'bg-yellow-100 text-yellow-800', Submitted: 'bg-blue-100 text-blue-800', Approved: 'bg-green-100 text-green-800', Posted: 'bg-green-700 text-white' };
  var REASONS = ['Miscount', 'Damaged', 'Expired', 'Theft / loss', 'Received, not recorded', 'Issued, not recorded', 'Wrong location', 'Other'];
  var state = { view: 'register', id: null, t: null };
  var saveTimer = null;

  /* ---------- helpers ---------- */
  function warehouses() { try { return (JSON.parse(localStorage.getItem('warehouses') || '[]') || []).map(function (x) { return x && x.name; }).filter(Boolean); } catch (e) { return []; } }
  function invOf(wh) { try { return (w.getInventory(wh) || []).filter(function (x) { return x && x.name; }); } catch (e) { return []; } }
  function catOf(it) { return it.category || it.categoryName || ''; }
  function costOf(it) { return num(it.costPrice != null ? it.costPrice : it.buyPrice != null ? it.buyPrice : it.unitCost != null ? it.unitCost : it.purchasePrice != null ? it.purchasePrice : it.cost); }
  function nextNo(list, prefix, field, len) {
    var max = list.length;
    list.forEach(function (r) { var d = parseInt(String(r && r[field] || '').replace(/\D/g, ''), 10); if (d > max) max = d; });
    return prefix + pad(max + 1, len);
  }
  function byId(id) {                                   /* the open sheet lives in memory so quick edits never overwrite each other */
    if (state.t && state.t.id === id) return state.t;
    return takes().filter(function (t) { return t.id === id; })[0];
  }
  function put(t) { var a = takes(), i = a.findIndex(function (x) { return x.id === t.id; }); if (i < 0) a.push(t); else a[i] = t; setTakes(a); if (state.t && state.t.id === t.id) state.t = t; }
  function calc(l) {
    var counted = l.physicalQty !== null && l.physicalQty !== '' && l.physicalQty !== undefined;
    var p = counted ? num(l.physicalQty) : null, v = counted ? r4(p - num(l.systemQty)) : null;
    return { counted: counted, p: p, v: v, val: counted ? r4(v * num(l.unitCost)) : null };
  }
  function totals(t) {
    var s = 0, p = 0, n = 0, val = 0, c = 0, diffLines = 0;
    t.lines.forEach(function (l) {
      s += num(l.systemQty); var k = calc(l);
      if (k.counted) { c++; p += k.p; n += k.v; val += k.val; if (k.v !== 0) diffLines++; }
    });
    return { sys: r4(s), phys: r4(p), net: r4(n), val: r4(val), counted: c, total: t.lines.length, diffLines: diffLines };
  }
  function blindNow(t) { return !!t.blind && (t.status === 'Draft' || t.status === 'Counting'); }
  function editable(t) { return t.status === 'Counting'; }

  /* ---------- register ---------- */
  function renderRegister() {
    var root = $(TAB); if (!root) return;
    var all = takes(), q = low(($('stSearch') || {}).value), st = ($('stStatus') || {}).value || '';
    var cards = { total: all.length, pend: 0, done: 0, diff: 0 };
    all.forEach(function (t) { var k = totals(t); if (t.status === 'Submitted') cards.pend++; if (t.status === 'Posted') cards.done++; if (k.diffLines > 0) cards.diff++; });
    var rows = all.slice().reverse().filter(function (t) {
      if (st && t.status !== st) return false;
      return !q || [t.no, t.warehouse, t.status, t.date, t.assignedTo, t.category].join(' ').toLowerCase().indexOf(q) > -1;
    });
    var card = function (label, n, cls) { return '<div class="bg-white rounded shadow p-4"><div class="text-xs text-gray-500">' + label + '</div><div class="text-2xl font-bold ' + (cls || 'text-blue-900') + '">' + n + '</div></div>'; };
    var td = 'border p-2';
    var body = rows.length ? rows.map(function (t) {
      var k = totals(t), anyCount = k.counted > 0;
      return '<tr class="hover:bg-gray-50"><td class="' + td + ' font-semibold">' + esc(t.no) + '</td><td class="' + td + '">' + esc(fmtDate(t.date)) + '</td><td class="' + td + '">' + esc(t.warehouse) + (t.category ? ' <span class="text-xs text-gray-500">(' + esc(t.category) + ')</span>' : '') + '</td>' +
        '<td class="' + td + ' text-right">' + k.total + '</td><td class="' + td + ' text-right">' + (anyCount ? (k.diffLines ? '<span class="text-red-600 font-semibold">' + k.diffLines + '</span>' : '0') : '-') + '</td>' +
        '<td class="' + td + '"><span class="px-2 py-0.5 rounded text-xs ' + BADGE[t.status] + '">' + esc(t.status) + '</span></td>' +
        '<td class="' + td + ' text-center whitespace-nowrap"><button class="' + BTN.replace('px-3 py-1.5', 'px-2 py-1') + ' mr-1" onclick="stOpen(\'' + esc(t.id) + '\')">Open</button>' +
        (t.status === 'Draft' || t.status === 'Counting' ? '<button class="bg-red-700 text-white px-2 py-1 rounded text-sm hover:bg-red-600" onclick="stDelete(\'' + esc(t.id) + '\')">Delete</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="text-center p-4 text-gray-500">No stock takes found.</td></tr>';
    var keepForm = $('stForm') && !$('stForm').classList.contains('hidden');
    root.innerHTML =
      '<div class="flex flex-col md:flex-row md:items-end justify-between gap-2 mb-3"><div><h2 class="text-sm font-bold">Stock Take Register</h2><div class="text-xs text-gray-500">Inventory Control</div></div>' +
      '<div class="flex flex-wrap items-center gap-2"><input id="stSearch" placeholder="Search count no., warehouse, status" class="border rounded-md px-3 py-1.5 text-sm w-64" value="' + esc(($('stSearch') || {}).value || '') + '" oninput="stRenderRegister()">' +
      '<select id="stStatus" class="border rounded-md px-2 py-1.5 text-sm" onchange="stRenderRegister()"><option value="">All statuses</option>' + ['Draft', 'Counting', 'Submitted', 'Approved', 'Posted'].map(function (s) { return '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<button class="' + BTN + ' font-semibold" onclick="stToggleForm()">New Stock Take</button></div></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + card('Total Stock Takes', cards.total) + card('Pending Approval', cards.pend, 'text-yellow-700') + card('Completed', cards.done, 'text-green-700') + card('With Variances', cards.diff, 'text-red-600') + '</div>' +
      formHtml(keepForm) +
      '<div class="bg-white p-4 rounded shadow mb-6"><div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr>' +
      ['Count No.', 'Date', 'Warehouse', 'Items', 'Variance', 'Status'].map(function (h, i) { return '<th class="border p-2 text-' + (i === 3 || i === 4 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') + '<th class="border p-2 text-center">Actions</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="text-xs text-gray-500 mt-2">Variance = number of items whose physical count differs from the system quantity.</div></div>';
    if (keepForm) wireForm();
  }
  w.stRenderRegister = function () {
    var s = $('stSearch'), pos = s ? s.selectionStart : 0, had = s && document.activeElement === s;
    renderRegister();
    if (had) { var n = $('stSearch'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
  };

  function formHtml(open) {
    var whs = warehouses(), a = takes();
    return '<div id="stForm" class="bg-white p-6 rounded shadow space-y-4 mb-6' + (open ? '' : ' hidden') + '"><h3 class="text-sm font-bold text-gray-700 border-b pb-2">New Stock Take</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
      '<div><label class="block text-sm font-semibold mb-1">Stock Take No.</label><input id="stNo" class="' + INP + ' bg-gray-100" readonly value="' + esc(nextNo(a, 'ST-', 'no', 3)) + '"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Count Date <span class="text-red-500">*</span></label><input id="stDate" type="date" class="' + INP + '" value="' + today() + '"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Warehouse <span class="text-red-500">*</span></label><select id="stWh" class="' + INP + '"><option value="">Select Warehouse</option>' + whs.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Category <span class="text-xs font-normal text-gray-500">(optional)</span></label><select id="stCat" class="' + INP + '"><option value="">All categories</option></select></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Count Method</label><select id="stMethod" class="' + INP + '"><option>Full Count</option><option>Cycle Count</option></select></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Assigned To</label><input id="stAssign" class="' + INP + '" placeholder="Person performing the count" value="' + esc(who()) + '"></div>' +
      '</div>' +
      '<div><label class="block text-sm font-semibold mb-1">Notes</label><textarea id="stNotes" rows="2" class="' + INP + ' resize-y" placeholder="Additional information"></textarea></div>' +
      '<label class="flex items-center gap-2 text-sm"><input id="stBlind" type="checkbox"> Blind count <span class="text-xs text-gray-500">(hide system quantities from the counter until the count is submitted)</span></label>' +
      '<div class="text-right space-x-2 border-t pt-4"><button class="' + BTN + ' font-semibold" onclick="stCreate()">Save &amp; Load Items</button> <button class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600" onclick="stToggleForm(false)">Cancel</button></div></div>';
  }
  function wireForm() {
    var wh = $('stWh'); if (!wh) return;
    wh.onchange = function () {
      var cats = {}; invOf(wh.value).forEach(function (it) { var c = catOf(it); if (c) cats[c] = 1; });
      $('stCat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    };
  }
  w.stToggleForm = function (show) {
    if (!$('stForm')) { state = { view: 'register', id: null, t: null }; renderRegister(); }
    var f = $('stForm'); if (!f) return;
    var open = typeof show === 'boolean' ? show : f.classList.contains('hidden');
    if (open) { renderRegister(); f = $('stForm'); f.classList.remove('hidden'); wireForm(); f.scrollIntoView && f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else f.classList.add('hidden');
  };

  w.stCreate = function () {
    var date = $('stDate').value, wh = $('stWh').value, cat = $('stCat').value, method = $('stMethod').value;
    if (!date || !wh) return alert('Please choose the count date and the warehouse.');
    var open = takes().filter(function (t) { return t.warehouse === wh && t.status !== 'Posted' && (!t.category || !cat || t.category === cat); })[0];
    if (open) return alert('Stock take ' + open.no + ' for this warehouse' + (open.category ? ' / ' + open.category : '') + ' is still open (' + open.status + '). Post or delete it before starting another count of the same stock.');
    var seen = {}, lines = [];
    invOf(wh).forEach(function (it) {
      if (cat && catOf(it) !== cat) return;
      var key = low(it.sku || it.name); if (seen[key]) return; seen[key] = 1;           /* one line per item: no duplicate counting */
      lines.push({ key: key, name: it.name, sku: it.sku || '', barcode: it.barcode || '', category: catOf(it), warehouse: wh, systemQty: num(it.qty), unitCost: costOf(it), physicalQty: null, reason: '', remarks: '', countedBy: '', countedAt: '' });
    });
    if (!lines.length) return alert('No items were found in this warehouse' + (cat ? ' and category' : '') + ' to count.');
    var a = takes(), t = {
      id: 'STK' + Date.now(), no: nextNo(a, 'ST-', 'no', 3), date: date, warehouse: wh, category: cat, method: method, assignedTo: $('stAssign').value.trim(), notes: $('stNotes').value.trim(),
      blind: $('stBlind').checked, status: 'Draft', createdBy: who(), createdAt: new Date().toISOString(), countedBy: '', submittedBy: '', approvedBy: '', postedBy: '', lines: lines
    };
    a.push(t); setTakes(a);
    state = { view: 'sheet', id: t.id, t: null }; render();
  };
  w.stDelete = function (id) {
    var t = byId(id); if (!t) return;
    if (t.status !== 'Draft' && t.status !== 'Counting') return alert('Only a Draft or Counting stock take can be deleted.');
    if (!confirm('Delete stock take ' + t.no + '? Inventory is not affected.')) return;
    setTakes(takes().filter(function (x) { return x.id !== id; })); renderRegister();
  };
  w.stOpen = function (id) { state = { view: 'sheet', id: id, t: null }; render(); };
  w.stBack = function () { if (state.t) { clearTimeout(saveTimer); put(state.t); } state = { view: 'register', id: null, t: null }; render(); };

  /* ---------- working sheet ---------- */
  function cols(t) {
    var blind = blindNow(t);
    return [
      { h: 'Item Name' }, { h: 'SKU' }, { h: 'Category' }, { h: 'Warehouse' },
      { h: 'System Qty', r: 1, sys: 1 }, { h: 'Physical Qty', r: 1 }, { h: 'Variance', r: 1, sys: 1 }, { h: 'Unit Cost', r: 1, sys: 1 }, { h: 'Variance Value', r: 1, sys: 1 },
      { h: 'Reason for Variance' }, { h: 'Remarks' }
    ].filter(function (c) { return !(blind && c.sys); });
  }
  function totalsHtml(t) {
    var k = totals(t), blind = blindNow(t), c = 'bg-white rounded shadow p-3';
    var cell = function (l, v, cls) { return '<div class="' + c + '"><div class="text-xs text-gray-500">' + l + '</div><div class="text-lg font-bold ' + (cls || 'text-blue-900') + '">' + v + '</div></div>'; };
    var vcls = k.net < 0 ? 'text-red-600' : k.net > 0 ? 'text-green-700' : 'text-blue-900';
    return (blind ? cell('System Total', 'Hidden (blind count)', 'text-gray-400 text-sm') : cell('System Total', k.sys)) + cell('Physical Total', k.phys) +
      (blind ? cell('Net Variance', 'Hidden (blind count)', 'text-gray-400 text-sm') : cell('Net Variance', signed(k.net), vcls) + cell('Variance Value', money(k.val), vcls)) + cell('Counted', k.counted + ' of ' + k.total);
  }
  function rowHtml(t, l, i) {
    var k = calc(l), blind = blindNow(t), ed = editable(t), td = 'border p-1 align-middle', tdr = td + ' text-right';
    var vcls = k.v == null ? '' : k.v < 0 ? 'text-red-600 font-semibold' : k.v > 0 ? 'text-green-700 font-semibold' : 'text-gray-700';
    var reason = ed ? '<select class="border rounded p-1 text-sm w-full" data-f="reason" data-i="' + i + '"><option value="">' + (k.v ? 'Select reason' : '-') + '</option>' + REASONS.map(function (r) { return '<option' + (l.reason === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select>' : esc(l.reason || '');
    var remarks = ed ? '<input class="border rounded p-1 text-sm w-full" data-f="remarks" data-i="' + i + '" value="' + esc(l.remarks || '') + '">' : esc(l.remarks || '');
    var phys = ed ? '<input type="number" min="0" step="any" class="border rounded p-1 text-sm w-24 text-right" data-f="physicalQty" data-i="' + i + '" value="' + (k.counted ? esc(l.physicalQty) : '') + '">' : (k.counted ? esc(l.physicalQty) : '<span class="text-gray-400">not counted</span>');
    var cells = [
      '<td class="' + td + '">' + esc(l.name) + '</td>', '<td class="' + td + '">' + esc(l.sku) + '</td>', '<td class="' + td + '">' + esc(l.category) + '</td>', '<td class="' + td + '">' + esc(l.warehouse) + '</td>',
      blind ? '' : '<td class="' + tdr + '">' + esc(l.systemQty) + '</td>',
      '<td class="' + tdr + '">' + phys + '</td>',
      blind ? '' : '<td class="' + tdr + ' ' + vcls + '" id="stVar' + i + '">' + (k.v == null ? '' : signed(k.v)) + '</td>',
      blind ? '' : '<td class="' + tdr + '">' + money(num(l.unitCost)) + '</td>',
      blind ? '' : '<td class="' + tdr + ' ' + vcls + '" id="stVal' + i + '">' + (k.val == null ? '' : money(k.val)) + '</td>',
      '<td class="' + td + '">' + reason + '</td>', '<td class="' + td + '">' + remarks + '</td>'
    ].join('');
    var rm = (t.status === 'Draft' && t.method === 'Cycle Count') ? '<td class="' + td + ' text-center"><button class="text-red-600 text-xs" data-rm="' + i + '">Remove</button></td>' : '';
    return '<tr id="stRow' + i + '">' + cells + rm + '</tr>';
  }
  function actionsHtml(t) {
    var b = function (label, fn, cls) { return '<button class="' + (cls || BTN) + ' font-semibold" onclick="' + fn + '(\'' + esc(t.id) + '\')">' + label + '</button>'; };
    var out = [];
    if (t.status === 'Draft') out.push(b('Start Counting', 'stStart'));
    if (t.status === 'Counting') out.push(b('Submit for Review', 'stSubmit'));
    if (t.status === 'Submitted') { out.push(b('Approve', 'stApprove')); out.push(b('Send Back for Recount', 'stReject', BTN2)); }
    if (t.status === 'Approved') out.push(b('Post Adjustments', 'stPost'));
    out.push('<button class="' + BTN2 + '" onclick="stExport(\'' + esc(t.id) + '\')">Export (Excel)</button>');
    out.push('<button class="' + BTN2 + '" onclick="stPrint(\'' + esc(t.id) + '\')">Print Count Sheet</button>');
    return out.join(' ');
  }
  function flowHtml(t) {
    var steps = ['Draft', 'Counting', 'Submitted', 'Approved', 'Posted'], at = steps.indexOf(t.status);
    return '<div class="flex flex-wrap items-center gap-1 text-xs mb-3">' + steps.map(function (s, i) {
      return '<span class="px-2 py-0.5 rounded ' + (i === at ? 'bg-blue-900 text-white font-semibold' : i < at ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500') + '">' + (i < at ? '&#10003; ' : '') + s + '</span>' + (i < steps.length - 1 ? '<span class="text-gray-400">&rsaquo;</span>' : '');
    }).join('') + '</div>';
  }
  function renderSheet() {
    var root = $(TAB); if (!root) return;
    state.t = null; var t = byId(state.id); state.t = t || null;
    if (!t) { state = { view: 'register', id: null, t: null }; return renderRegister(); }
    var meta = function (l, v) { return v ? '<div><span class="text-gray-500">' + l + ':</span> ' + esc(v) + '</div>' : ''; };
    var hdrs = cols(t).map(function (c) { return '<th class="border p-2 text-' + (c.r ? 'right' : 'left') + ' whitespace-nowrap">' + c.h + '</th>'; }).join('') + (t.status === 'Draft' && t.method === 'Cycle Count' ? '<th class="border p-2"></th>' : '');
    root.innerHTML =
      '<div class="mb-2"><button class="text-sm text-blue-900 underline" onclick="stBack()">&larr; Back to Stock Take Register</button></div>' +
      '<div class="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3"><div><h2 class="text-sm font-bold">Stock Take: ' + esc(t.no) + ' <span class="ml-2 px-2 py-0.5 rounded text-xs ' + BADGE[t.status] + '">' + esc(t.status) + '</span></h2>' +
      '<div class="text-sm text-gray-700 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6">' + meta('Warehouse', t.warehouse) + meta('Date', fmtDate(t.date)) + meta('Method', t.method + (t.blind ? ' (blind)' : '')) + meta('Category', t.category) + meta('Assigned to', t.assignedTo) +
      meta('Counted by', t.countedBy) + meta('Submitted by', t.submittedBy) + meta('Approved by', t.approvedBy) + meta('Posted by', t.postedBy) + meta('Notes', t.notes) + '</div></div>' +
      '<div class="flex flex-wrap gap-2">' + actionsHtml(t) + '</div></div>' +
      flowHtml(t) +
      '<div id="stTotals" class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">' + totalsHtml(t) + '</div>' +
      (editable(t) ? '<div class="bg-white rounded shadow p-3 mb-3 flex flex-wrap items-center gap-2"><label class="text-sm font-semibold">Scan / enter barcode or SKU</label><input id="stScan" class="border rounded-md px-3 py-1.5 text-sm w-64" placeholder="Scan then press Enter" autocomplete="off"><span id="stMsg" class="text-xs text-gray-600"></span></div>'
        : (t.status === 'Draft' ? '<div class="text-xs text-gray-600 mb-3">Items are loaded. Click <b>Start Counting</b> to begin entering physical quantities.</div>' : '')) +
      '<div class="bg-white p-4 rounded shadow mb-6"><div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr>' + hdrs + '</tr></thead><tbody id="stBody">' +
      t.lines.map(function (l, i) { return rowHtml(t, l, i); }).join('') + '</tbody></table></div>' +
      (t.status === 'Posted' ? '<div class="text-xs text-gray-600 mt-2">Posted. Adjustments were added to Stock Activity under reference ' + esc(t.no) + '.</div>' : '') + '</div>';
    var sc = $('stScan'); if (sc) sc.focus();
  }
  function render() { if (state.view === 'sheet') renderSheet(); else renderRegister(); }

  /* ---------- editing the sheet (events on the whole page) ---------- */
  function persistSoon(t) { clearTimeout(saveTimer); saveTimer = setTimeout(function () { put(t); }, 250); }
  function onEdit(e) {
    var el = e.target; if (!el || !el.getAttribute) return; var f = el.getAttribute('data-f'); if (!f) return;
    var t = byId(state.id); if (!t || !editable(t)) return; var i = parseInt(el.getAttribute('data-i'), 10), l = t.lines[i]; if (!l) return;
    if (f === 'physicalQty') {
      if (el.value === '') { l.physicalQty = null; l.countedBy = ''; l.countedAt = ''; }
      else {
        var n = num(el.value); if (n < 0) { el.value = ''; return alert('Quantity cannot be negative.'); }
        l.physicalQty = n; l.countedBy = who(); l.countedAt = new Date().toISOString(); if (!t.countedBy) t.countedBy = who();
      }
      var k = calc(l), cls = k.v == null ? '' : k.v < 0 ? 'text-red-600 font-semibold' : k.v > 0 ? 'text-green-700 font-semibold' : 'text-gray-700';
      var v = $('stVar' + i), vv = $('stVal' + i), base = 'border p-1 align-middle text-right ';
      if (v) { v.textContent = k.v == null ? '' : signed(k.v); v.className = base + cls; }
      if (vv) { vv.textContent = k.val == null ? '' : money(k.val); vv.className = base + cls; }
      var tt = $('stTotals'); if (tt) tt.innerHTML = totalsHtml(t);
    } else if (f === 'reason' || f === 'remarks') l[f] = el.value;
    persistSoon(t);
  }
  document.addEventListener('input', function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute('data-f') === 'physicalQty') onEdit(e); });
  document.addEventListener('change', onEdit);
  document.addEventListener('click', function (e) {
    var rm = e.target && e.target.closest && e.target.closest('button[data-rm]');
    if (rm) { var t = byId(state.id); if (t && t.status === 'Draft') { var i = parseInt(rm.getAttribute('data-rm'), 10); if (confirm('Remove ' + t.lines[i].name + ' from this count?')) { t.lines.splice(i, 1); put(t); renderSheet(); } } return; }
    var nav = e.target && e.target.closest && e.target.closest('button[onclick*="' + TAB + '"]');
    if (nav) setTimeout(function () { state = { view: 'register', id: null, t: null }; render(); }, 0);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target || e.target.id !== 'stScan') return; e.preventDefault();
    var t = byId(state.id); if (!t || !editable(t)) return; var v = low(e.target.value); if (!v) return;
    var msg = $('stMsg'), idx = -1;
    t.lines.forEach(function (l, i) { if (idx < 0 && (low(l.sku) === v || low(l.barcode) === v || low(l.name) === v)) idx = i; });
    e.target.value = '';
    if (idx < 0) { if (msg) msg.innerHTML = '<span class="text-red-600">Not on this count sheet: ' + esc(v) + '</span>'; return; }
    var inp = document.querySelector('input[data-f="physicalQty"][data-i="' + idx + '"]'), row = $('stRow' + idx), l = t.lines[idx], k = calc(l);
    if (msg) msg.innerHTML = k.counted ? '<span class="text-yellow-700">' + esc(l.name) + ' is already counted (' + esc(l.physicalQty) + '). Change the quantity only if you are recounting.</span>' : esc(l.name);
    if (row) { row.style.background = '#fef9c3'; setTimeout(function () { row.style.background = ''; }, 1500); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    if (inp) { inp.focus(); inp.select(); }
  });
  /* Enter in a quantity box jumps to the next item's quantity box */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target || e.target.getAttribute('data-f') !== 'physicalQty') return; e.preventDefault();
    var n = document.querySelector('input[data-f="physicalQty"][data-i="' + (parseInt(e.target.getAttribute('data-i'), 10) + 1) + '"]');
    if (n) { n.focus(); n.select(); } else { var s = $('stScan'); if (s) s.focus(); }
  });

  /* ---------- workflow ---------- */
  function flush(t) { clearTimeout(saveTimer); put(t); }
  w.stStart = function (id) {
    var t = byId(id); if (!t || t.status !== 'Draft') return;
    t.status = 'Counting'; t.countStartedAt = new Date().toISOString(); put(t); renderSheet();
  };
  w.stSubmit = function (id) {
    var t = byId(id); if (!t || t.status !== 'Counting') return;
    var missing = t.lines.filter(function (l) { return !calc(l).counted; });
    if (missing.length) return alert(missing.length + ' item(s) are not counted yet (first: ' + missing[0].name + '). Enter a physical quantity for every item, or remove it from a cycle count before submitting.');
    var noReason = t.lines.filter(function (l) { var k = calc(l); return k.v !== 0 && !l.reason; });
    if (noReason.length) return alert('Please choose a reason for variance on ' + noReason.length + ' item(s) (first: ' + noReason[0].name + ').');
    if (!confirm('Submit stock take ' + t.no + ' for approval? Quantities can no longer be changed unless it is sent back.')) return;
    t.status = 'Submitted'; t.submittedBy = who(); t.submittedAt = new Date().toISOString(); if (!t.countedBy) t.countedBy = who(); put(t); renderSheet();
  };
  w.stReject = function (id) {
    var t = byId(id); if (!t || t.status !== 'Submitted') return;
    if (!canApprove()) return alert('Only an authorised person can send a count back.');
    if (!confirm('Send ' + t.no + ' back to Counting for a recount?')) return;
    t.status = 'Counting'; t.submittedBy = ''; put(t); renderSheet();
  };
  w.stApprove = function (id) {
    var t = byId(id); if (!t || t.status !== 'Submitted') return;
    if (!canApprove()) return alert('Only an authorised person (Admin or Accounts) can approve a stock take.');
    var k = totals(t);
    if (!confirm('Approve ' + t.no + '?\n' + k.diffLines + ' item(s) with variance, net ' + signed(k.net) + ' unit(s), value ' + money(k.val) + '.\nInventory will not change until you post the adjustments.')) return;
    t.status = 'Approved'; t.approvedBy = who(); t.approvedAt = new Date().toISOString(); put(t); renderSheet();
  };
  w.stPost = function (id) {
    var t = byId(id); if (!t || t.status !== 'Approved') return;
    if (!canApprove()) return alert('Only an authorised person (Admin or Accounts) can post adjustments.');
    var diff = t.lines.filter(function (l) { return calc(l).v !== 0; }), k = totals(t);
    if (!confirm('Post ' + t.no + '? ' + diff.length + ' adjustment(s) will change the balances in ' + t.warehouse + ' and appear in Stock Activity. This cannot be undone.')) return;
    var inv = w.getInventory(t.warehouse) || [], acts = rd('stockActivities'), now = today();
    diff.forEach(function (l, n) {
      var v = calc(l).v, hit = inv.filter(function (x) { return x && ((l.sku && x.sku && low(x.sku) === low(l.sku)) || low(x.name) === low(l.name)); })[0];
      if (!hit) { if (v < 0) return; hit = { name: l.name, sku: l.sku, category: l.category, qty: 0 }; inv.push(hit); }
      var before = num(hit.qty), after = Math.max(0, r4(before + v)), applied = r4(after - before);
      hit.qty = after; l.postedQty = applied;
      if (!applied) return;
      acts.push({ id: 'SA' + Date.now() + '_' + n, no: nextNo(acts, 'ACT-', 'no', 4), type: applied > 0 ? 'Adjustment (increase)' : 'Adjustment (decrease)', item: l.name, sku: l.sku || '', warehouse: t.warehouse,
        qin: applied > 0 ? applied : 0, qout: applied < 0 ? -applied : 0, date: now, reference: t.no, reason: 'Stock take' + (l.reason ? ': ' + l.reason : '') + (l.remarks ? ' - ' + l.remarks : ''), by: who() });
    });
    w.saveInventory(t.warehouse, inv); localStorage.setItem('stockActivities', JSON.stringify(acts));
    t.status = 'Posted'; t.postedBy = who(); t.postedAt = new Date().toISOString(); t.postedDate = now; put(t);
    ['renderInventoryTable', 'renderMovementTable', 'renderStockTransfer'].forEach(function (f) { try { if (typeof w[f] === 'function') w[f](); } catch (e) {} });
    alert('Posted. ' + diff.length + ' adjustment(s) were applied and sent to Stock Activity.'); renderSheet();
  };

  /* ---------- export / print (respects blind counting) ---------- */
  function sheetRows(t) {
    var blind = blindNow(t), head = cols(t).map(function (c) { return c.h; });
    var rows = t.lines.map(function (l) {
      var k = calc(l), r = [l.name, l.sku, l.category, l.warehouse];
      if (!blind) r.push(l.systemQty);
      r.push(k.counted ? l.physicalQty : '');
      if (!blind) r.push(k.v == null ? '' : k.v, num(l.unitCost), k.val == null ? '' : k.val);
      r.push(l.reason || '', l.remarks || ''); return r;
    });
    return [head].concat(rows);
  }
  w.stExport = function (id) {
    var t = byId(id); if (!t) return;
    var csv = sheetRows(t).map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = t.no + '-count-sheet.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  w.stPrint = function (id) {
    var t = byId(id); if (!t) return;
    var rows = sheetRows(t), pw = window.open('', '', 'width=1000,height=700'); if (!pw) return alert('Allow pop-ups to print.');
    var blank = blindNow(t) || t.status === 'Draft' || t.status === 'Counting';
    var tbl = '<table style="width:100%;border-collapse:collapse;font-size:12px">' + rows.map(function (r, ri) {
      return '<tr>' + r.map(function (v, ci) {
        var isPhys = rows[0][ci] === 'Physical Qty', empty = blank && ri > 0 && isPhys && v === '';
        return (ri === 0 ? '<th style="background:#1e3a8a;color:#fff;' : '<td style="') + 'border:1px solid #ccc;padding:6px;text-align:left;' + (empty ? 'min-width:70px;height:22px' : '') + '">' + esc(v) + (ri === 0 ? '</th>' : '</td>');
      }).join('') + '</tr>';
    }).join('') + '</table>';
    pw.document.write('<html><head><title>' + esc(t.no) + '</title></head><body style="font-family:Arial,sans-serif;padding:16px;color:#333"><h2 style="color:#1e3a8a;margin:0">Stock Take ' + esc(t.no) + '</h2>' +
      '<div style="margin:6px 0 12px;font-size:13px">Warehouse: ' + esc(t.warehouse) + ' &nbsp;|&nbsp; Date: ' + esc(fmtDate(t.date)) + ' &nbsp;|&nbsp; Method: ' + esc(t.method) + (t.assignedTo ? ' &nbsp;|&nbsp; Assigned to: ' + esc(t.assignedTo) : '') + '</div>' + tbl +
      '<div style="margin-top:30px;font-size:12px">Counted by: ________________ &nbsp;&nbsp; Approved by: ________________ &nbsp;&nbsp; Date: ____________</div></body></html>');
    pw.document.close(); pw.focus(); setTimeout(function () { pw.print(); }, 300);
  };

  /* ---------- mount ---------- */
  setTimeout(function () { var t = $(TAB); if (t && !t.classList.contains('hidden')) render(); }, 800);
})(window);
