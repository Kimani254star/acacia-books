/* Smarter notifications.
   - Stops logging "Opened: <menu>" / Quick Create open-close / refresh noise.
   - Adds real, detailed alerts: overdue invoices, bills due, low/out of stock, expired / expiring batches,
     plus new invoice / bill activity (e.g. created by another user).
   - NEW: change log - records what actually happened (created / paid / updated / deleted) for invoices, bills,
     quotes, orders, receipts, payments, credit/debit notes, POs, GRNs, returns, customers, suppliers, journals, users,
     with before -> after values, amounts, and who did it when the record stores that.
   - Richer panel: icon, title, detail lines, relative time, unread highlight, click-to-open, mark all read, clear. */
(function () {
  'use strict';
  if (window.__acxNotifPlus) return; window.__acxNotifPlus = true;

  var KEY = 'notifications', MAX = 200, LOW_QTY = 5, DUE_SOON_DAYS = 7, EXPIRY_DAYS = 30, MAX_LINES = 4;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (v) { var x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(x) ? 0 : x; };
  var arr = function (k) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  var jget = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  var jset = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var cid = function () { var u = jget('loggedInUser', null); return u && u.companyId ? String(u.companyId) : ''; };
  var fmt = function (cur, v) { return (cur || 'KES') + ' ' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var uid = function () { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  var NOISE = /Opened[: ]|Quick Create panel|Data refreshed successfully|Welcome! No new updates/i;

  /* ---------- storage ---------- */
  function load() {
    var l = arr(KEY), changed = false;
    l.forEach(function (n) {
      if (!n.id) { n.id = uid(); changed = true; }
      if (!n.ts) { var t = Date.parse(n.time); n.ts = isNaN(t) ? Date.now() : t; changed = true; }
      if (!n.title) { n.title = n.message || ''; changed = true; }
    });
    if (changed) jset(KEY, l);
    return l;
  }
  function save(l) { jset(KEY, l.slice(0, MAX)); }

  /* ---------- public API (keeps old calls working) ---------- */
  window.addNotification = function (msg, opts) {
    opts = opts || {};
    var title = String(msg == null ? '' : msg);
    if (!opts.force && NOISE.test(title)) return;
    var l = load();
    l.unshift({ id: uid(), message: title, title: title, lines: opts.lines || [], tab: opts.tab || '', type: opts.type || 'info', key: opts.key || '', ts: Date.now(), time: new Date().toLocaleString(), read: false });
    save(l); render();
  };

  /* ---------- scanning real data ---------- */
  function today0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function pd(s) {
    if (!s) return null; s = String(s).trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    var d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  var DAY = 86400000;
  function outstanding(d) {
    if (d.balance != null && d.balance !== '') return num(d.balance);
    return num(d.total) - num(d.amountPaid != null ? d.amountPaid : d.paidAmount);
  }
  function isOpen(d) {
    if (!d || d.paid === true) return false;
    return !/^\s*(paid|void|cancel|reject|draft|pending)/i.test(String(d.status || ''));
  }
  function more(lines, n) { if (lines.length > n) { var r = lines.length - n; lines = lines.slice(0, n); lines.push('+' + r + ' more'); } return lines; }

  function buildAlerts() {
    var out = {}, t0 = today0().getTime();

    /* overdue invoices */
    var over = [];
    arr('invoices').forEach(function (i) {
      if (!isOpen(i)) return;
      var due = pd(i.dueDate); if (!due) return;
      var days = Math.floor((t0 - due.getTime()) / DAY), o = outstanding(i);
      if (days > 0 && o > 0.005) over.push({ days: days, line: (i.invoiceNumber || 'Invoice') + ' \u00B7 ' + (i.customer || '-') + ' \u00B7 ' + fmt(i.currency, o) + ' \u00B7 ' + days + 'd overdue' });
    });
    if (over.length) {
      over.sort(function (a, b) { return b.days - a.days; });
      out['inv-overdue'] = { type: 'overdue', tab: 'invoicesTab', title: over.length + ' overdue invoice' + (over.length > 1 ? 's' : ''), full: over.map(function (x) { return x.line; }).slice(0, 60), lines: more(over.map(function (x) { return x.line; }), MAX_LINES) };
    }

    /* bills overdue / due soon */
    var bo = [], bs = [];
    arr('bills').forEach(function (b) {
      if (!isOpen(b)) return;
      var due = pd(b.dueDate); if (!due) return;
      var diff = Math.round((due.getTime() - t0) / DAY), o = outstanding(b);
      if (o <= 0.005) return;
      var base = (b.billNumber || 'Bill') + ' \u00B7 ' + (b.supplier || '-') + ' \u00B7 ' + fmt(b.currency, o);
      if (diff < 0) bo.push({ k: diff, line: base + ' \u00B7 ' + (-diff) + 'd overdue' });
      else if (diff <= DUE_SOON_DAYS) bs.push({ k: diff, line: base + ' \u00B7 ' + (diff === 0 ? 'due today' : 'due in ' + diff + 'd') });
    });
    if (bo.length) { bo.sort(function (a, b) { return a.k - b.k; }); out['bill-overdue'] = { type: 'bill', tab: 'supplierBillsTab', title: bo.length + ' overdue bill' + (bo.length > 1 ? 's' : '') + ' to pay', full: bo.map(function (x) { return x.line; }).slice(0, 60), lines: more(bo.map(function (x) { return x.line; }), MAX_LINES) }; }
    if (bs.length) { bs.sort(function (a, b) { return a.k - b.k; }); out['bill-soon'] = { type: 'bill', tab: 'supplierBillsTab', title: bs.length + ' bill' + (bs.length > 1 ? 's' : '') + ' due within ' + DUE_SOON_DAYS + ' days', full: bs.map(function (x) { return x.line; }).slice(0, 60), lines: more(bs.map(function (x) { return x.line; }), MAX_LINES) }; }

    /* stock + batches */
    var low = [], outc = 0, exp = [], soon = [];
    var whs = []; try { if (typeof window.__invWarehouseNames === 'function') whs = window.__invWarehouseNames() || []; } catch (e) {}
    whs.forEach(function (w) {
      var items = []; try { items = typeof window.getInventory === 'function' ? window.getInventory(w) : []; } catch (e) {}
      (items || []).forEach(function (it) {
        if (!it || it.active === false) return;
        var q = num(it.qty), nm = it.name || it.sku || '-';
        if (q < LOW_QTY) { if (q <= 0) outc++; low.push({ q: q, line: nm + ' \u2014 ' + (q <= 0 ? 'out of stock' : q + ' left') + ' (' + w + ')' }); }
        (it.batches || []).forEach(function (b) {
          var e = pd(b.expiryDate); if (!e || num(b.qty) <= 0) return;
          var d = Math.round((e.getTime() - t0) / DAY);
          var ln = nm + (b.batchNo ? ' \u00B7 batch ' + b.batchNo : '') + ' \u00B7 ' + num(b.qty) + ' units';
          if (d < 0) exp.push({ k: d, line: ln + ' \u00B7 expired ' + (-d) + 'd ago' });
          else if (d <= EXPIRY_DAYS) soon.push({ k: d, line: ln + ' \u00B7 expires in ' + d + 'd' });
        });
      });
    });
    if (low.length) { low.sort(function (a, b) { return a.q - b.q; }); out['stock'] = { type: 'stock', tab: 'inventoryTab', title: low.length + ' item' + (low.length > 1 ? 's' : '') + ' low on stock' + (outc ? ' (' + outc + ' out)' : ''), full: low.map(function (x) { return x.line; }).slice(0, 60), lines: more(low.map(function (x) { return x.line; }), MAX_LINES) }; }
    if (exp.length) { exp.sort(function (a, b) { return a.k - b.k; }); out['batch-expired'] = { type: 'expiry', tab: 'inventoryTab', title: exp.length + ' expired batch' + (exp.length > 1 ? 'es' : '') + ' still in stock', full: exp.map(function (x) { return x.line; }).slice(0, 60), lines: more(exp.map(function (x) { return x.line; }), MAX_LINES) }; }
    if (soon.length) { soon.sort(function (a, b) { return a.k - b.k; }); out['batch-soon'] = { type: 'expiry', tab: 'inventoryTab', title: soon.length + ' batch' + (soon.length > 1 ? 'es' : '') + ' expiring within ' + EXPIRY_DAYS + ' days', full: soon.map(function (x) { return x.line; }).slice(0, 60), lines: more(soon.map(function (x) { return x.line; }), MAX_LINES) }; }
    return out;
  }

  function sync(alerts) {
    var l = load(), c = cid(), dkey = '__notifDismiss_' + c, dismissed = jget(dkey, {}), changed = false;
    var seen = {};
    Object.keys(alerts).forEach(function (k) {
      var a = alerts[k], sig = JSON.stringify([a.title, a.full || a.lines]);
      if (dismissed[k] === sig) { seen[k] = 1; return; }
      var ex = null; for (var i = 0; i < l.length; i++) if (l[i].key === k) { ex = l[i]; break; }
      seen[k] = 1;
      if (!ex) { l.unshift({ id: uid(), message: a.title, title: a.title, lines: a.lines, full: a.full, tab: a.tab, type: a.type, key: k, sig: sig, ts: Date.now(), time: new Date().toLocaleString(), read: false }); changed = true; }
      else if (ex.sig !== sig) { ex.title = ex.message = a.title; ex.lines = a.lines; ex.full = a.full; ex.sig = sig; ex.ts = Date.now(); ex.time = new Date().toLocaleString(); ex.read = false; changed = true; }
    });
    /* resolved alerts disappear; forget their dismissal too */
    var keep = l.filter(function (n) { return !n.key || n.type === 'new' || seen[n.key]; });
    if (keep.length !== l.length) { l = keep; changed = true; }
    Object.keys(dismissed).forEach(function (k) { if (!alerts[k]) { delete dismissed[k]; } });
    jset(dkey, dismissed);
    if (changed) save(l);
  }

  /* new invoices / bills (created by anyone, e.g. another user in the same company) */
  function activity() {
    var c = cid(); if (!c) return;
    var sk = '__notifSeen_' + c, seen = jget(sk, null), first = !seen; seen = seen || { inv: [], bill: [] };
    var sets = { inv: {}, bill: {} };
    seen.inv.forEach(function (x) { sets.inv[x] = 1; }); seen.bill.forEach(function (x) { sets.bill[x] = 1; });
    var defs = [
      { k: 'inv', rows: arr('invoices'), noun: 'invoice', tab: 'invoicesTab', num: 'invoiceNumber', who: 'customer' },
      { k: 'bill', rows: arr('bills'), noun: 'bill', tab: 'supplierBillsTab', num: 'billNumber', who: 'supplier' }
    ];
    var made = [];
    defs.forEach(function (d) {
      var fresh = [];
      d.rows.forEach(function (r) {
        var id = String(r.id != null ? r.id : r[d.num]); if (!id || id === 'undefined') return;
        if (!sets[d.k][id]) { sets[d.k][id] = 1; if (!first && !/^\s*draft/i.test(String(r.status || ''))) fresh.push(r); }
      });
      if (fresh.length === 1 || (fresh.length && fresh.length <= 3)) {
        fresh.forEach(function (r) {
          var due = pd(r.dueDate);
          made.push({ title: 'New ' + d.noun + ' ' + (r[d.num] || ''), type: 'new', tab: d.tab, lines: [(r[d.who] || '-') + ' \u00B7 ' + fmt(r.currency, num(r.total)), due ? 'Due ' + due.toLocaleDateString() : ''].filter(Boolean) });
        });
      } else if (fresh.length > 3) {
        made.push({ title: fresh.length + ' new ' + d.noun + 's', type: 'new', tab: d.tab, full: fresh.map(function (r) { return (r[d.num] || '') + ' \u00B7 ' + (r[d.who] || '-') + ' \u00B7 ' + fmt(r.currency, num(r.total)); }).slice(0, 60), lines: more(fresh.map(function (r) { return (r[d.num] || '') + ' \u00B7 ' + (r[d.who] || '-') + ' \u00B7 ' + fmt(r.currency, num(r.total)); }), MAX_LINES) });
      }
    });
    jset(sk, { inv: Object.keys(sets.inv), bill: Object.keys(sets.bill) });
    if (made.length) {
      var l = load();
      made.reverse().forEach(function (m) { l.unshift({ id: uid(), message: m.title, title: m.title, lines: m.lines, tab: m.tab, type: m.type, key: '', ts: Date.now(), time: new Date().toLocaleString(), read: false }); });
      save(l);
    }
  }


  /* ---------- change log: what actually happened ---------- */
  var WATCH = [
    { k: 'invoices', noun: 'Invoice', tab: 'invoicesTab', nums: ['invoiceNumber', 'number', 'id'], who: ['customer', 'customerName'], amt: ['total', 'amount'] },
    { k: 'bills', noun: 'Bill', tab: 'supplierBillsTab', nums: ['billNumber', 'number', 'id'], who: ['supplier', 'supplierName'], amt: ['total', 'amount'] },
    { k: 'quotes', noun: 'Quote', tab: 'quotesTab', nums: ['quoteNumber', 'number', 'id'], who: ['customer', 'customerName'], amt: ['total', 'amount'] },
    { k: 'orders', noun: 'Sales order', tab: 'ordersTab', nums: ['orderNumber', 'number', 'id'], who: ['customer', 'customerName'], amt: ['total', 'amount'] },
    { k: 'receipts', noun: 'Receipt', tab: 'receiptsTab', nums: ['receiptNumber', 'number', 'id'], who: ['customer', 'customerName'], amt: ['amount', 'total'] },
    { k: 'billPayments', noun: 'Bill payment', tab: 'supplierPaymentsTab', nums: ['reference', 'id'], who: ['supplier', 'supplierName'], amt: ['amount', 'total'] },
    { k: 'creditNotes', noun: 'Credit note', tab: 'creditNoteTab', nums: ['number', 'creditNoteNumber', 'id'], who: ['customer', 'customerName'], amt: ['total', 'amount'] },
    { k: 'supplierDebitNotes', noun: 'Debit note', tab: 'supplierDebitNotesTab', nums: ['number', 'debitNoteNumber', 'id'], who: ['supplier', 'supplierName'], amt: ['total', 'amount'] },
    { k: 'purchaseOrders', noun: 'Purchase order', tab: 'supplierPurchaseOrdersTab', nums: ['poNumber', 'number', 'id'], who: ['supplier', 'supplierName'], amt: ['total', 'amount'] },
    { k: 'grns', noun: 'GRN', tab: 'grnTab', nums: ['grnNumber', 'number', 'id'], who: ['supplier', 'supplierName'], amt: ['total', 'amount'] },
    { k: 'salesReturns', noun: 'Sales return', tab: 'salesReturnTab', nums: ['returnNumber', 'number', 'id'], who: ['customer', 'customerName'], amt: ['total', 'amount'] },
    { k: 'purchaseReturns', noun: 'Purchase return', tab: 'purchaseReturnsTab', nums: ['returnNumber', 'number', 'id'], who: ['supplier', 'supplierName'], amt: ['total', 'amount'] },
    { k: 'deliveries', noun: 'Delivery', tab: 'deliveryTab', nums: ['deliveryNumber', 'number', 'id'], who: ['customer', 'customerName'], amt: ['total', 'amount'] },
    { k: 'manualJournals', noun: 'Journal', tab: 'manualJournalsTab', nums: ['journalNo', 'journalNumber', 'number', 'reference', 'id'], who: ['description', 'narration', 'notes'], amt: ['total', 'amount', 'debit'] },
    { k: 'customers', noun: 'Customer', tab: 'customersTab', nums: ['name', 'id'], who: [], amt: [], lite: true },
    { k: 'suppliers', noun: 'Supplier', tab: 'supplierTab', nums: ['name', 'id'], who: [], amt: [], lite: true },
    { k: 'users', noun: 'User', tab: 'userManagementTab', nums: ['username', 'name', 'id'], who: ['role'], amt: [], lite: true }
  ];
  var ACTOR = ['updatedBy', 'modifiedBy', 'editedBy', 'createdBy', 'user', 'username', 'preparedBy', 'salesperson'];
  var pick = function (r, fs) { for (var i = 0; i < fs.length; i++) { var v = r[fs[i]]; if (v != null && v !== '' && typeof v !== 'object') return v; } return ''; };
  var isDraft = function (s) { return /^\s*draft/i.test(String(s || '')); };
  var isPaid = function (s) { return /^\s*paid/i.test(String(s || '')); };
  function idOf(r, w) { var v = (r.id != null && r.id !== '') ? r.id : pick(r, w.nums); return v === '' ? null : String(v); }
  /* signature: [number, party, amount, status, balance, due, actor, currency] */
  function sigOf(r, w) {
    var st = pick(r, ['status', 'packageStatus']); if (!st && r.paid === true) st = 'Paid';
    var bal = (r.balance != null && r.balance !== '') ? num(r.balance) : null;
    return [String(pick(r, w.nums)), String(pick(r, w.who)), num(pick(r, w.amt)), String(st), bal, String(r.dueDate || ''), String(pick(r, ACTOR)), String(r.currency || '')];
  }
  var head = function (w, s) { return w.noun + (s[0] ? ' ' + s[0] : ''); };
  var low = function (w) { return w.noun.charAt(0).toLowerCase() + w.noun.slice(1); };
  function body(w, s) {
    var l = [], who = s[1], a = s[2] ? fmt(s[7], s[2]) : '';
    if (who || a) l.push((who || '-') + (a ? ' \u00B7 ' + a : ''));
    var d = pd(s[5]); if (d) l.push('Due ' + d.toLocaleDateString());
    if (s[3]) l.push('Status: ' + s[3]);
    if (s[6]) l.push('By ' + s[6]);
    return l;
  }
  function delta(w, o, n) {
    var L = [], h = head(w, n);
    if (o[2] !== n[2]) L.push('Amount: ' + fmt(n[7], o[2]) + ' \u2192 ' + fmt(n[7], n[2]));
    if (o[3] !== n[3]) L.push('Status: ' + (o[3] || '-') + ' \u2192 ' + (n[3] || '-'));
    if (o[4] != null && n[4] != null && o[4] !== n[4]) L.push('Balance: ' + fmt(n[7], o[4]) + ' \u2192 ' + fmt(n[7], n[4]));
    if (o[1] !== n[1] && !w.lite) L.push('Name/Details: ' + (o[1] || '-') + ' \u2192 ' + (n[1] || '-'));
    if (o[5] !== n[5]) L.push('Due date: ' + (o[5] || '-') + ' \u2192 ' + (n[5] || '-'));
    if (o[0] !== n[0] && o[0]) L.push('Number: ' + o[0] + ' \u2192 ' + n[0]);
    if (!L.length) return null;
    var r = { tab: w.tab, type: 'edit' }, who = n[1] ? [n[1] + (n[2] ? ' \u00B7 ' + fmt(n[7], n[2]) : '')] : [];
    if (isDraft(o[3]) && !isDraft(n[3])) { r.title = 'New ' + low(w) + ' ' + n[0]; r.type = 'new'; r.lines = body(w, n); return r; }
    var cleared = o[4] != null && n[4] != null && o[4] > 0.005 && n[4] <= 0.005;
    if ((isPaid(n[3]) && !isPaid(o[3])) || cleared) { r.title = h + ' paid in full'; r.type = 'paid'; }
    else if (o[4] != null && n[4] != null && n[4] < o[4]) { r.title = 'Payment of ' + fmt(n[7], o[4] - n[4]) + ' on ' + h; r.type = 'paid'; }
    else if (o[3] !== n[3] && n[3]) r.title = h + ' \u2192 ' + n[3];
    else r.title = h + ' updated';
    if (n[6]) L.push('By ' + n[6]);
    r.lines = who.concat(L);
    return r;
  }

  var fps = {}, snap = null, snapCid = '';
  function fpOf(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ':' + h; }

  function changes() {
    var c = cid(); if (!c) return 0;
    var sk = '__notifSnap_' + c;
    if (snapCid !== c) { snap = jget(sk, null); snapCid = c; fps = {}; }
    var first = !snap; if (first) snap = {};
    var made = [], dirty = false;

    WATCH.forEach(function (w) {
      var raw = null; try { raw = localStorage.getItem(w.k); } catch (e) {}
      if (raw == null) return;
      var f = fpOf(raw); if (fps[w.k] === f) return; fps[w.k] = f;
      var data; try { data = JSON.parse(raw); } catch (e) { return; }
      if (!Array.isArray(data)) return;
      var old = snap[w.k], nm = {};
      data.forEach(function (r) { if (!r || typeof r !== 'object') return; var id = idOf(r, w); if (id != null) nm[id] = sigOf(r, w); });
      snap[w.k] = nm; dirty = true;
      if (first || !old) return; /* first time seen = silent baseline */

      var add = [], del = [], chg = [];
      Object.keys(nm).forEach(function (id) {
        if (!old[id]) { if (!isDraft(nm[id][3])) add.push(nm[id]); }
        else if (!w.lite) { var d = delta(w, old[id], nm[id]); if (d) chg.push(d); }
      });
      Object.keys(old).forEach(function (id) { if (!nm[id] && !isDraft(old[id][3])) del.push(old[id]); });

      var one = function (s) { return head(w, s) + (s[1] ? ' \u00B7 ' + s[1] : '') + (s[2] ? ' \u00B7 ' + fmt(s[7], s[2]) : ''); };
      if (add.length > 3) { var fl = add.map(one); made.push({ title: add.length + ' new ' + low(w) + 's', type: 'new', tab: w.tab, lines: more(fl.slice(), MAX_LINES), full: fl.slice(0, 60) }); }
      else add.forEach(function (s) { made.push({ title: 'New ' + low(w) + ' ' + s[0], type: 'new', tab: w.tab, lines: body(w, s) }); });
      if (chg.length > 3) {
        var cl = chg.map(function (x) { return x.title + (x.lines[1] ? ' \u2014 ' + x.lines[1] : ''); });
        made.push({ title: chg.length + ' ' + low(w) + 's updated', type: 'edit', tab: w.tab, lines: more(cl.slice(), MAX_LINES), full: cl.slice(0, 60) });
      } else chg.forEach(function (x) { made.push(x); });
      if (del.length > 3) { var dl = del.map(one); made.push({ title: del.length + ' ' + low(w) + 's deleted', type: 'del', tab: w.tab, lines: more(dl.slice(), MAX_LINES), full: dl.slice(0, 60) }); }
      else del.forEach(function (s) { made.push({ title: head(w, s) + ' deleted', type: 'del', tab: w.tab, lines: body(w, s) }); });
    });

    if (dirty) jset(sk, snap);
    if (made.length) {
      var l = load();
      made.reverse().forEach(function (m) { l.unshift({ id: uid(), message: m.title, title: m.title, lines: m.lines, full: m.full, tab: m.tab, type: m.type, key: '', ts: Date.now(), time: new Date().toLocaleString(), read: false }); });
      save(l); render();
    }
    return made.length;
  }

  var lastScan = 0;
  function scan(force) {
    try {
      if (!cid()) return;
      if (!force && Date.now() - lastScan < 60000) return;
      lastScan = Date.now();
      sync(buildAlerts()); changes(); render();
    } catch (e) { console.warn('[notifications-plus]', e); }
  }

  /* ---------- UI ---------- */
  var ICON = { overdue: ['\u23F0', '#fee2e2', '#b91c1c'], bill: ['\uD83D\uDCB3', '#ffedd5', '#c2410c'], stock: ['\uD83D\uDCE6', '#fef3c7', '#b45309'], expiry: ['\u231B', '#ede9fe', '#6d28d9'], new: ['\uD83E\uDDFE', '#dbeafe', '#1d4ed8'], paid: ['\u2705', '#dcfce7', '#15803d'], edit: ['\u270F\uFE0F', '#e0f2fe', '#0369a1'], del: ['\uD83D\uDDD1\uFE0F', '#fee2e2', '#b91c1c'], info: ['\uD83D\uDD14', '#f3f4f6', '#4b5563'] };
  var filter = 'all', fresh = {}, opened = {};

  function rel(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now'; var m = Math.round(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60); if (h < 24) return h + 'h ago'; var d = Math.round(h / 24); if (d < 7) return d + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function chrome() {
    var p = $('notifPopup'); if (!p || p.__plus) return; p.__plus = true;
    p.style.width = '390px'; p.style.maxWidth = '94vw'; p.style.height = '72vh';
    var head = p.firstElementChild; if (!head) return;
    var h3 = head.querySelector('h3'); if (h3) h3.textContent = '\uD83D\uDD14 Notifications';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #f1f1f1;font-size:12px;flex:none';
    bar.innerHTML =
      '<button data-f="all" class="acx-np-pill">All</button><button data-f="unread" class="acx-np-pill">Unread</button><span style="flex:1"></span>' +
      '<button data-a="read" class="acx-np-link">Mark all read</button><button data-a="clear" class="acx-np-link" style="color:#dc2626">Clear all</button>';
    head.insertAdjacentElement('afterend', bar);
    var st = document.createElement('style');
    st.textContent = '.acx-np-pill{border:1px solid #d1d5db;border-radius:999px;padding:1px 10px;background:#fff;color:#374151;cursor:pointer}.acx-np-pill.on{background:#1e3a8a;color:#fff;border-color:#1e3a8a}.acx-np-link{background:none;border:0;color:#2563eb;cursor:pointer;padding:0 2px}.acx-np-link:hover{text-decoration:underline}' +
      '.acx-np-item{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid #f1f1f1;cursor:pointer;position:relative}.acx-np-item:hover{background:#f8fafc}.acx-np-item.fresh{background:#eff6ff;box-shadow:inset 3px 0 0 #2563eb}' +
      '.acx-np-ic{width:34px;height:34px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;font-size:16px}.acx-np-x{position:absolute;right:8px;top:6px;border:0;background:none;color:#9ca3af;cursor:pointer;display:none;font-size:12px}.acx-np-item:hover .acx-np-x{display:block}';
    document.head.appendChild(st);
    bar.addEventListener('click', function (e) {
      var f = e.target.closest('[data-f]'), a = e.target.closest('[data-a]');
      if (f) { filter = f.getAttribute('data-f'); render(); }
      if (a && a.getAttribute('data-a') === 'read') { markAllRead(); fresh = {}; render(); }
      if (a && a.getAttribute('data-a') === 'clear') { if (confirm('Clear all notifications?')) clearAll(); }
    });
    var ul = $('notifList');
    if (ul) ul.addEventListener('click', function (e) {
      var li = e.target.closest('.acx-np-item'); if (!li) return;
      var id = li.getAttribute('data-id');
      if (e.target.closest('.acx-np-x')) { dismiss(id); return; }
      var n = load().filter(function (x) { return x.id === id; })[0];
      if (!n) return;
      if (e.target.closest('[data-go]')) {
        if (n.tab && typeof window.showTab === 'function') { p.classList.add('hidden'); try { window.showTab(n.tab); } catch (x) {} }
        return;
      }
      opened[id] = !opened[id]; render();
    });
  }

  function render() {
    var ul = $('notifList'), cnt = $('notifCount'); if (!ul || !cnt) return;
    chrome();
    var list = load(), unread = list.filter(function (n) { return !n.read; }).length;
    cnt.textContent = unread > 99 ? '99+' : unread; cnt.classList.toggle('hidden', unread === 0);
    document.querySelectorAll('.acx-np-pill').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === filter); });
    var shown = list.filter(function (n) { return filter === 'all' || !n.read || fresh[n.id]; });
    if (!shown.length) {
      ul.innerHTML = '<li style="padding:40px 16px;text-align:center;color:#6b7280;font-size:13px"><div style="font-size:30px">\u2705</div>' + (filter === 'unread' ? 'No unread notifications' : "You're all caught up") + '<div style="font-size:12px;margin-top:4px">Overdue invoices, bills due, low stock and expiring items will show here.</div></li>';
      return;
    }
    ul.innerHTML = shown.map(function (n) {
      var ic = ICON[n.type] || ICON.info;
      var shownLines = (opened[n.id] && n.full && n.full.length) ? n.full : (n.lines || []);
      var lines = shownLines.map(function (x) { return '<div style="font-size:12px;color:#4b5563;margin-top:2px;line-height:1.35">' + esc(x) + '</div>'; }).join('');
      return '<li class="acx-np-item' + (fresh[n.id] || !n.read ? ' fresh' : '') + '" data-id="' + esc(n.id) + '" title="' + esc(n.time || '') + '">' +
        '<div class="acx-np-ic" style="background:' + ic[1] + ';color:' + ic[2] + '">' + ic[0] + '</div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#111827;padding-right:16px">' + esc(n.title || n.message) + '</div>' + lines +
        '<div style="font-size:11px;color:#9ca3af;margin-top:4px">' + rel(n.ts) + ((n.full && n.full.length > (n.lines || []).length) ? ' \u00B7 <span style="color:#6b7280">' + (opened[n.id] ? 'Show less \u25B4' : 'Show all \u25BE') + '</span>' : '') + (n.tab ? ' \u00B7 <span data-go="1" style="color:#2563eb">View \u203A</span>' : '') + '</div></div>' +
        '<button class="acx-np-x" title="Dismiss">\u2715</button></li>';
    }).join('');
  }
  window.renderNotifications = function () { render(); };
  window.__acxNotifChanges = changes;

  function markAllRead() { var l = load(); l.forEach(function (n) { n.read = true; }); save(l); }
  function dismiss(id) {
    var l = load(), n = l.filter(function (x) { return x.id === id; })[0]; if (!n) return;
    if (n.key) { var k = '__notifDismiss_' + cid(), d = jget(k, {}); d[n.key] = n.sig || JSON.stringify([n.title, n.lines]); jset(k, d); }
    save(l.filter(function (x) { return x.id !== id; })); render();
  }
  function clearAll() {
    var l = load(), k = '__notifDismiss_' + cid(), d = jget(k, {});
    l.forEach(function (n) { if (n.key) d[n.key] = n.sig || JSON.stringify([n.title, n.lines]); });
    jset(k, d); save([]); fresh = {}; render();
  }

  window.toggleNotifications = function () {
    var p = $('notifPopup'); if (!p) return;
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) {
      scan(false); changes();
      fresh = {}; load().forEach(function (n) { if (!n.read) fresh[n.id] = 1; });
      markAllRead(); render();
    }
  };
  if (typeof window.toggleNotifPopup !== 'function') window.toggleNotifPopup = function () { var p = $('notifPopup'); if (p) p.classList.add('hidden'); };

  /* ---------- boot ---------- */
  function purge() {
    var l = load(), k = l.filter(function (n) { return !NOISE.test(String(n.title || n.message || '')); });
    if (k.length !== l.length) save(k);
  }
  function boot() {
    purge(); render();
    setTimeout(function () { scan(true); }, 2500);
    setInterval(function () { scan(true); }, 10 * 60 * 1000);
    setTimeout(function () { changes(); }, 3000);
    setInterval(function () { if (!document.hidden) { try { changes(); } catch (e) {} } }, 8000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); }); else boot();
})();
