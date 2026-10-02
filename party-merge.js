/* Merge button for Customers and Suppliers.
   Duplicates = same name OR same KRA PIN, AND same currency.
   Same name/PIN but different currency are NEVER merged. */
(function () {
  'use strict';
  var norm = function (s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); };
  var pinKey = function (s) {
    var p = String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
    return (p.length < 5 || ['N/A', 'NONE', 'NULL', '-', '--'].indexOf(p) > -1) ? '' : p;
  };
  var cur = function (r) { return String(r.currency || 'KES').trim().toUpperCase(); };
  var empty = function (v) { return v === '' || v == null; };
  var num = function (v) { return parseFloat(v) || 0; };
  var note = function (m, t) { return typeof showNotification === 'function' ? showNotification(m, t) : alert(m); };
  var read = function (k) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

  var CFG = {
    customers: { key: 'customers', pin: 'kraPin', label: 'customer', perm: 'customersTab', amount: 'receivables', limit: 'creditLimit',
      nameFields: ['customer', 'customerName'], idFields: ['customerId'], render: 'renderCustomers',
      docs: ['invoices', 'quotes', 'orders', 'receipts', 'creditNotes', 'salesReturns', 'deliveries', 'recurringInvoices', 'bulkInvoices', 'customerPayments', 'creditNoteApplications', 'invoiceDrafts', 'creditNoteDrafts', 'salesReturnDrafts', 'deliveryDrafts', 'bulkInvoiceDrafts'] },
    suppliers: { key: 'suppliers', pin: 'krapin', label: 'supplier', perm: 'supplierTab', amount: 'balance', limit: 'debitLimit',
      nameFields: ['supplier', 'supplierName'], idFields: ['supplierId'], render: 'renderSuppliers',
      docs: ['bills', 'billPayments', 'bulkBills', 'purchaseOrders', 'grns', 'supplierDebitNotes', 'purchaseReturns', 'supplierQuotes', 'supplierDrafts', 'billWriteOffs', 'debitNoteApplications', 'purchaseReturnDrafts', 'recurringPayments'] }
  };

  /* Buttons only show while the matching Bulk Delete exists in the page; they are added in index.html */

  function selectedIndexes(kind, list) {
    if (kind === 'customers') {
      var ids = Array.from(document.querySelectorAll('.customerCheck:checked')).map(function (c) { return c.dataset.id; });
      if (!ids.length) return null;
      var out = new Set();
      list.forEach(function (c, i) { if (ids.indexOf(c.id) > -1) out.add(i); });
      return out;
    }
    var sel = Array.from(document.querySelectorAll('.supplier-checkbox:checked')).map(function (c) { return parseInt(c.value); });
    return sel.length ? new Set(sel) : null;
  }

  /* Cluster indexes: linked when same name OR same PIN */
  function cluster(list, idxs, c) {
    var parent = {};
    var find = function (x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    var union = function (a, b) { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    var byName = {}, byPin = {};
    idxs.forEach(function (i) {
      parent[i] = i;
      var n = norm(list[i].name), p = pinKey(list[i][c.pin]);
      if (n) { if (byName[n] != null) union(i, byName[n]); else byName[n] = i; }
      if (p) { if (byPin[p] != null) union(i, byPin[p]); else byPin[p] = i; }
    });
    var g = {};
    idxs.forEach(function (i) { (g[find(i)] = g[find(i)] || []).push(i); });
    return Object.keys(g).map(function (k) { return g[k].sort(function (a, b) { return a - b; }); });
  }

  function mergeRecs(recs, c) {
    var base = Object.assign({}, recs[0]);
    var amount = 0, limit = 0;
    recs.forEach(function (r, i) {
      amount += num(r[c.amount]); limit = Math.max(limit, num(r[c.limit]));
      if (i === 0) return;
      Object.keys(r).forEach(function (k) { if (empty(base[k]) && !empty(r[k])) base[k] = r[k]; });
      if (empty(base.secondaryEmail) && r.primaryEmail && norm(r.primaryEmail) !== norm(base.primaryEmail)) base.secondaryEmail = r.primaryEmail;
    });
    base[c.amount] = amount;
    if (limit > 0) base[c.limit] = String(limit);
    return base;
  }

  function remapDocs(c, nameMap, idMap) {
    var changed = 0;
    c.docs.forEach(function (k) {
      var raw = localStorage.getItem(k); if (!raw) return;
      var arr; try { arr = JSON.parse(raw); } catch (e) { return; }
      if (!Array.isArray(arr)) return;
      var dirty = false;
      arr.forEach(function (d) {
        if (!d || typeof d !== 'object') return;
        c.nameFields.forEach(function (f) {
          if (typeof d[f] === 'string' && nameMap[norm(d[f])] != null && d[f] !== nameMap[norm(d[f])]) { d[f] = nameMap[norm(d[f])]; dirty = true; changed++; }
        });
        c.idFields.forEach(function (f) {
          if (d[f] != null && idMap[String(d[f])] != null) { d[f] = idMap[String(d[f])]; dirty = true; changed++; }
        });
      });
      if (dirty) localStorage.setItem(k, JSON.stringify(arr));
    });
    return changed;
  }

  function run(kind) {
    var c = CFG[kind];
    var list = read(c.key);
    var sel = selectedIndexes(kind, list);
    var scope = [];
    list.forEach(function (r, i) { if (r && (!sel || sel.has(i))) scope.push(i); });

    /* split by currency first: different currency => never merged */
    var byCur = {};
    scope.forEach(function (i) { (byCur[cur(list[i])] = byCur[cur(list[i])] || []).push(i); });
    var groups = [];
    Object.keys(byCur).forEach(function (k) {
      cluster(list, byCur[k], c).forEach(function (g) { if (g.length > 1) groups.push(g); });
    });

    /* report matches that were kept apart because of currency */
    var split = cluster(list, scope, c).filter(function (g) {
      return g.length > 1 && new Set(g.map(function (i) { return cur(list[i]); })).size > 1;
    }).length;
    var splitMsg = split ? '\n\n' + split + ' name/PIN match(es) have different currencies and will be kept separate.' : '';

    if (!groups.length) {
      return note('No duplicate ' + c.label + 's found (same name or PIN, same currency).' + (split ? ' ' + split + ' match(es) kept separate because currencies differ.' : ''), 'error');
    }
    var total = groups.reduce(function (a, g) { return a + g.length; }, 0);
    var lines = groups.map(function (g) {
      return '• ' + (list[g[0]].name || '-') + ' [' + cur(list[g[0]]) + '] — ' + g.length + ' records';
    });
    var shown = lines.slice(0, 15).join('\n') + (lines.length > 15 ? '\n…and ' + (lines.length - 15) + ' more' : '');
    if (!confirm('Merge ' + total + ' ' + c.label + 's into ' + groups.length + '?\n\n' + shown +
      '\n\nBlank details are filled from duplicates, balances are added, and existing invoices/bills are re-pointed to the kept ' + c.label + '.' + splitMsg)) return;

    try { localStorage.setItem('__mergeBackup_' + kind, JSON.stringify({ at: new Date().toISOString(), data: list })); } catch (e) {}

    var drop = new Set(), replace = {}, nameMap = {}, idMap = {};
    groups.forEach(function (g) {
      var keeper = list[g[0]];
      replace[g[0]] = mergeRecs(g.map(function (i) { return list[i]; }), c);
      g.slice(1).forEach(function (i) {
        drop.add(i);
        var d = list[i];
        if (norm(d.name) !== norm(keeper.name)) nameMap[norm(d.name)] = keeper.name;
        if (d.id != null && keeper.id != null) idMap[String(d.id)] = keeper.id;
      });
    });
    var out = [];
    list.forEach(function (r, i) { if (!drop.has(i)) out.push(replace[i] || r); });
    localStorage.setItem(c.key, JSON.stringify(out));
    var re = remapDocs(c, nameMap, idMap);

    if (typeof window[c.render] === 'function') { try { window[c.render](); } catch (e) {} }
    note('🔗 Merged ' + total + ' ' + c.label + 's into ' + groups.length + (re ? ' · ' + re + ' linked record(s) updated' : '') + (split ? ' · ' + split + ' kept separate (currency)' : ''), 'success');
  }

  function guarded(kind) {
    var c = CFG[kind];
    if (typeof window.requirePermission === 'function' && !window.requirePermission(c.perm, 'edit', 'merge ' + c.label + 's')) return;
    run(kind);
  }
  window.mergeCustomers = function () { guarded('customers'); };
  window.mergeSuppliers = function () { guarded('suppliers'); };
})();
