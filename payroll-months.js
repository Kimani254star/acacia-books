/* payroll-months.js — Books: Earnings & Allowances per MONTH, and Gross Pay & Deductions picks up the
 * earnings of the payroll month you select.
 *
 * Load AFTER app-3.js (index.html already does this).
 *
 *  - Earnings & Allowances: new "Earnings for month" field, a Month column, a month filter and
 *    month grouping with a gross subtotal per month. One record per employee per month.
 *  - Records saved before this update have no month. They are shown as "Every month" and are still used
 *    as a fallback for any payroll month that has no record of its own. Edit one and pick a month to move it.
 *  - Gross Pay & Deductions: the payroll month now decides which month's earnings (gross + loan deductions)
 *    are used, in Save Payroll and in Bulk Add All Employees.
 *  - Also fixed on the way: Edit now loads the loan/deduction fields (they used to be zeroed on re-save),
 *    row buttons use the real record number (they were off by one once a draft existed), and
 *    Bulk Add no longer overwrites existing records with zeros.
 */
(function (w) {
  'use strict';
  var LS = w.localStorage;
  function ls(k, d) { try { var v = JSON.parse(LS.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { LS.setItem(k, JSON.stringify(v)); }
  function $(id) { return document.getElementById(id); }
  function dp() { return w.__getDecimalPlaces ? w.__getDecimalPlaces() : 2; }
  function num(v) { return parseFloat(v) || 0; }
  function kes(v) { return 'KES ' + num(v).toFixed(dp()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() { try { return w.crypto.randomUUID(); } catch (e) { return 'e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); } }
  function status(r) { return (r && r.status) || 'approved'; }

  function mLabel(m) {
    var x = /^(\d{4})-(\d{2})$/.exec(m || '');
    if (!x) return 'Every month';
    return new Date(+x[1], +x[2] - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' });
  }

  /* ---------- lookup used by payroll ---------- */
  /* exact month first, then a record with no month ("every month"). Drafts are never used. */
  function earningFor(empID, month) {
    var a = ls('earnings', []);
    if (!Array.isArray(a)) return null;
    a = a.filter(function (r) { return r && r.empID === empID && status(r) === 'approved'; });
    if (month) {
      var hit = a.filter(function (r) { return r.month === month; })[0];
      return hit || a.filter(function (r) { return !r.month; })[0] || null;
    }
    a.sort(function (x, y) { return String(y.month || '').localeCompare(String(x.month || '')); });
    return a[0] || null;
  }
  function monthsOf(empID) {
    var a = ls('earnings', []);
    return (Array.isArray(a) ? a : []).filter(function (r) { return r && r.empID === empID && status(r) === 'approved' && r.month; })
      .map(function (r) { return r.month; }).sort();
  }
  w.__earningFor = earningFor;

  /* give old records a stable id (needed for the Payroll app link and the recycle bin) */
  function ensureIds() {
    var a = ls('earnings', []);
    if (!Array.isArray(a)) return [];
    var ch = false;
    a.forEach(function (r) { if (r && !r.id) { r.id = uuid(); ch = true; } });
    if (ch) put('earnings', a);
    return a;
  }

  /* ---------- table ---------- */
  var sortKey = '', sortDir = 1;
  var SORT = { empID: 'empID', month: 'month', basic: 'basicPay', house: 'houseAllowance', transport: 'transportAllowance',
    overtime: 'overtimePay', bonus: 'bonusPay', other: 'otherBenefits', gross: 'grossPay' };

  function approvedRows() {
    var all = ls('earnings', []);
    if (!Array.isArray(all)) return [];
    return all.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return x.r && status(x.r) === 'approved'; });
  }
  function fillMonthFilter(rows) {
    var sel = $('earningsMonthFilter');
    if (!sel) return;
    var cur = sel.value, seen = {}, ms = [];
    rows.forEach(function (x) { var m = x.r.month || ''; if (!seen[m]) { seen[m] = 1; ms.push(m); } });
    ms.sort().reverse();
    var html = '<option value="">-- All Months --</option>' + ms.map(function (m) {
      return '<option value="' + esc(m) + '">' + esc(m ? mLabel(m) : 'Every month (no month set)') + '</option>';
    }).join('');
    if (sel.getAttribute('data-sig') !== html) { sel.innerHTML = html; sel.setAttribute('data-sig', html); }
    sel.value = ms.indexOf(cur) > -1 ? cur : '';
  }

  w.renderEarnings = function () {
    var tb = $('earningsTable');
    if (!tb) return;
    ensureIds();
    var all = approvedRows();
    fillMonthFilter(all);
    var f = ($('earningsMonthFilter') || {}).value || '';
    var rows = f ? all.filter(function (x) { return (x.r.month || '') === f; }) : all.slice();
    if (sortKey) {
      var k = SORT[sortKey];
      rows.sort(function (a, b) {
        var p = a.r[k], q = b.r[k], c;
        if (sortKey === 'empID' || sortKey === 'month') c = String(p || '').localeCompare(String(q || ''));
        else c = num(p) - num(q);
        return c * sortDir;
      });
    }
    tb.innerHTML = '';
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="12" class="p-3 text-center text-gray-500">No Earnings Found' + (f ? ' for ' + esc(mLabel(f)) : '') + '</td></tr>';
      return;
    }
    var groups = {}, order = [];
    rows.forEach(function (x) { var m = x.r.month || ''; if (!groups[m]) { groups[m] = []; order.push(m); } groups[m].push(x); });
    order.sort(function (a, b) { return a === '' ? 1 : b === '' ? -1 : b.localeCompare(a); });   /* newest month first, "every month" last */
    var T = { basic: 0, house: 0, transport: 0, overtime: 0, bonus: 0, other: 0, gross: 0, loans: 0 };
    var html = '';
    order.forEach(function (m) {
      var g = groups[m], gs = 0;
      g.forEach(function (x) { gs += num(x.r.grossPay); });
      html += '<tr class="bg-blue-50 font-semibold"><td colspan="12" class="p-2 text-blue-900">📅 ' + esc(m ? mLabel(m) : 'Every month (no month set)') +
        ' · ' + g.length + ' employee' + (g.length === 1 ? '' : 's') + ' · Gross ' + kes(gs) + '</td></tr>';
      g.forEach(function (x) {
        var r = x.r, i = x.i;
        T.basic += num(r.basicPay); T.house += num(r.houseAllowance); T.transport += num(r.transportAllowance);
        T.overtime += num(r.overtimePay); T.bonus += num(r.bonusPay); T.other += num(r.otherBenefits);
        T.gross += num(r.grossPay); T.loans += num(r.totalLoanDeductions);
        var tip = 'Sacco: ' + kes(r.saccoLoan) + ' | Company: ' + kes(r.companyLoan) + ' | HELB: ' + kes(r.helbLoan) + ' | Other: ' + kes(r.otherLoan);
        html += '<tr>' +
          '<td class="p-2 border"><input type="checkbox" class="earnings-select" data-index="' + i + '"></td>' +
          '<td class="p-2 border">' + esc(r.empID) + '</td>' +
          '<td class="p-2 border">' + esc(mLabel(r.month)) + '</td>' +
          '<td class="p-2 border">' + kes(r.basicPay) + '</td>' +
          '<td class="p-2 border">' + kes(r.houseAllowance) + '</td>' +
          '<td class="p-2 border">' + kes(r.transportAllowance) + '</td>' +
          '<td class="p-2 border">' + kes(r.overtimePay) + '</td>' +
          '<td class="p-2 border">' + kes(r.bonusPay) + '</td>' +
          '<td class="p-2 border">' + kes(r.otherBenefits) + '</td>' +
          '<td class="p-2 border font-bold">' + kes(r.grossPay) + '</td>' +
          '<td class="p-2 border text-orange-700" title="' + esc(tip) + '">' + kes(r.totalLoanDeductions) + '</td>' +
          '<td class="p-2 border text-center space-x-1">' +
          '<button onclick="previewEarning(' + i + ')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">Preview</button>' +
          '<button onclick="viewHistory(\'' + esc(String(r.empID).replace(/'/g, "\\'")) + '\')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">History</button>' +
          '<button onclick="editEarning(' + i + ')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">Edit</button>' +
          '<button onclick="deleteEarning(' + i + ')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">Delete</button>' +
          '</td></tr>';
      });
    });
    html += '<tr class="bg-gray-200 text-black font-bold"><td class="p-2 border">TOTAL</td><td class="p-2 border"></td><td class="p-2 border"></td>' +
      '<td class="p-2 border">' + kes(T.basic) + '</td><td class="p-2 border">' + kes(T.house) + '</td><td class="p-2 border">' + kes(T.transport) + '</td>' +
      '<td class="p-2 border">' + kes(T.overtime) + '</td><td class="p-2 border">' + kes(T.bonus) + '</td><td class="p-2 border">' + kes(T.other) + '</td>' +
      '<td class="p-2 border text-blue-900">' + kes(T.gross) + '</td><td class="p-2 border text-orange-700">' + kes(T.loans) + '</td><td class="p-2 border"></td></tr>';
    tb.innerHTML = html;
    var tc = $('totalCount'); if (tc && $('earningsTab') && $('earningsTab').contains(tc)) tc.textContent = rows.length;
    try { if (typeof w.renderOvertimeSummary === 'function' && $('overtimeSummaryBody')) w.renderOvertimeSummary(); } catch (e) { /* optional panel */ }
  };

  w.sortEarnings = function (key) {
    if (!SORT[key]) return;
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
    w.renderEarnings();
    var dd = $('earningsDropdown'); if (dd) dd.classList.add('hidden');
  };
  w.resetEarnings = function () {
    sortKey = ''; sortDir = 1;
    var s = $('earningsSearch'); if (s) s.value = '';
    var f = $('earningsMonthFilter'); if (f) f.value = '';
    w.renderEarnings();
    var dd = $('earningsDropdown'); if (dd) dd.classList.add('hidden');
  };
  w.exportEarningsCSV = function () {
    var f = ($('earningsMonthFilter') || {}).value || '';
    var rows = approvedRows().filter(function (x) { return !f || (x.r.month || '') === f; });
    var head = ['Employee ID', 'Month', 'Basic', 'House', 'Transport', 'Overtime', 'Bonus', 'Other', 'Gross', 'Sacco Loan', 'Company Loan', 'HELB', 'Other Loan', 'Total Loan Deductions'];
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var lines = [head.map(q).join(',')];
    rows.forEach(function (x) {
      var r = x.r;
      lines.push([r.empID, r.month || '', r.basicPay, r.houseAllowance, r.transportAllowance, r.overtimePay, r.bonusPay, r.otherBenefits, r.grossPay,
        r.saccoLoan, r.companyLoan, r.helbLoan, r.otherLoan, r.totalLoanDeductions].map(function (v, n) { return n < 2 ? q(v) : q(num(v).toFixed(dp())); }).join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'earnings' + (f ? '-' + f : '') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  /* ---------- save / edit / delete ---------- */
  var FIELDS = ['basicPay', 'houseAllowance', 'transportAllowance', 'overtimePay', 'bonusPay', 'otherBenefits', 'saccoLoan', 'companyLoan', 'helbLoan', 'otherLoan'];
  function formRecord() {
    var r = { empID: $('earningsEmpID').value, month: ($('earningsMonth') || {}).value || '' };
    FIELDS.forEach(function (f) { r[f] = num($(f).value); });
    return finish(r);
  }
  function finish(r) {
    r.grossPay = num(r.basicPay) + num(r.houseAllowance) + num(r.transportAllowance) + num(r.overtimePay) + num(r.bonusPay) + num(r.otherBenefits);
    r.totalLoanDeductions = num(r.saccoLoan) + num(r.companyLoan) + num(r.helbLoan) + num(r.otherLoan);
    return r;
  }
  function clearForm() {
    FIELDS.concat(['Grosspay']).forEach(function (id) { var el = $(id); if (el) el.value = ''; });
    $('earningsEmpID').value = '';
    var ix = $('earningsEditIndex'); if (ix) ix.value = '';
    /* the month stays selected so a whole month can be entered employee after employee */
  }
  function needFields() {
    if (!$('earningsEmpID').value) { alert('⚠️ Please select an employee!'); return false; }
    if (!($('earningsMonth') || {}).value) { alert('⚠️ Please select the month these earnings are for!'); return false; }
    return true;
  }

  w.saveEarnings = function () {
    var ix = $('earningsEditIndex') ? $('earningsEditIndex').value : '';
    if (!w.requirePermission('earningsTab', ix === '' ? 'add' : 'edit', ix === '' ? 'add earnings' : 'edit earnings')) return;
    if (!needFields()) return;
    var rec = formRecord(); rec.status = 'approved';
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var dup = -1;
    list.forEach(function (r, i) { if (r && r.empID === rec.empID && r.month === rec.month && String(i) !== String(ix)) dup = i; });
    if (ix !== '') {
      if (dup > -1 && !confirm('Earnings for ' + rec.empID + ' already exist for ' + mLabel(rec.month) + '. Replace them with this record?')) return;
      var old = list[parseInt(ix, 10)];
      rec.id = (old && old.id) || uuid();
      list[parseInt(ix, 10)] = rec;
      if (dup > -1) list.splice(dup, 1);
    } else if (dup > -1) {
      rec.id = list[dup].id || uuid();
      list[dup] = rec;
    } else { rec.id = uuid(); list.push(rec); }
    put('earnings', list);
    clearForm();
    w.renderEarnings();
  };

  w.saveEarningsDraft = function () {
    if (!needFields()) return;
    var rec = formRecord(); rec.status = 'draft'; rec.id = uuid();
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var ix = $('earningsEditIndex').value;
    if (ix !== '') { var old = list[parseInt(ix, 10)]; rec.id = (old && old.id) || rec.id; list[parseInt(ix, 10)] = rec; } else list.push(rec);
    put('earnings', list);
    clearForm();
    w.renderEarnings();
    alert('📄 Saved as Draft (awaiting approval)');
  };

  w.editEarning = function (i) {
    if (!w.requirePermission('earningsTab', 'edit', 'edit earnings')) return;
    var t = (ls('earnings', []) || [])[i];
    if (!t) return;
    $('earningsEmpID').value = t.empID;
    var mo = $('earningsMonth'); if (mo) mo.value = t.month || '';
    FIELDS.forEach(function (f) { $(f).value = t[f] == null ? '' : t[f]; });
    $('Grosspay').value = num(t.grossPay).toFixed(dp());
    $('earningsEditIndex').value = i;
    try { $('earningsEmpID').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
  };

  w.bulkAddEarnings = function () {
    var m = ($('earningsMonth') || {}).value || '';
    if (!m) return alert('⚠️ Select the month in "Earnings for month" first, then click Bulk Add.');
    var emps = ls('employees', []);
    if (!emps.length) return alert('⚠️ No employees found!');
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var added = 0, skipped = 0;
    emps.forEach(function (e) {
      if (list.some(function (r) { return r && r.empID === e.id && r.month === m; })) { skipped++; return; }
      /* start from the employee's most recent earlier month (basic, allowances, loans); overtime and bonus start at 0 */
      var prev = list.filter(function (r) { return r && r.empID === e.id && status(r) === 'approved' && (!r.month || r.month < m); })
        .sort(function (a, b) { return String(b.month || '').localeCompare(String(a.month || '')); })[0];
      var rec = { id: uuid(), empID: e.id, month: m, status: 'approved', overtimePay: 0, bonusPay: 0,
        basicPay: prev && num(prev.basicPay) > 0 ? num(prev.basicPay) : num(e.salary),
        houseAllowance: prev ? num(prev.houseAllowance) : 0, transportAllowance: prev ? num(prev.transportAllowance) : 0,
        otherBenefits: prev ? num(prev.otherBenefits) : 0, saccoLoan: prev ? num(prev.saccoLoan) : 0,
        companyLoan: prev ? num(prev.companyLoan) : 0, helbLoan: prev ? num(prev.helbLoan) : 0, otherLoan: prev ? num(prev.otherLoan) : 0 };
      list.push(finish(rec)); added++;
    });
    put('earnings', list);
    w.renderEarnings();
    alert('✅ ' + mLabel(m) + ': ' + added + ' employee(s) added' + (skipped ? ', ' + skipped + ' already had earnings for this month (left unchanged).' : '.'));
  };

  w.deleteEarning = function (i) {
    if (!w.requirePermission('earningsTab', 'delete', 'delete earnings')) return;
    var list = ls('earnings', []), a = list[i];
    if (!a) return;
    var emp = (ls('employees', []).filter(function (e) { return e.id === a.empID; })[0] || {}).name || a.empID;
    if (!confirm('⚠️ Are you sure you want to delete the ' + mLabel(a.month) + ' earning for "' + emp + '"?')) return;
    if (!a.id) a.id = uuid();
    if (w.moveToRecycle) w.moveToRecycle(a, 'File', 'Earnings');
    list.splice(i, 1);
    put('earnings', list);
    w.renderEarnings();
    alert('♻️ Earning record moved to Recycle Bin.');
  };

  w.bulkDeleteEarnings = function () {
    var list = ls('earnings', []);
    var sel = document.querySelectorAll('.earnings-select:checked');
    if (!sel.length) return alert('Please select at least one record.');
    Array.prototype.map.call(sel, function (c) { return Number(c.dataset.index); }).sort(function (a, b) { return b - a; })
      .forEach(function (i) { list.splice(i, 1); });
    put('earnings', list);
    w.renderEarnings();
  };

  /* ---------- history / preview ---------- */
  w.viewHistory = function (empID) {
    var a = (ls('earnings', []) || []).filter(function (r) { return r && r.empID === empID && status(r) === 'approved'; })
      .sort(function (x, y) { return String(y.month || '').localeCompare(String(x.month || '')); });
    if (!a.length) return alert('No history found for this employee.');
    var t = 'Earnings History for ' + empID + '\n\n';
    a.forEach(function (r) { t += mLabel(r.month) + '\nGross Pay: ' + kes(r.grossPay) + '\nLoan Deductions: ' + kes(r.totalLoanDeductions) + '\n-----------------------------\n'; });
    alert(t);
  };
  w.renderEarningsHistoryTab = function (empID) {
    var box = $('earningsHistoryList'); if (!box) return;
    var a = (ls('earnings', []) || []).filter(function (r) { return r && r.empID === empID && status(r) === 'approved'; })
      .sort(function (x, y) { return String(y.month || '').localeCompare(String(x.month || '')); });
    box.innerHTML = a.length ? a.map(function (r) {
      return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;"><span>Gross Pay: ' + kes(r.grossPay) +
        '</span><span style="color:#6b7280;">' + esc(mLabel(r.month)) + '</span></div>';
    }).join('') : '<p style="color:#9ca3af;">No history recorded yet.</p>';
  };
  var _preview = w.previewEarning;
  if (typeof _preview === 'function') {
    w.previewEarning = function (i) {
      _preview.apply(this, arguments);
      try {
        var t = (ls('earnings', []) || [])[i], panel = $('earningsPreviewPanel');
        if (!t || !panel) return;
        Array.prototype.forEach.call(panel.querySelectorAll('p'), function (p) {
          if (/^Employee ID:/.test(p.textContent) && !/Month:/.test(p.textContent)) p.textContent += ' · Month: ' + mLabel(t.month);
        });
      } catch (e) { /* cosmetic only */ }
    };
  }

  /* ---------- Gross Pay & Deductions: use the payroll month's earnings ---------- */
  w.getEmployeeLoanDeductions = function (empID, month) {
    month = month || ($('payrollMonth') || {}).value || '';
    var t = earningFor(empID, month);
    if (!t) return { saccoLoan: 0, companyLoan: 0, helbLoan: 0, otherLoan: 0, total: 0 };
    var a = num(t.saccoLoan), b = num(t.companyLoan), c = num(t.helbLoan), d = num(t.otherLoan);
    return { saccoLoan: a, companyLoan: b, helbLoan: c, otherLoan: d, total: a + b + c + d };
  };

  function hintEl() { return $('payrollEarningsHint'); }
  w.autoFillGrossFromEarnings = function () {
    var emp = ($('payrollEmpID') || {}).value || '', m = ($('payrollMonth') || {}).value || '';
    var gross = $('payrollGross'), ded = $('payrollDeductions'), br = $('deductionBreakdown'), hint = hintEl();
    function clear(msg) { if (gross) gross.value = ''; if (ded) ded.value = ''; if (br) br.innerText = msg || ''; var np = $('payrollNetPayPreview'); if (np) np.innerText = ''; }
    if (hint) hint.textContent = '';
    if (!emp) return clear('');
    if (!m) return clear('Select the payroll month — the earnings recorded for that month are used.');
    var t = earningFor(emp, m);
    if (!t) {
      var ms = monthsOf(emp);
      return clear('No earnings recorded for ' + mLabel(m) + ' for this employee.' + (ms.length ? ' Recorded months: ' + ms.map(mLabel).join(', ') + '.' : '') +
        ' Add them under Earnings & Allowances (pick the month) first.');
    }
    gross.value = num(t.grossPay).toFixed(dp());
    if (typeof w.updateAutoDeductions === 'function') w.updateAutoDeductions();
    if (hint) {
      var done = (ls('payrollRecords', []) || []).some(function (r) { return r && r.empID === emp && r.month === m; });
      hint.textContent = 'Using ' + (t.month ? mLabel(t.month) : 'standing (every month)') + ' earnings — gross ' + kes(t.grossPay) +
        (num(t.totalLoanDeductions) ? ', loan deductions ' + kes(t.totalLoanDeductions) : '') + '.' +
        (done ? ' ⚠️ Payroll for this employee is already saved for ' + mLabel(m) + '.' : '');
    }
  };

  /* ---------- start-up ---------- */
  function init() {
    ensureIds();
    if ($('earningsTable')) w.renderEarnings();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
})(window);
