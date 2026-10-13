/* acacia-app-inbox.js — Books side of the cross-app sync (add to Books index.html AFTER the other scripts).
 * 1) Invoices that arrive from Sell / CRM are posted to the chart of accounts and stock ONCE, using Books' own
 *    postToCOA / findAndDeductStock / restoreStock, and re-posted as a difference if the invoice is edited later.
 * 2) A small "From other apps" inbox: payments recorded in Sell are posted as real receipts through Books' own
 *    receipt code (you choose the bank), and invoices deleted in another app are deleted here only after you confirm. */
(function (w) {
  'use strict';
  var ls = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  var sv = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };
  var fn = function (n) { return typeof w[n] === 'function' ? w[n] : null; };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  function defaultAccount() {
    var coa = ls('chartOfAccounts', []); if (!Array.isArray(coa)) return '';
    var inc = coa.filter(function (a) { return /income|revenue/i.test(String(a.type || '') + ' ' + String(a.category || '')); });
    var s = inc.find(function (a) { return /sales/i.test(a.name || ''); }) || inc[0];
    return s ? (s.code || s.name || '') : '';
  }
  function stockKey(i) { return low(i.sku) || low(i.desc); }

  /* ---------- 1) ledger + stock for invoices that came from other apps ---------- */
  function reconcile() {
    if (!fn('postToCOA')) return;
    var invs = ls('invoices', []); if (!Array.isArray(invs) || !invs.length) return;
    var acct = defaultAccount(), postings = fn('getCOAPostings') ? fn('getCOAPostings')() : ls('coaPostings', []), changed = false;
    invs.forEach(function (inv) {
      if (!inv || (inv.source !== 'Sell' && inv.source !== 'CRM')) return;
      var items = (inv.items || []).filter(function (i) { return !i.type || i.type === 'product'; });
      var cur = { total: Number(inv.totalKES || inv.total) || 0, items: items.map(function (i) { return { d: i.desc || '', s: i.sku || '', q: Number(i.qty) || 0 }; }) };
      var old = inv.acx;
      if (old && JSON.stringify(old) === JSON.stringify(cur)) return;
      if (!inv.account && !acct) return;                          /* no sales account yet: try again later */
      if (!old) {                                                  /* already posted by another device? */
        var ex = (postings || []).filter(function (p) { return p.ref === inv.invoiceNumber && p.source === 'Invoice'; }).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
        if (ex) old = { total: ex, items: cur.items };
      }
      if (!inv.account) inv.account = acct;
      var delta = Math.round((cur.total - (old ? old.total : 0)) * 100) / 100;
      if (delta) fn('postToCOA')(inv.account, delta, { date: inv.date, ref: inv.invoiceNumber, source: 'Invoice' });
      var om = {}, nm = {}, names = {};
      (old ? old.items : []).forEach(function (i) { var k = stockKey({ sku: i.s, desc: i.d }); om[k] = (om[k] || 0) + i.q; names[k] = i; });
      cur.items.forEach(function (i) { var k = stockKey({ sku: i.s, desc: i.d }); nm[k] = (nm[k] || 0) + i.q; names[k] = i; });
      Object.keys(names).forEach(function (k) {
        var d = (nm[k] || 0) - (om[k] || 0), it = names[k];
        try { if (d > 0 && fn('findAndDeductStock')) fn('findAndDeductStock')(it.d, d, it.s); else if (d < 0 && fn('restoreStock')) fn('restoreStock')(it.d, -d, it.s); } catch (e) {}
      });
      inv.acx = cur; changed = true;
    });
    if (changed) {
      sv('invoices', invs);
      ['recalculateCustomerReceivables', 'renderInvoices', 'updateDashboardTotals', 'renderInventoryTable'].forEach(function (n) { try { if (fn(n)) fn(n)(); } catch (e) {} });
    }
  }

  /* ---------- 2) inbox ---------- */
  function pending() { var q = ls('appInbox', []); return Array.isArray(q) ? q.filter(function (x) { return x && x.status === 'pending'; }) : []; }
  function setStatus(id, status) { var q = ls('appInbox', []); q.forEach(function (x) { if (x && x.id === id) { x.status = status; x.doneAt = new Date().toISOString(); } }); sv('appInbox', q); }

  function postPayment(item, bankIdx, method) {
    var inv = ls('invoices', []).find(function (i) { return String(i.id) === String(item.invoiceId); });
    if (!inv) return alert('This invoice is not in Books yet. Wait a few seconds for it to sync, then try again.');
    var E = function (id) { return document.getElementById(id); };
    if (!E('receiptCustomer') || !fn('addReceipt')) return alert('Open the Receipts tab once, then try again.');
    var cs = E('receiptCustomer');
    if (!Array.prototype.some.call(cs.options, function (o) { return o.value === inv.customer; })) { var o = document.createElement('option'); o.value = o.textContent = inv.customer; cs.appendChild(o); }
    cs.value = inv.customer;
    if (fn('populateReceiptInvoiceDropdown')) fn('populateReceiptInvoiceDropdown')(inv.customer);
    E('receiptInvoice').value = String(inv.id);
    E('receiptDate').value = item.date || new Date().toISOString().slice(0, 10);
    E('receiptAmount').value = item.amount;
    var pm = E('paymentMode'); pm.value = method; if (pm.value !== method) pm.value = 'Cash';
    if (fn('populateBankSelect')) fn('populateBankSelect')(E('receiptBank'));
    E('receiptBank').value = String(bankIdx);
    E('receiptReference').value = (item.reference || '') + ' (' + item.app + ')';
    var before = ls('receipts', []).length;
    fn('addReceipt')();
    if (ls('receipts', []).length > before) { setStatus(item.id, 'posted'); return true; }
    return false;                                                  /* refused (locked period, permission, missing field) */
  }


  /* payroll run from the Payroll app: post every payslip through Books' own addGrossPay (Books works out PAYE/NSSF/SHIF itself) */
  function postPayroll(item, bankName) {
    var E = function (id) { return document.getElementById(id); };
    if (!E('payrollEmpID') || !fn('addGrossPay')) return alert('Open the Gross Pay (payroll) tab in Books once, then try again.');
    var done = Array.isArray(item.doneLines) ? item.doneLines.slice() : [], msgs = [], posted = 0, skipped = 0, failed = [];
    var oa = w.alert; w.alert = function (m) { msgs.push(String(m)); };
    try {
      (item.lines || []).forEach(function (l) {
        var key = l.empId + '|' + item.month;
        if (done.indexOf(key) > -1) return;
        var have = ls('payrollRecords', []).some(function (r) { return String(r.empID) === String(l.empId) && String(r.month) === String(item.month); });
        if (have) { skipped++; done.push(key); return; }
        E('payrollEmpID').value = l.empId; E('payrollMonth').value = item.month; E('payrollGross').value = l.gross;
        if (E('payrollCountry')) E('payrollCountry').value = 'kenya';
        if (E('payrollBank')) { var b = E('payrollBank'); if (!Array.prototype.some.call(b.options, function (o) { return o.value === bankName; })) { var o = document.createElement('option'); o.value = o.textContent = bankName; b.appendChild(o); } b.value = bankName; }
        if (E('payrollAccount')) E('payrollAccount').value = '';
        var before = ls('payrollRecords', []).length;
        try { fn('addGrossPay')(); } catch (e) {}
        if (ls('payrollRecords', []).length > before) { posted++; done.push(key); } else failed.push(l.name || l.empId);
      });
    } finally { w.alert = oa; }
    var q = ls('appInbox', []);
    q.forEach(function (x) { if (x && x.id === item.id) { x.doneLines = done; if (done.length >= (item.lines || []).length) { x.status = 'posted'; x.doneAt = new Date().toISOString(); } } });
    sv('appInbox', q);
    var booksNet = ls('payrollRecords', []).filter(function (r) { return String(r.month) === String(item.month) && (item.lines || []).some(function (l) { return String(l.empId) === String(r.empID); }); }).reduce(function (a, r) { return a + (Number(r.net) || 0); }, 0);
    alert('Payroll ' + item.period + ': ' + posted + ' payslip(s) posted to Books' + (skipped ? ', ' + skipped + ' already in Books' : '') + (failed.length ? '. NOT posted (check permissions or the employee): ' + failed.join(', ') : '') + '.\n\nNet pay in the Payroll app: KES ' + money(item.net) + '\nNet pay Books calculated: KES ' + money(booksNet) + '\n(Each system applies its own deduction rules, so the totals can differ.)' + (msgs.length ? '' : ''));
    return !failed.length;
  }

  function render() {
    var list = pending(), btn = document.getElementById('acxInboxBtn');
    if (!btn) {
      btn = document.createElement('button'); btn.id = 'acxInboxBtn'; btn.type = 'button';
      btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99998;background:#0f766e;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;display:none';
      btn.onclick = openModal; document.body.appendChild(btn);
    }
    btn.style.display = list.length ? 'block' : 'none';
    btn.textContent = '📥 ' + list.length + ' from other apps';
    if (document.getElementById('acxInboxModal')) openModal(true);
  }

  function openModal(keep) {
    var list = pending(), m = document.getElementById('acxInboxModal');
    if (!list.length) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement('div'); m.id = 'acxInboxModal'; m.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif'; document.body.appendChild(m); }
    else if (keep === true && m.querySelector('select:focus,input:focus')) return;
    var banks = ls('banks', []), bankOpts = banks.map(function (b, i) { return '<option value="' + i + '">' + esc((b && (b.name || b.bankName || b.accountName)) || ('Bank #' + (i + 1))) + '</option>'; }).join('');
    var pmEl = document.getElementById('paymentMode'), methods = pmEl ? Array.prototype.map.call(pmEl.options, function (o) { return o.value; }) : ['Cash', 'Bank Transfer', 'M-Pesa'];
    var rows = list.map(function (x, n) {
      if (x.type === 'payroll') {
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Payroll run from ' + esc(x.app) + '</b> — ' + esc(x.period) + ' (' + (x.lines || []).length + ' employees)<br>Gross KES ' + money(x.gross) + ' · Net in Payroll app KES ' + money(x.net) + '<br><span style="color:#6b7280">Books recalculates PAYE, NSSF, SHIF and housing levy from each gross pay, so its net can differ slightly.</span><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><select id="acxB' + n + '">' + (bankOpts || '<option value="">(no bank accounts)</option>') + '</select><button data-act="payroll" data-n="' + n + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post payslips to Books</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Ignore</button></div></div>';
      }
      if (x.type === 'payment') {
        var mo = methods.map(function (v) { return '<option' + (low(v) === low(x.method) ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Payment from ' + esc(x.app) + '</b> — ' + esc(x.customer) + '<br>Invoice ' + esc(x.invoiceNumber) + ' · ' + esc(x.date) + ' · <b>KES ' + money(x.amount) + '</b><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><select id="acxM' + n + '">' + mo + '</select><select id="acxB' + n + '">' + (bankOpts || '<option value="">(no bank accounts)</option>') + '</select><button data-act="pay" data-n="' + n + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post receipt</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Ignore</button></div></div>';
      }
      return '<div style="border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:10px;margin-bottom:8px"><b>Deleted in ' + esc(x.app) + '</b> — invoice ' + esc(x.invoiceNumber) + ' (' + esc(x.customer) + ', KES ' + money(x.amount) + ')<br><span style="color:#6b7280">Deleting it here restores stock and reverses its payments, so Books asks you to confirm.</span><div style="margin-top:6px;display:flex;gap:6px"><button data-act="del" data-n="' + n + '" style="background:#b91c1c;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Delete in Books</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Keep it</button></div></div>';
    }).join('');
    m.innerHTML = '<div style="background:#fff;border-radius:12px;padding:18px;width:min(640px,94vw);max-height:84vh;overflow:auto"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:16px">From other apps (' + list.length + ')</h3><button id="acxInboxClose" style="border:0;background:none;font-size:20px;cursor:pointer">×</button></div>' + rows + '</div>';
    m.querySelector('#acxInboxClose').onclick = function () { m.remove(); };
    m.onclick = function (e) {
      if (e.target === m) return m.remove();
      var b = e.target.closest && e.target.closest('button[data-act]'); if (!b) return;
      var item = list[Number(b.getAttribute('data-n'))], act = b.getAttribute('data-act'); if (!item) return;
      if (act === 'skip') { setStatus(item.id, 'dismissed'); }
      else if (act === 'pay') { var bi = document.getElementById('acxB' + b.getAttribute('data-n')).value; if (bi === '') return alert('Choose a bank account first.'); postPayment(item, bi, document.getElementById('acxM' + b.getAttribute('data-n')).value); }
      else if (act === 'payroll') { var sel = document.getElementById('acxB' + b.getAttribute('data-n')); if (!sel || sel.value === '') return alert('Choose a bank account first.'); postPayroll(item, sel.options[sel.selectedIndex].text); }
      else if (act === 'del') {
        if (!fn('deleteInvoice')) return alert('Open the Invoices tab once, then try again.');
        fn('deleteInvoice')(item.invoiceId);
        if (!ls('invoices', []).some(function (i) { return String(i.id) === String(item.invoiceId); })) setStatus(item.id, 'done');
      }
      render();
    };
  }

  function tick() { try { if (!document.body || !(w.__companyNS ? w.__companyNS.activeCompany() : true)) return; reconcile(); render(); } catch (e) { console.warn('[acacia-app-inbox]', e); } }
  setInterval(tick, 8000); setTimeout(tick, 3000);
  w.AcaciaAppInbox = { tick: tick, reconcile: reconcile };
})(window);
