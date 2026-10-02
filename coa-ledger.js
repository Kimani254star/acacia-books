/* Chart of Accounts ledger helper + account-picker balances.
   1) window.getCOALedger() -> { get(acc), find(key) } with opening / debit / credit / closing per account
   2) Every account picker (<select> filled from the Chart of Accounts) shows the account's closing balance
      next to its name. Uses option.label, so option.value / option.text / option.textContent are NOT changed
      and existing code that reads them keeps working. */
(function () {
  'use strict';
  var STORES = ['operationalCosts', 'expenses', 'taxPayments', 'payrollRecords', 'payrollPayments', 'manualTransactions', 'receipts', 'billPayments', 'customerPayments', 'supplierPayments', 'interestPayments', 'otherIncomes', 'transactions'];
  var FIELDS = ['account', 'accountName', 'chartAccount', 'accountCode', 'category', 'type', 'taxType', 'costCategory', 'expenseAccount'];
  var AMT = ['amount', 'total', 'net', 'netPay', 'value'];
  var SKIP_IDS = { accountType: 1, accountCategory: 1, accountRootType: 1 };

  function LS(k) { try { var v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function num(v) { var n = parseFloat(String(v == null ? 0 : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  function isDebitNormal(a) {
    var r = a && a.rootType;
    if (!r) {
      var t = norm(a && a.type);
      r = /payable|liabilit|loan|accrued|unearned|deferred revenue|deposit.*custom/.test(t) ? 'Liability'
        : /equity|capital|reserve|stock|earnings|drawings|surplus/.test(t) ? 'Equity'
        : /income|revenue|sales|gain/.test(t) ? 'Income'
        : /expense|cost|depreciation|amortis|amortiz|charges/.test(t) ? 'Expense' : 'Asset';
    }
    return r === 'Asset' || r === 'Expense';
  }

  var cache = null, cacheAt = 0;
  function build() {
    var accs = LS('chartOfAccounts'), rows = [], idx = Object.create(null), byCode = Object.create(null), byName = Object.create(null);
    accs.forEach(function (a, i) {
      var o = num(a && a.amount);
      rows.push({ opening: o, debit: 0, credit: 0, closing: o, dn: isDebitNormal(a) });
      if (!a) return;
      var n = norm(a.name), c = norm(a.code);
      if (n) (idx[n] = idx[n] || []).push(i);
      if (c && c !== n) (idx[c] = idx[c] || []).push(i);
      if (a.code != null && a.code !== '' && !(String(a.code) in byCode)) byCode[String(a.code)] = i;
      if (a.name != null && !(String(a.name) in byName)) byName[String(a.name)] = i;
    });
    function add(i, d) {
      if (!d) return;
      var r = rows[i]; r.closing += d;
      if ((d >= 0) === r.dn) r.debit += Math.abs(d); else r.credit += Math.abs(d);
    }
    STORES.forEach(function (k) {
      LS(k).forEach(function (rec) {
        if (!rec || typeof rec !== 'object') return;
        var seen = {}, hit = [];
        FIELDS.forEach(function (f) {
          var v = norm(rec[f]);
          if (v && idx[v]) idx[v].forEach(function (i) { if (!seen[i]) { seen[i] = 1; hit.push(i); } });
        });
        if (!hit.length) return;
        var d = 0;
        for (var j = 0; j < AMT.length; j++) if (rec[AMT[j]] != null && rec[AMT[j]] !== '') { d = num(rec[AMT[j]]); break; }
        hit.forEach(function (i) { add(i, d); });
      });
    });
    LS('manualJournals').forEach(function (j) {
      (j.entries || []).forEach(function (en) {
        if (!en) return;
        var a = norm(en.account || en.accountName || en.code);
        if (!a || !idx[a]) return;
        var d = num(en.debit), c = num(en.credit);
        idx[a].forEach(function (i) { rows[i].debit += d; rows[i].credit += c; rows[i].closing += d - c; });
      });
    });
    LS('coaPostings').forEach(function (p) {
      var a = norm(p && p.account);
      if (!a || !idx[a]) return;
      var d = num(p.amount);
      idx[a].forEach(function (i) { add(i, d); });
    });
    var zero = function (acc) { var o = num(acc && acc.amount); return { opening: o, debit: 0, credit: 0, closing: o }; };
    return {
      get: function (acc) {
        if (!acc) return zero(acc);
        var i = acc.code != null && acc.code !== '' ? byCode[String(acc.code)] : undefined;
        if (i === undefined) i = byName[String(acc.name)];
        return i === undefined ? zero(acc) : rows[i];
      },
      find: function (key) {
        var l = idx[norm(key)];
        return l && l.length ? rows[l[0]] : null;
      }
    };
  }
  function getLedger(force) {
    if (!force && cache && Date.now() - cacheAt < 400) return cache;
    cache = build(); cacheAt = Date.now(); return cache;
  }
  window.getCOALedger = getLedger;

  /* ---------- account pickers ---------- */
  function fmt(n) {
    try { if (typeof window.__fmtBase === 'function') return window.__fmtBase(n); } catch (e) {}
    return Number(n || 0).toFixed(2);
  }
  function rowForOption(L, o) {
    var r, v = norm(o.value);
    if (v && (r = L.find(v))) return r;
    var t = String(o.dataset.acxBase != null ? o.dataset.acxBase : o.textContent), m;
    if ((m = t.match(/^(.*?)\s*\(([^()]+)\)\s*$/))) { if ((r = L.find(m[1]) || L.find(m[2]))) return r; }
    if ((m = t.match(/^(.+?)\s+[-\u2013\u2014]\s+(.+)$/))) { if ((r = L.find(m[1]) || L.find(m[2]))) return r; }
    return L.find(t);
  }
  function decorate(sel, L) {
    if (!sel || sel.multiple || SKIP_IDS[sel.id] || (sel.closest && sel.closest('#accountsTable'))) return;
    var opts = sel.options, n = 0, m = 0, hits = [], i, o, r;
    for (i = 0; i < opts.length; i++) {
      o = opts[i];
      if (!String(o.value).trim()) { hits.push(null); continue; }
      n++; r = rowForOption(L, o); hits.push(r); if (r) m++;
    }
    if (n < 2 || m < 2 || m / n < 0.6) return;
    for (i = 0; i < opts.length; i++) {
      o = opts[i]; r = hits[i];
      if (!r) continue;
      if (o.dataset.acxBase == null || o.dataset.acxText !== o.textContent) o.dataset.acxBase = o.textContent;
      o.dataset.acxText = o.textContent;
      o.label = o.dataset.acxBase + '  \u2014  ' + fmt(r.closing);
    }
  }
  function scanAll() {
    if (!LS('chartOfAccounts').length) return;
    var L = getLedger();
    Array.prototype.forEach.call(document.querySelectorAll('select'), function (s) { try { decorate(s, L); } catch (e) {} });
  }

  var pending = [], timer = null;
  function flush() {
    timer = null;
    var list = pending; pending = [];
    if (!list.length || !LS('chartOfAccounts').length) return;
    var L = getLedger();
    list.forEach(function (s) { try { decorate(s, L); } catch (e) {} });
  }
  function queue(s) { if (pending.indexOf(s) < 0) pending.push(s); if (!timer) timer = setTimeout(flush, 120); }

  function boot() {
    try {
      new MutationObserver(function (ms) {
        ms.forEach(function (m) {
          var t = m.target, s = t && t.nodeType === 1 ? (t.tagName === 'SELECT' ? t : (t.closest && t.closest('select'))) : null;
          if (s) queue(s);
          Array.prototype.forEach.call(m.addedNodes || [], function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'SELECT') queue(n);
            else if (n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll('select'), queue);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    /* refresh the amounts whenever someone opens a picker */
    ['mousedown', 'focusin'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var s = e.target;
        if (s && s.tagName === 'SELECT') { try { decorate(s, getLedger()); } catch (x) {} }
      }, true);
    });
    scanAll(); setTimeout(scanAll, 1500); setTimeout(scanAll, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
