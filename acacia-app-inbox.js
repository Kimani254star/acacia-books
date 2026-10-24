/* acacia-app-inbox.js — Books side of the cross-app sync (add to Books index.html AFTER the other scripts).
 * 1) Invoices that arrive from Sell / CRM are posted to the chart of accounts and stock ONCE, using Books' own
 *    postToCOA / findAndDeductStock / restoreStock, and re-posted as a difference if the invoice is edited later.
 * 2) A small "From other apps" inbox: payments recorded in Sell are posted as real receipts through Books' own
 *    receipt code (you choose the bank), and invoices deleted in another app are deleted here only after you confirm.
 * 3) Expenses: bills (normal, bulk, recurring) become real Books bills (same ledger posting as a bill typed in Books),
 *    and bill payments are posted through Books' own Record Payment code once you choose the bank.
 * 4) Expenses: paid expense records become real Operational Costs (through Books' own Add Operational Cost code, you choose the
 *    bank), and goods received notes (GRN) become Books GRNs. */
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


  /* ---------- Expenses app: bills + bill payments ---------- */
  function rateKey(r) { return String(r == null ? '' : r).trim().toLowerCase().replace('%', ''); }
  function billFromItem(item, bills) {
    var used = {}; bills.forEach(function (b) { if (b && b.billNumber) used[String(b.billNumber)] = 1; });
    var base = String(item.billNo || '').trim() || 'EXP-' + String(item.billId || '').slice(-6), no = base, n = 1;
    while (used[no]) { n++; no = base + '-EXP' + (n > 2 ? n : ''); }
    var pg = 0, po = 0, pz = 0, pe = 0;
    var its = (item.items || []).map(function (i) {
      var sub = Number(i.subtotal) || (Number(i.qty) || 0) * (Number(i.price) || 0), r = rateKey(i.taxRate);
      if (r === '16') pg += sub; else if (r === '8') po += sub; else if (r === '0' || r === 'zero') pz += sub; else if (r === 'exempt') pe += sub;
      return { desc: i.desc || 'Item', qty: Number(i.qty) || 0, price: Number(i.price) || 0, taxRate: String(i.taxRate == null ? '' : i.taxRate), subtotal: sub, vat: Number(i.vat) || 0, type: 'service' };
    });
    var term = Number(item.termDays) || 0, d = new Date(String(item.date || '') + 'T00:00:00'), due = item.date || '';
    if (!isNaN(d)) { d.setDate(d.getDate() + term); due = d.toISOString().slice(0, 10); }
    var bill = {
      id: (w.crypto && w.crypto.randomUUID) ? w.crypto.randomUUID() : 'bill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      billNumber: no, date: item.date || new Date().toISOString().slice(0, 10), supplier: item.supplier || '', chartOfAccount: item.chartOfAccount || '', termDays: term, lpo: item.lpo || '',
      due: due, items: its, subtotal: Number(item.subtotal) || 0, vat: Number(item.vat) || 0, total: Number(item.total) || 0, currency: item.currency || 'KES', currencyRate: Number(item.currencyRate) || 1,
      paidAmount: 0, purchasesGeneral: pg, purchasesOther: po, purchasesZero: pz, purchasesExempt: pe,
      source: 'Expenses', acxSrcId: String(item.billId || ''), acxSrcApp: 'Expenses', acxSrcKind: item.kind || 'bill', description: item.description || ''
    };
    if (item.recurringId) { bill.recurringId = item.recurringId; bill.recurringNumber = item.recurringNumber || ''; bill.recurringRun = item.recurringRun || ''; }
    return bill;
  }
  function postBill(item) {
    var bills = ls('bills', []); if (!Array.isArray(bills)) bills = [];
    if (bills.some(function (b) { return b && b.acxSrcId && b.acxSrcId === String(item.billId || '') && b.acxSrcApp === 'Expenses'; })) { setStatus(item.id, 'posted'); return true; }   /* already in Books: never double-post */
    var sup = ls('suppliers', []); if (Array.isArray(sup) && item.supplier && !sup.some(function (s) { return s && low(s.name) === low(item.supplier); })) { alert('Supplier "' + item.supplier + '" is not in Books yet. Wait a few seconds for suppliers to sync, then try again.'); return false; }
    var bill = billFromItem(item, bills);
    bills.push(bill); sv('bills', bills);
    try {
      if (fn('applyBillToLedger')) fn('applyBillToLedger')(bill);
      else { if (fn('updateSupplierBalance')) fn('updateSupplierBalance')(bill.supplier, bill.total); if (fn('postBillJournal')) fn('postBillJournal')(bill); if (fn('updateAccountsPayable')) fn('updateAccountsPayable')(); }
    } catch (e) { console.warn('[acacia-app-inbox] bill ledger', e); }
    ['loadSupplierBills', 'renderSuppliers', 'renderAccountsPayable', 'updateDashboardTotals', 'renderManualJournals', 'renderCreditcontrolAnalysis'].forEach(function (n) { try { if (fn(n)) fn(n)(); } catch (e) {} });
    setStatus(item.id, 'posted');
    return true;
  }
  function postAllBills() {
    var n = 0; pending().filter(function (x) { return x.type === 'bill'; }).forEach(function (x) { if (postBill(x)) n++; });
    return n;
  }
  function postBillPayment(item, bankName) {
    var bills = ls('bills', []), idx = -1;
    bills.forEach(function (b, i) { if (idx < 0 && b && b.acxSrcApp === 'Expenses' && b.acxSrcId === String(item.billId || '')) idx = i; });
    if (idx < 0) return alert('This bill is not in Books yet. Post the bill first (it is in the list above), then post its payment.'), false;
    var b = bills[idx], total = parseFloat(b.total) || 0, paid = parseFloat(b.paidAmount) || 0, owed = Math.max(total - paid, 0), amt = Math.min(Number(item.amount) || 0, owed);
    if (owed <= 0.005) { setStatus(item.id, 'posted'); return true; }                      /* bill already settled in Books */
    if (!fn('recordBillPayment')) return alert('Open the Bills tab once, then try again.'), false;
    var msgs = [], oa = w.alert, oc = w.confirm, E = function (id) { return document.getElementById(id); }, before = ls('billPayments', []).length, ok = false;
    w.alert = function (m) { msgs.push(String(m)); }; w.confirm = function () { return false; };
    try {
      fn('recordBillPayment')(idx);
      if (E('paymentAmountInput') && E('paymentBankSelect') && E('savePaymentBtn')) {
        E('paymentAmountInput').value = amt;
        var sel = E('paymentBankSelect'); if (!Array.prototype.some.call(sel.options, function (o) { return o.value === bankName; })) { var o = document.createElement('option'); o.value = o.textContent = bankName; sel.appendChild(o); }
        sel.value = bankName; if (E('paymentExchangeRate')) E('paymentExchangeRate').value = 1;
        E('savePaymentBtn').click();
      }
    } catch (e) { msgs.push(String(e && e.message || e)); }
    finally { w.alert = oa; w.confirm = oc; var m = document.querySelector('#paymentAmountInput'); if (m) { var box = m.closest('div[style*="fixed"]'); if (box && box.parentNode) box.parentNode.removeChild(box); } }
    var bp = ls('billPayments', []);
    if (bp.length > before) {                                                              /* use the date the payment was made in Expenses */
      ok = true; var rec = bp[bp.length - 1], day = String(item.date || '').slice(0, 10);
      if (day && rec) {
        rec.date = day; rec.reference = (item.paymentId ? 'Expenses ' + item.paymentId : rec.reference); sv('billPayments', bp);
        ['transactions', 'manualTransactions'].forEach(function (k) { var a = ls(k, []); if (Array.isArray(a)) { a.forEach(function (t) { if (t && String(t.id) === String(rec.id)) t.date = day; }); sv(k, a); } });
      }
      setStatus(item.id, 'posted');
    } else alert('Payment was not posted' + (msgs.length ? ': ' + msgs[msgs.length - 1] : '.'));
    ['loadSupplierBills', 'renderSupplierPayments', 'renderBankTable', 'renderManualTransactions', 'updateBankDropdowns', 'renderAccountsPayable'].forEach(function (n) { try { if (fn(n)) fn(n)(); } catch (e) {} });
    return ok;
  }

  var lastErr = '';
  var uuid = function () { return (w.crypto && w.crypto.randomUUID) ? w.crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); };
  function bankNames() { return (ls('banks', []) || []).map(function (b, i) { return (b && (b.name || b.bankName || b.accountName)) || ('Bank #' + (i + 1)); }); }
  function ensureOption(sel, val, label) {
    if (!sel || !sel.options || val === '' || val == null) return;
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === String(val); })) { var o = document.createElement('option'); o.value = String(val); o.textContent = label || String(val); sel.appendChild(o); }
  }

  /* Expenses: a paid expense record -> a real Books Operational Cost. Runs Books' own addOperationalCost (bank balance, ledger,
   * journal, VAT), by filling its form fields and pressing it, then puts back whatever was half-typed in that form. */
  var COST_IDS = ['costDate', 'costDescription', 'costVendor', 'costCategory', 'costPaymentMode', 'costPaidVia', 'costBank', 'costAmount', 'costVatRate', 'costVatInclusive', 'costNotes'];
  function postExpense(item, bankName, method) {
    var costs = ls('operationalCosts', []); if (!Array.isArray(costs)) costs = [];
    var mine = function (c) { return c && c.acxSrcId && c.acxSrcId === String(item.expId || '') && c.acxSrcApp === 'Expenses'; };
    if (costs.some(mine)) { setStatus(item.id, 'posted'); return true; }                       /* already in Books: never double-post */
    var E = function (id) { return document.getElementById(id); };
    if (!fn('addOperationalCost') || !COST_IDS.every(E)) { lastErr = 'Open the Operational Costs tab once, then try again.'; return false; }
    var editing = null; try { editing = editingOperationalCostIndex; } catch (e) {}
    if (editing !== null && editing !== undefined) { lastErr = 'Finish or cancel the cost you are editing in Operational Costs first, then try again.'; return false; }
    var att = E('costAttachment'); if (att && att.files && att.files.length) { lastErr = 'Remove the file attached in the Operational Costs form first, then try again.'; return false; }
    if (!bankName) { lastErr = 'Choose a bank account first.'; return false; }
    if (!String(item.category || '').trim()) { lastErr = 'This expense has no category. Set one in Expenses first.'; return false; }
    var snap = {}; COST_IDS.forEach(function (id) { snap[id] = id === 'costVatInclusive' ? E(id).checked : E(id).value; });
    var dirty = ['costDate', 'costDescription', 'costVendor', 'costCategory', 'costAmount', 'costNotes'].some(function (id) { return String(snap[id] || '').trim() !== ''; });
    var rate = Number(item.taxRate) || 0, before = ls('operationalCosts', []).length, msgs = [], oa = w.alert, ok = false;
    w.alert = function (m) { msgs.push(String(m)); };
    try {
      ensureOption(E('costCategory'), item.category); ensureOption(E('costPaymentMode'), method || 'Bank Transfer'); ensureOption(E('costBank'), bankName);
      ensureOption(E('costVatRate'), rate > 0 ? String(rate) : '0', rate > 0 ? 'VAT ' + rate + '%' : 'Zero Rated');
      E('costDate').value = String(item.date || '').slice(0, 10); E('costDescription').value = item.description || item.expNo || 'Expense';
      E('costVendor').value = item.supplier || ''; E('costCategory').value = item.category; E('costPaymentMode').value = method || 'Bank Transfer';
      E('costPaidVia').value = 'bank'; E('costBank').value = bankName; E('costAmount').value = Number(item.amount) || 0;
      E('costVatRate').value = rate > 0 ? String(rate) : '0'; E('costVatInclusive').checked = false;
      E('costNotes').value = ['From Expenses ' + (item.expNo || ''), item.reference ? 'Ref ' + item.reference : '', item.notes || ''].filter(Boolean).join(' · ');
      fn('addOperationalCost')();
    } catch (e) { msgs.push(String(e && e.message || e)); }
    finally {
      w.alert = oa;
      if (dirty) { try { COST_IDS.forEach(function (id) { if (id === 'costVatInclusive') E(id).checked = snap[id]; else { ensureOption(E(id), snap[id]); E(id).value = snap[id]; } }); if (fn('updateOperationalCostVat')) fn('updateOperationalCostVat')(); } catch (e) {} }
    }
    var after = ls('operationalCosts', []);
    if (Array.isArray(after) && after.length > before) {
      var rec = after[after.length - 1]; rec.acxSrcId = String(item.expId || ''); rec.acxSrcApp = 'Expenses'; rec.acxSrcNo = item.expNo || ''; sv('operationalCosts', after);
      setStatus(item.id, 'posted'); ok = true;
    } else lastErr = 'The cost was not posted' + (msgs.length ? ': ' + msgs[msgs.length - 1] : '.');
    ['renderOperationalCosts', 'renderBankTable', 'renderManualTransactions', 'updateBankDropdowns', 'updateDashboardTotals'].forEach(function (n) { try { if (fn(n)) fn(n)(); } catch (e) {} });
    return ok;
  }
  function postAllExpenses(defBank, method) {
    var names = bankNames(), n = 0, bad = 0, first = '';
    pending().filter(function (x) { return x.type === 'expense'; }).forEach(function (x) {
      var own = names.filter(function (nm) { return x.bank && low(nm) === low(x.bank); })[0], b = own || defBank;
      if (postExpense(x, b, method)) n++; else { bad++; if (!first) first = lastErr; }
    });
    return { posted: n, failed: bad, err: first };
  }

  /* Expenses: a goods received note -> a Books GRN (approved, linked to the Books bill number when that bill is already posted).
   * Books GRNs are a record only: like a GRN typed in Books, this does not move stock or touch the ledger. */
  function postGrn(item) {
    var g = ls('grns', []); if (!Array.isArray(g)) g = [];
    if (g.some(function (x) { return x && x.acxSrcId && x.acxSrcId === String(item.grnId || '') && x.acxSrcApp === 'Expenses'; })) { setStatus(item.id, 'posted'); return true; }
    var sup = ls('suppliers', []);
    if (Array.isArray(sup) && item.supplier && !sup.some(function (s) { return s && low(s.name) === low(item.supplier); })) { lastErr = 'Supplier "' + item.supplier + '" is not in Books yet. Wait a few seconds for suppliers to sync, then try again.'; return false; }
    var bills = ls('bills', []), bk = (Array.isArray(bills) ? bills : []).filter(function (b) { return b && b.acxSrcApp === 'Expenses' && b.acxSrcId === String(item.billId || ''); })[0];
    var number = ''; try { number = fn('generateNextGRNNumber') ? String(fn('generateNextGRNNumber')() || '') : ''; } catch (e) {}
    var k = g.length + 1; while (!number || g.some(function (x) { return x && x.number === number; })) { number = 'GN' + String(k++).padStart(4, '0'); }
    var items = (item.items || []).map(function (i) { return { name: i.name || 'Item', description: i.name || 'Item', qty: Number(i.qty) || 0 }; });
    g.push({
      id: uuid(), number: number, date: String(item.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10), supplier: item.supplier || '',
      description: item.description || items.map(function (i) { return i.name + ' (x' + i.qty + ')'; }).join(', '), location: item.location || '',
      reference: (bk && bk.billNumber) || item.billNo || item.reference || '', collectionOption: item.collectionOption || '', receiver: item.receivedBy || '', trackNo: item.trackNumber || '',
      items: items, status: 'Approved', source: 'Expenses', acxSrcId: String(item.grnId || ''), acxSrcApp: 'Expenses', acxSrcNo: item.grnNo || ''
    });
    sv('grns', g); try { if (fn('renderGRNTable')) fn('renderGRNTable')(); } catch (e) {}
    setStatus(item.id, 'posted'); return true;
  }
  function postAllGrns() {
    var n = 0, bad = 0, first = '';
    pending().filter(function (x) { return x.type === 'grn'; }).forEach(function (x) { if (postGrn(x)) n++; else { bad++; if (!first) first = lastErr; } });
    return { posted: n, failed: bad, err: first };
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
      if (x.type === 'bill') {
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Bill from ' + esc(x.app) + '</b> — ' + esc(x.supplier) + '<br>' + esc(x.billNo || '') + ' · ' + esc(x.date) + ' · <b>KES ' + money(x.total) + '</b>' + (x.chartOfAccount ? ' · ' + esc(x.chartOfAccount) : '') + '<br><span style="color:#6b7280">Posting it creates a normal bill in Books and updates the supplier balance and ledger.</span><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><button data-act="bill" data-n="' + n + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post bill</button><button data-act="billall" data-n="' + n + '" style="border:1px solid #0f766e;color:#0f766e;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Post all bills</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Dismiss</button></div></div>';
      }
      if (x.type === 'billPayment') {
        var bsel = banks.map(function (b, i) { var nm = (b && (b.name || b.bankName || b.accountName)) || ('Bank #' + (i + 1)); return '<option value="' + i + '"' + (x.bank && low(nm) === low(x.bank) ? ' selected' : '') + '>' + esc(nm) + '</option>'; }).join('');
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Bill payment from ' + esc(x.app) + '</b> — ' + esc(x.supplier) + '<br>Bill ' + esc(x.billNo || '') + ' · ' + esc(x.date) + ' · <b>KES ' + money(x.amount) + '</b>' + (x.bank ? ' · paid from "' + esc(x.bank) + '"' : '') + '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><select id="acxB' + n + '">' + (bsel || '<option value="">(no bank accounts)</option>') + '</select><button data-act="billpay" data-n="' + n + '" data-bank="' + esc(x.bank || '') + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post payment</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Dismiss</button></div></div>';
      }
      if (x.type === 'payroll') {
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Payroll run from ' + esc(x.app) + '</b> — ' + esc(x.period) + ' (' + (x.lines || []).length + ' employees)<br>Gross KES ' + money(x.gross) + ' · Net in Payroll app KES ' + money(x.net) + '<br><span style="color:#6b7280">Books recalculates PAYE, NSSF, SHIF and housing levy from each gross pay, so its net can differ slightly.</span><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><select id="acxB' + n + '">' + (bankOpts || '<option value="">(no bank accounts)</option>') + '</select><button data-act="payroll" data-n="' + n + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post payslips to Books</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Ignore</button></div></div>';
      }
      if (x.type === 'payment') {
        var mo = methods.map(function (v) { return '<option' + (low(v) === low(x.method) ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Payment from ' + esc(x.app) + '</b> — ' + esc(x.customer) + '<br>Invoice ' + esc(x.invoiceNumber) + ' · ' + esc(x.date) + ' · <b>KES ' + money(x.amount) + '</b><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><select id="acxM' + n + '">' + mo + '</select><select id="acxB' + n + '">' + (bankOpts || '<option value="">(no bank accounts)</option>') + '</select><button data-act="pay" data-n="' + n + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post receipt</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Ignore</button></div></div>';
      }
      if (x.type === 'expense') {
        var xs = banks.map(function (b, i) { var nm = (b && (b.name || b.bankName || b.accountName)) || ('Bank #' + (i + 1)); return '<option value="' + i + '"' + (x.bank && low(nm) === low(x.bank) ? ' selected' : '') + '>' + esc(nm) + '</option>'; }).join('');
        var cm = document.getElementById('costPaymentMode'), cms = cm ? Array.prototype.map.call(cm.options, function (o) { return o.value; }).filter(Boolean) : ['Cash', 'Bank Transfer', 'M-Pesa'];
        var xo = cms.map(function (v) { return '<option' + (low(v) === 'bank transfer' ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Operational cost from ' + esc(x.app) + '</b> — ' + esc(x.description || x.expNo) + '<br>' + esc(x.expNo || '') + ' · ' + esc(x.date) + (x.supplier ? ' · ' + esc(x.supplier) : '') + ' · ' + esc(x.category) + '<br>Amount ' + money(x.amount) + (x.vat ? ' + VAT ' + money(x.vat) : '') + ' = <b>' + esc(x.currency && x.currency !== 'KES' ? x.currency + ' ' : 'KES ') + money(x.total) + '</b>' + (x.currency && x.currency !== 'KES' ? '<br><span style="color:#b45309">Books posts operational costs as entered (no currency conversion), so check this amount.</span>' : '') + '<br><span style="color:#6b7280">Posting it creates a normal Operational Cost in Books: the bank is reduced and the ledger, journal and VAT are updated.</span><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><select id="acxB' + n + '">' + (xs || '<option value="">(no bank accounts)</option>') + '</select><select id="acxM' + n + '">' + xo + '</select><button data-act="exp" data-n="' + n + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post cost</button><button data-act="expall" data-n="' + n + '" style="border:1px solid #0f766e;color:#0f766e;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Post all costs</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Dismiss</button><button data-act="expdismiss" data-n="' + n + '" title="For costs you already entered in Books yourself" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Dismiss all costs</button></div></div>';
      }
      if (x.type === 'grn') {
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>Goods received from ' + esc(x.app) + '</b> — ' + esc(x.supplier) + '<br>' + esc(x.grnNo || '') + ' · ' + esc(x.date) + (x.billNo ? ' · Bill ' + esc(x.billNo) : '') + (x.location ? ' · ' + esc(x.location) : '') + '<br>' + (x.items || []).map(function (i) { return esc(i.name) + ' × ' + esc(i.qty); }).join(', ') + '<br><span style="color:#6b7280">Posting it adds an approved GRN in Books. Like a GRN typed in Books, it does not change stock or the ledger.</span><div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><button data-act="grn" data-n="' + n + '" style="background:#0f766e;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Post GRN</button><button data-act="grnall" data-n="' + n + '" style="border:1px solid #0f766e;color:#0f766e;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Post all GRNs</button><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Dismiss</button><button data-act="grndismiss" data-n="' + n + '" title="For GRNs you already entered in Books yourself" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Dismiss all GRNs</button></div></div>';
      }
      if (x.type !== 'invoiceDelete') return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px"><b>' + esc(x.type || 'Item') + ' from ' + esc(x.app || 'another app') + '</b><br><span style="color:#6b7280">Books does not know how to post this kind of item yet.</span><div style="margin-top:6px"><button data-act="skip" data-n="' + n + '" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer">Dismiss</button></div></div>';
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
      else if (act === 'bill') { postBill(item); }
      else if (act === 'billall') { var cnt = postAllBills(); if (cnt) alert(cnt + ' bill(s) posted to Books.'); }
      else if (act === 'billpay') { var bsel2 = document.getElementById('acxB' + b.getAttribute('data-n')); var want = b.getAttribute('data-bank') || ''; var bname = bsel2 && bsel2.value !== '' ? bsel2.options[bsel2.selectedIndex].text : want; if (!bname) return alert('Choose a bank account first.'); postBillPayment(item, bname); }
      else if (act === 'exp' || act === 'expall') {
        var bs = document.getElementById('acxB' + b.getAttribute('data-n')), ms = document.getElementById('acxM' + b.getAttribute('data-n'));
        if (!bs || bs.value === '') return alert('Choose a bank account first.');
        var bn = bs.options[bs.selectedIndex].text, mm = ms ? ms.value : 'Bank Transfer';
        if (act === 'exp') { if (!postExpense(item, bn, mm)) alert(lastErr); }
        else { var r1 = postAllExpenses(bn, mm); alert(r1.posted + ' cost(s) posted to Books.' + (r1.failed ? ' ' + r1.failed + ' could not be posted: ' + r1.err : '')); }
      }
      else if (act === 'expdismiss' || act === 'grndismiss') {
        var dt = act === 'expdismiss' ? 'expense' : 'grn', dn = pending().filter(function (x) { return x.type === dt; });
        if (!confirm('Dismiss all ' + dn.length + ' pending ' + (dt === 'expense' ? 'cost' : 'GRN') + '(s) without posting them to Books?')) return;
        dn.forEach(function (x) { setStatus(x.id, 'dismissed'); });
      }
      else if (act === 'grn') { if (!postGrn(item)) alert(lastErr); }
      else if (act === 'grnall') { var r2 = postAllGrns(); alert(r2.posted + ' GRN(s) posted to Books.' + (r2.failed ? ' ' + r2.failed + ' could not be posted: ' + r2.err : '')); }
      else if (act === 'del') {
        if (!fn('deleteInvoice')) return alert('Open the Invoices tab once, then try again.');
        fn('deleteInvoice')(item.invoiceId);
        if (!ls('invoices', []).some(function (i) { return String(i.id) === String(item.invoiceId); })) setStatus(item.id, 'done');
      }
      render();
    };
  }

  /* Books project form: picking a plan fills department, priority, dates, description and the budget linked to that plan */
  function budgetTotal(b) { return ((b && b.months) || []).reduce(function (s, m) { return s + (Number(m && m.amount) || 0); }, 0); }
  document.addEventListener('change', function (e) {
    try {
      var t = e.target; if (!t || t.id !== 'projectTitle') return;
      var plan = (ls('plans', []) || []).find(function (p) { return p && p.title === t.value; }); if (!plan) return;
      var E = function (id) { return document.getElementById(id); };
      var setIfEmpty = function (id, v) { var el = E(id); if (el && v != null && v !== '' && !String(el.value || '').trim()) el.value = v; };
      var setPick = function (id, v) {
        var el = E(id); if (!el || !v) return;
        if (!el.options) return setIfEmpty(id, v);
        var o = Array.prototype.find.call(el.options, function (x) { return low(x.value) === low(v) || low(x.text) === low(v); }); if (o) el.value = o.value;
      };
      setPick('projectDepartment', plan.department); setPick('projectPriority', plan.priority);
      if (plan.startDate && E('projectStartDate')) E('projectStartDate').value = plan.startDate;
      if (plan.endDate && E('projectEndDate')) E('projectEndDate').value = plan.endDate;
      setIfEmpty('projectDescription', plan.description);
      var lb = low(plan.linkedBudget);
      if (lb) {
        var bud = (ls('budgets', []) || []).find(function (b) { var a = low(b.account), d = low(b.department); return lb === a || lb === d || lb === a + ' - ' + d || (a && lb.indexOf(a) === 0); });
        if (bud && E('projectBudget')) E('projectBudget').value = budgetTotal(bud);
      }
    } catch (err) { console.warn('[acacia-app-inbox] plan autofill', err); }
  }, true);

  function tick() { try { if (!document.body || !(w.__companyNS ? w.__companyNS.activeCompany() : true)) return; reconcile(); render(); } catch (e) { console.warn('[acacia-app-inbox]', e); } }
  setInterval(tick, 8000); setTimeout(tick, 3000);
  w.AcaciaAppInbox = { tick: tick, reconcile: reconcile };
})(window);
