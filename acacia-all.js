
/* ######## acacia-tombstones.js ######## */
/* acacia-tombstones.js
 * Deletion tombstones so deleted records never come back after cloud sync,
 * a missing __syncbase_ baseline, or restoring an old Google backup.
 *
 * - Captures deletions automatically via __companyNS.onSetItem (listener gets key,newValue,oldValue).
 * - Stored as the per-company key "tombstones" => syncs through company_state like any other key.
 * - Shape: { "<collection>": { "<ident>": [timestampMs, 1|0] } }   1 = deleted, 0 = revived (Recycle-Bin restore / re-added)
 * - Newest timestamp wins when two copies are merged.
 * - Hooks called from app-3.js: filterVal, cleanKey, remote, snapshot.
 */
(function () {
  'use strict';
  if (window.__acxTomb) return;
  var KEY = 'tombstones';
  var IDF = ['id', '_id', 'uuid', 'invoiceNumber', 'billNumber', 'quoteNumber', 'orderNumber', 'receiptNumber', 'poNumber', 'grnNumber', 'sku']; // same order as sync ident()
  var SKIP = /(^|[_:])(audit|logs?|notif|notifications|history|session|cache|draft|recent|activity|backup|stamps?|tombstones)/i;
  var DEL_KEEP = 365 * 864e5, REV_KEEP = 30 * 864e5, MAX_ENTRIES = 20000;
  var pending = Object.create(null), timer = null;

  function ns() { return window.__companyNS; }
  function now() { return Date.now() + (window.__acxClockOffset || 0); }
  function comp() { try { var n = ns(); return n && n.activeCompany ? n.activeCompany() : null; } catch (e) { return null; } }
  function rawGet(k) { var n = ns(), c = comp(); if (!n || !c) return null; try { return n.nGet.call(n.real, k + n.SEP + c); } catch (e) { return null; } }
  function rawSet(k, v) { var n = ns(), c = comp(); if (!n || !c) return; try { n.nSet.call(n.real, k + n.SEP + c, v); } catch (e) {} }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function parse(s) { if (typeof s !== 'string' || s.charAt(0) !== '[') return null; try { var a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch (e) { return null; } }
  function parseT(s) { if (typeof s !== 'string') return {}; try { var o = JSON.parse(s); return isObj(o) ? o : {}; } catch (e) { return {}; } }
  function ident(r) {
    if (!isObj(r)) return null;
    for (var i = 0; i < IDF.length; i++) { var v = r[IDF[i]]; if (v != null && v !== '' && typeof v !== 'object') return 'i:' + IDF[i] + ':' + String(v); }
    return null; // hash-only records are not tombstoned
  }
  function trackable(k) {
    k = String(k);
    if (!k || k === KEY || SKIP.test(k) || k.indexOf('__') === 0) return false;
    var n = ns(); try { if (n && n.isGlobal && n.isGlobal(k)) return false; } catch (e) {}
    return true;
  }
  function loadT() { return parseT(rawGet(KEY)); }
  function saveT(t, touch) {
    prune(t);
    var s = JSON.stringify(t);
    if (s === rawGet(KEY)) return;
    // use the virtual localStorage so the normal dirty/push flow marks it for sync
    if (touch !== false) { try { window.localStorage.setItem(KEY, s); return; } catch (e) {} }
    rawSet(KEY, s);
  }
  function prune(t) {
    var cut = now(), total = 0, cols = Object.keys(t);
    cols.forEach(function (c) {
      var m = t[c];
      Object.keys(m).forEach(function (id) {
        var e = m[id], age = cut - e[0];
        if ((e[1] ? age > DEL_KEEP : age > REV_KEEP)) delete m[id]; else total++;
      });
      if (!Object.keys(m).length) delete t[c];
    });
    if (total > MAX_ENTRIES) { // drop oldest revived first, then oldest deleted
      var all = [];
      Object.keys(t).forEach(function (c) { Object.keys(t[c]).forEach(function (id) { all.push([c, id, t[c][id]]); }); });
      all.sort(function (a, b) { return (a[2][1] - b[2][1]) || (a[2][0] - b[2][0]); });
      for (var i = 0; i < all.length - MAX_ENTRIES; i++) { delete t[all[i][0]][all[i][1]]; }
    }
  }
  function mergeT(a, b) { // newest timestamp wins; tie => deleted wins
    var out = {};
    [a, b].forEach(function (src) {
      Object.keys(src || {}).forEach(function (c) {
        if (!isObj(src[c])) return;
        out[c] = out[c] || {};
        Object.keys(src[c]).forEach(function (id) {
          var e = src[c][id]; if (!Array.isArray(e)) return;
          var cur = out[c][id];
          if (!cur || e[0] > cur[0] || (e[0] === cur[0] && e[1] > cur[1])) out[c][id] = [e[0], e[1] ? 1 : 0];
        });
      });
    });
    return out;
  }
  function deadSet(t, col) {
    var m = t && t[col], s = null;
    if (!m) return null;
    Object.keys(m).forEach(function (id) { if (m[id][1]) { s = s || Object.create(null); s[id] = 1; } });
    return s;
  }
  function filterArr(arr, dead) {
    var out = [], n = 0;
    for (var i = 0; i < arr.length; i++) { var id = ident(arr[i]); if (id && dead[id]) n++; else out.push(arr[i]); }
    return { arr: out, n: n };
  }

  /* ---------- capture ---------- */
  function diff(key, oldS, newS) {
    var o = parse(oldS), n = parse(newS);
    if (!o || !n) return;
    var nowIds = Object.create(null), added = [], removed = [], i, id;
    for (i = 0; i < n.length; i++) { id = ident(n[i]); if (id) nowIds[id] = 1; }
    var oldIds = Object.create(null);
    for (i = 0; i < o.length; i++) { id = ident(o[i]); if (id) { oldIds[id] = 1; if (!nowIds[id]) removed.push(id); } }
    for (id in nowIds) if (!oldIds[id]) added.push(id);
    if (!removed.length && !added.length) return;
    var t = loadT(), ts = now(), changed = false, m = t[key] || (t[key] = {});
    removed.forEach(function (x) { m[x] = [ts, 1]; changed = true; });
    added.forEach(function (x) { if (m[x] && m[x][1]) { m[x] = [ts, 0]; changed = true; } }); // Recycle-Bin restore / re-created
    if (changed) saveT(t);
  }
  function flush() {
    var p = pending; pending = Object.create(null); clearTimeout(timer); timer = null;
    Object.keys(p).forEach(function (k) { try { diff(k, p[k].o, p[k].n); } catch (e) { console.warn('[tombstones] diff', k, e); } });
  }
  function onSet(key, newV, oldV) {
    if (typeof newV !== 'string' || typeof oldV !== 'string' || newV === oldV) return;
    if (newV.charAt(0) !== '[' || oldV.charAt(0) !== '[') return;
    if (!trackable(key)) return;
    var p = pending[key];
    if (p) p.n = newV; else pending[key] = { o: oldV, n: newV };
    if (!timer) timer = setTimeout(flush, 300);
  }

  /* ---------- hooks used by app-3.js ---------- */
  // remote collection value -> filtered value (never mutates input)
  function filterVal(key, val) {
    try {
      if (typeof val !== 'string' || val.charAt(0) !== '[' || key === KEY) return { v: val, n: 0 };
      flush();
      var dead = deadSet(loadT(), key); if (!dead) return { v: val, n: 0 };
      var a = parse(val); if (!a) return { v: val, n: 0 };
      var r = filterArr(a, dead);
      return r.n ? { v: JSON.stringify(r.arr), n: r.n } : { v: val, n: 0 };
    } catch (e) { return { v: val, n: 0 }; }
  }
  // purge tombstoned records from the LOCAL copy of one collection (silent: no listeners, no re-tombstoning)
  function cleanKey(key, e) {
    try {
      if (key === KEY) return 0;
      flush();
      var dead = deadSet(loadT(), key); if (!dead) return 0;
      var cur = rawGet(key), a = parse(cur); if (!a) return 0;
      var r = filterArr(a, dead); if (!r.n) return 0;
      var n = ns(); n.setApplying && n.setApplying(true);
      try { rawSet(key, JSON.stringify(r.arr)); } finally { n.setApplying && n.setApplying(false); }
      return r.n;
    } catch (x) { console.warn('[tombstones] cleanKey', key, x); return 0; }
  }
  // incoming "tombstones" value from the cloud: merge (never overwrite), then purge every local collection
  function remote(val, e) {
    var res = { changed: [], pushBack: false };
    try {
      flush();
      var local = loadT(), inc = parseT(val), merged = mergeT(local, inc);
      var s = JSON.stringify(merged), n = ns();
      if (s !== rawGet(KEY)) { n.setApplying && n.setApplying(true); try { rawSet(KEY, s); } finally { n.setApplying && n.setApplying(false); } }
      if (s !== JSON.stringify(inc)) { try { e.dirty[KEY] = 1; } catch (x) {} res.pushBack = true; }
      Object.keys(merged).forEach(function (col) { if (cleanKey(col, e)) { res.changed.push(col); try { e.dirty[col] = 1; } catch (x) {} } });
    } catch (x) { console.warn('[tombstones] remote', x); }
    return res;
  }
  // Google Backup restore: merge the backup's tombstones into local, then strip dead records out of the backup data
  function snapshot(t, companyId, e) {
    try {
      if (!t || !t.data) return;
      flush();
      var local = loadT(), bk = parseT(t.data[KEY]), merged = mergeT(local, bk), s = JSON.stringify(merged), n = ns();
      delete t.data[KEY];
      if (t.stamps) delete t.stamps[KEY];
      Object.keys(t.data).forEach(function (k) {
        var dead = deadSet(merged, k); if (!dead) return;
        var a = parse(t.data[k]); if (!a) return;
        var r = filterArr(a, dead); if (r.n) t.data[k] = JSON.stringify(r.arr);
      });
      if (s !== rawGet(KEY)) {
        rawSet(KEY, s);
        setTimeout(function () { try { n.touch && n.touch(KEY); } catch (x) {} }, 0); // mark for cloud push after applying flag clears
      }
      Object.keys(merged).forEach(function (col) { cleanKey(col, e); }); // local collections not in the backup
    } catch (x) { console.warn('[tombstones] snapshot', x); }
  }

  window.__acxTomb = { filterVal: filterVal, cleanKey: cleanKey, remote: remote, snapshot: snapshot, flush: flush, _ident: ident, _merge: mergeT };

  function hook() {
    var n = ns();
    if (!n || !n.onSetItem) return false;
    n.onSetItem(onSet);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
    return true;
  }
  if (!hook()) { var tries = 0, iv = setInterval(function () { if (hook() || ++tries > 50) clearInterval(iv); }, 200); }
})();


/* ######## acacia-bill-fx.js ######## */
/* ============================================================================
   acacia-bill-fx.js
   1) Currency Adjustment driven by BILL PAYMENTS
      - a bill remembers the exchange rate it was booked at (bill.currencyRate)
      - when the bill is paid, the payment is taken at the rate of that day
      - the difference is a realised exchange gain / loss and is written to the
        Currency Adjustment sub-module (localStorage "currencyAdjustments"),
        from where the Profit & Loss "Currency Adjustment" line and the Balance
        Sheet pick it up.
      - the adjustments are DERIVED from billPayments, so reversing / deleting /
        editing a payment automatically corrects (or removes) its adjustment.
   2) Retained Earnings computed by the Balance Sheet are shown on the Equity
      table (and the Retained Earnings table) and follow every Balance Sheet
      update.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__acxBillFxLoaded) return;
  window.__acxBillFxLoaded = true;

  var LS = window.localStorage;
  function J(k, d) { try { var v = JSON.parse(LS.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function up(v) { v = String(v || "").toUpperCase(); return v === "KSH" || v === "KSHS" ? "KES" : v; }
  function baseCur() { try { return up(window.__getBaseCurrencyEarly ? window.__getBaseCurrencyEarly() : (LS.getItem("appBaseCurrency") || "KES")) || "KES"; } catch (e) { return "KES"; } }
  function dp() { try { return window.__getDecimalPlaces ? window.__getDecimalPlaces() : 2; } catch (e) { return 2; } }
  function money(v) { var d = dp(); return Number(v).toLocaleString(void 0, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function todayISO() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }

  /* ---------- exchange rate helpers ---------- */
  // 1 unit of `cur` expressed in base currency, from the live/stored exchange rates
  window.acxLiveRate = function (cur, fallback) {
    cur = up(cur);
    var base = baseCur();
    if (!cur || cur === base) return 1;
    var v = NaN;
    try { v = window.__cvBase ? Number(window.__cvBase(1, cur)) : NaN; } catch (e) {}
    if (isFinite(v) && v > 0 && Math.abs(v - 1) > 1e-9) return Math.round(v * 10000) / 10000;
    return num(fallback) > 0 ? num(fallback) : 1;
  };
  function isForeign(bill) {
    if (!bill) return false;
    var c = up(bill.currency || baseCur());
    return c !== baseCur() && num(bill.currencyRate) > 0;
  }
  window.acxBillById = function (id) {
    var list = [];
    try { list = typeof window.getBillsWithIds === "function" ? window.getBillsWithIds() : J("bills", []); } catch (e) { list = J("bills", []); }
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  };
  window.acxBillRateDefault = function (bill) {
    if (!isForeign(bill)) return 1;
    return window.acxLiveRate(bill.currency, bill.currencyRate);
  };
  window.acxBillRateLabel = function (bill) {
    if (!isForeign(bill)) return "Exchange Rate (to KES, leave 1 if KES):";
    var cur = up(bill.currency), base = baseCur();
    return "Exchange rate today: 1 " + cur + " = ? " + base + " <span style=\"color:#6b7280\">(bill was booked at " + num(bill.currencyRate) +
      "). Any difference is posted to Currency Adjustment.</span>";
  };

  /* Work out a payment of `p` (base currency, clears the bill at its booked
     value) plus `y` (base currency, over-payment / prepayment) made when the
     bill currency trades at `h`. Returns null for base-currency bills.        */
  window.acxBillPayCalc = function (bill, bank, p, y, h) {
    if (!isForeign(bill)) return null;
    var base = baseCur(), cur = up(bill.currency), c = num(bill.currencyRate);
    h = num(h) > 0 ? num(h) : c;
    p = num(p); y = num(y);
    var foreign = p / c;                 // amount of the bill currency being settled
    var costBase = foreign * h;          // what it really costs in base currency today
    var bankCur = up((bank && bank.currency) || base);
    var bankRate = bankCur === base ? 1 : bankCur === cur ? h : (num(bank && bank.rateToKES) || window.acxLiveRate(bankCur, 1));
    var deduct = r2((costBase + y) / (bankRate > 0 ? bankRate : 1));
    return { cur: cur, billRate: c, payRate: h, foreign: foreign, baseCost: costBase, fx: costBase - p, bankDeduct: deduct };
  };

  /* ---------- Currency Adjustment sync (derived from bill payments) ---------- */
  var syncing = false;
  window.acxSyncBillFx = function () {
    if (syncing) return false;
    syncing = true;
    try {
      var pays = J("billPayments", []), cur = J("currencyAdjustments", []);
      var auto = [];
      pays.forEach(function (p) {
        if (!p || !p.billCurrency || !(num(p.payRate) > 0) || !(num(p.billRate) > 0)) return;
        var amt = num(p.amount);
        if (amt <= 0) return;
        var c = num(p.billRate), h = num(p.payRate);
        var foreign = amt / c, diff = foreign * h - amt;        // >0 = loss (we paid more base currency)
        if (Math.abs(diff) < 0.005) return;
        var loss = diff > 0, a = Math.abs(diff), bank = p.bank || "Bank";
        auto.push({
          id: "billfx-" + (p.id || (p.billNumber + "-" + p.date)),
          auto: true, source: "billPayment", paymentId: p.id, billNumber: p.billNumber, supplier: p.supplier,
          date: p.date, bank: bank, account: "Currency Gain/(Loss)", currency: p.billCurrency, type: "Realized",
          balance: foreign, oldRate: c, rate: h, amount: -diff, converted: -diff,
          note: "Bill " + (p.billNumber || "") + (p.supplier ? " – " + p.supplier : "") + ": booked at " + c + ", paid at " + h,
          journal: loss
            ? [{ account: "Accounts Payable", debit: amt, credit: 0 }, { account: "Currency Gain/(Loss)", debit: a, credit: 0 }, { account: bank, debit: 0, credit: amt + a }]
            : [{ account: "Accounts Payable", debit: amt, credit: 0 }, { account: "Currency Gain/(Loss)", debit: 0, credit: a }, { account: bank, debit: 0, credit: amt - a }]
        });
      });
      var kept = cur.filter(function (a) { return !(a && a.auto && a.source === "billPayment"); });
      var next = kept.concat(auto);
      if (JSON.stringify(next) === JSON.stringify(cur)) return false;
      LS.setItem("currencyAdjustments", JSON.stringify(next));
      ["updateTotalCurrencyAdjustment", "renderCurrencyAdjustments", "renderProfitLoss", "renderBalanceSheet", "renderBankTable"].forEach(function (fn) {
        try { if (typeof window[fn] === "function") window[fn](); } catch (e) {}
      });
      return true;
    } catch (e) {
      console.warn("[bill-fx] sync failed", e);
      return false;
    } finally { syncing = false; }
  };

  // any other code path that rewrites bill payments (prepayments, undo, cloud sync...) also re-syncs
  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { window.acxSyncBillFx(); }, 60); }
  try {
    var origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k) {
      var r = origSet.apply(this, arguments);
      if (this === LS && (k === "billPayments")) schedule();
      return r;
    };
  } catch (e) {}

  /* ---------- Balance Sheet / Equity table link ---------- */
  window.__acxFrOwnsBS = function () {
    var t = document.getElementById("balanceSheetTable");
    return !!(t && t.classList.contains("fr-tbl"));
  };

  function retained() {
    var st = window.__acxBsRetained || null;
    var asAt = (st && st.asAt) || todayISO();
    var total = null;
    try { if (window.FR && typeof window.FR.bs === "function") total = num(window.FR.bs(asAt).earnings); } catch (e) {}
    if (total == null) { if (!st) return null; total = num(st.total); }
    var prior = st && st.asAt === asAt ? num(st.prior) : 0;
    return { asAt: asAt, total: total, prior: prior, current: total - prior };
  }

  function equityRecordsTotal() {
    return J("equityRecords", []).reduce(function (s, r) { return s + num(r && r.value); }, 0);
  }

  var RE_ROW = "acx-re-row";
  function rowHtml(kind, r) {
    var desc = "Calculated by the Balance Sheet" + (Math.abs(r.prior) > 0.004 ? " — prior periods " + money(r.prior) + " + this period " + money(r.current) : " — profit/(loss) to date");
    if (kind === "retainedEarningsBody") {
      return '<td class="p-2 border">Retained Earnings (Balance Sheet)</td><td class="p-2 border">' + desc + '</td><td class="p-2 border">Retained Earnings</td><td class="p-2 border text-right">' + money(r.total) + "</td>";
    }
    return '<td class="p-3"></td><td class="p-3 font-mono text-sm text-gray-500">AUTO</td>' +
      '<td class="p-3 font-semibold text-gray-900">Retained Earnings <span class="ml-1 text-sm bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">from Balance Sheet</span></td>' +
      '<td class="p-3 text-gray-600">' + r.asAt + "</td>" +
      '<td class="p-3 text-right font-mono font-medium text-gray-800">' + money(r.total) + "</td>" +
      '<td class="p-3 text-gray-500">' + desc + "</td>" +
      '<td class="p-3"><span class="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium text-sm">Retained Earnings (calculated)</span></td>' +
      '<td class="p-3 text-center text-gray-400 text-sm">Auto</td>';
  }

  var observers = {};
  function paint(id) {
    var tb = document.getElementById(id);
    if (!tb) return;
    var r = retained();
    if (observers[id]) observers[id].disconnect();
    try {
      var old = tb.querySelector("." + RE_ROW);
      if (old) old.remove();
      if (r) {
        var tr = document.createElement("tr");
        tr.className = RE_ROW + " bg-blue-50/40";
        tr.innerHTML = rowHtml(id, r);
        if (id === "retainedEarningsBody") {
          // replace the "No retained earnings available" placeholder
          Array.prototype.forEach.call(tb.querySelectorAll("tr"), function (x) { if (/No retained earnings/i.test(x.textContent)) x.remove(); });
        }
        tb.appendChild(tr);
        if (id === "equityTableBody") {
          var tot = equityRecordsTotal() + r.total;
          var f = document.getElementById("equityFooterAmountTotal");
          if (f) f.textContent = money(tot);
          var card = document.getElementById("equityTotalValueCard");
          if (card) card.textContent = "KES " + money(tot);
        }
      }
    } catch (e) { console.warn("[bill-fx] retained row failed", e); }
    watch(id);
  }
  function watch(id) {
    var tb = document.getElementById(id);
    if (!tb || !window.MutationObserver) return;
    if (!observers[id]) {
      observers[id] = new MutationObserver(function () {
        if (!tb.querySelector("." + RE_ROW)) paint(id);
      });
    }
    observers[id].observe(tb, { childList: true });
  }
  function paintAll() { paint("equityTableBody"); paint("retainedEarningsBody"); }

  document.addEventListener("acx:bs-rendered", paintAll);
  function boot() {
    paintAll();
    window.acxSyncBillFx();
    // tabs render lazily — keep trying until the tables exist
    var tries = 0, iv = setInterval(function () {
      tries++;
      if (document.getElementById("equityTableBody") && !observers.equityTableBody) paint("equityTableBody");
      if (document.getElementById("retainedEarningsBody") && !observers.retainedEarningsBody) paint("retainedEarningsBody");
      if (tries > 40) clearInterval(iv);
    }, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);
})();


/* ######## acacia-bill-batch.js ######## */
/* ============================================================================
   acacia-bill-batch.js
   Product lines on Bills, Bulk Bills and Recurring Bills can now put the
   received stock into a BATCH:
     - pick one of the item's existing batches, or
     - choose "New batch" and type the batch number (+ optional mfg / expiry).
   On save the quantity is added to that batch (created if new) and the item
   total is raised as before. Deleting / editing a bill takes it back off the
   same batch. Only Product lines are affected (other item types never touch
   stock). Load AFTER app-2.js / app-3.js.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__acxBillBatchLoaded) return;
  window.__acxBillBatchLoaded = true;

  var NEW = "__new__";
  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ---------- stock side: add / remove quantity on a batch ---------- */
  window.__acxBatchAdj = function (item, line, sign) {
    try {
      if (!item || !line || !line.batch) return;
      if (typeof window.__acxLineStock === "function" && !window.__acxLineStock(line)) return;   // only Product lines touch stock/batches
      var b0 = line.batch;
      var no = String(b0.batchNo || b0.batch || "").trim();
      if (!no) return;
      var qty = num(line.qty);
      if (!Array.isArray(item.batches)) item.batches = [];

      var b = item.batches.find(function (x) { return String(x.batchNo || x.batch || "").trim() === no; });
      if (!b) {
        if (sign <= 0) return;                       // nothing to take off
        // first tracked batch on an item that already held untracked stock:
        // keep that stock visible, otherwise the batch total would hide it
        if (item.batches.length === 0) {
          var prior = num(item.qty) - qty;          // item.qty already includes this line
          if (prior > 0.0000001) item.batches.push({ batchNo: "Opening stock", mfgDate: "", expiryDate: "", qty: prior });
        }
        b = { batchNo: no, mfgDate: b0.mfg || b0.mfgDate || "", expiryDate: b0.expiry || b0.expiryDate || "", qty: 0 };
        item.batches.push(b);
      } else if (sign > 0) {
        if (!b.expiryDate && (b0.expiry || b0.expiryDate)) b.expiryDate = b0.expiry || b0.expiryDate;
        if (!b.mfgDate && (b0.mfg || b0.mfgDate)) b.mfgDate = b0.mfg || b0.mfgDate;
      }
      b.qty = Math.max(num(b.qty) + sign * qty, 0);
    } catch (e) { console.warn("[bill-batch] adjust failed", e); }
  };

  /* ---------- form side ---------- */
  var FORMS = [
    { sel: "billItemDesc",     type: "billItemType",     add: "#addBillItemBtn,button[onclick='addBillItem()']" },
    { sel: "bulkBillItemDesc", type: "bulkBillItemType", add: "button[onclick='addBulkBillItem()']" },
    { sel: "rbProduct",        type: "rbItemType",       add: "button[onclick='rbAddItem()']" }
  ];

  function planAllows() {
    try { return !window.AcaciaPlans || !window.AcaciaPlans.hasFeatureAccess || window.AcaciaPlans.hasFeatureAccess("batch"); } catch (e) { return true; }
  }

  function setup(cfg) {
    var sel = $(cfg.sel);
    if (!sel) return false;
    if (sel.__acxNB) return true;
    var wrap = $(cfg.sel + "_batchWrap"), bs = $(cfg.sel + "_batchSel");
    if (!wrap || !bs) return false;                 // the existing batch picker is not built yet
    sel.__acxNB = true;

    var nb = document.createElement("div");
    nb.id = cfg.sel + "_newBatchWrap";
    nb.className = "mb-4 hidden";
    nb.innerHTML =
      '<div class="flex flex-wrap gap-2 items-end">' +
      '<div><label class="block text-sm font-semibold mb-1">New batch no.</label><input id="' + cfg.sel + '_nbNo" type="text" class="border p-2 rounded" placeholder="e.g. B-2026-001"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Mfg date (optional)</label><input id="' + cfg.sel + '_nbMfg" type="date" class="border p-2 rounded"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Expiry (optional)</label><input id="' + cfg.sel + '_nbExp" type="date" class="border p-2 rounded"></div>' +
      "</div>";
    wrap.parentNode.insertBefore(nb, wrap.nextSibling);

    function isProduct() {
      var t = cfg.type ? $(cfg.type) : null;
      return String((t && t.value) || "").toLowerCase() === "product";
    }
    function refresh() {
      var label = wrap.querySelector("label");
      if (!sel.value || !isProduct() || !planAllows()) {
        wrap.classList.add("hidden"); nb.classList.add("hidden");
        if (bs.value === NEW) bs.value = "";
        return;
      }
      if (label) label.textContent = "📦 Batch — pick an existing batch or add a new one:";
      if (!Array.prototype.some.call(bs.options, function (o) { return o.value === NEW; })) {
        var o = document.createElement("option");
        o.value = NEW; o.textContent = "➕ New batch…";
        bs.appendChild(o);
      }
      bs.disabled = false;
      wrap.classList.remove("hidden");
      nb.classList.toggle("hidden", bs.value !== NEW);
    }
    function later() { setTimeout(refresh, 40); setTimeout(refresh, 250); }

    sel.addEventListener("change", later);
    bs.addEventListener("change", refresh);
    if (cfg.type && $(cfg.type)) $(cfg.type).addEventListener("change", refresh);
    document.addEventListener("acx:data-changed", later);

    // runs before the form's own Add handler (capture phase on document)
    document.addEventListener("click", function (ev) {
      var btns = document.querySelectorAll(cfg.add), hit = false;
      Array.prototype.forEach.call(btns, function (b) { if (ev.target === b || b.contains(ev.target)) hit = true; });
      if (!hit || bs.value !== NEW || !isProduct()) return;
      var opt = sel.options[sel.selectedIndex];
      if (!opt || !opt.value) return;                // form will complain "Select a product"
      var no = ($(cfg.sel + "_nbNo").value || "").trim();
      if (!no) {
        ev.stopImmediatePropagation(); ev.preventDefault();
        alert("Enter the new batch number, or pick an existing batch.");
        return;
      }
      var o = { batchNo: no, expiry: $(cfg.sel + "_nbExp").value || "", mfg: $(cfg.sel + "_nbMfg").value || "", qty: "", isNew: true };
      var orig = opt.value, origText = opt.textContent, tag = " | Batch: " + no + (o.expiry ? " (Exp " + o.expiry + ")" : ""), u = orig + tag;
      try {
        var p = JSON.parse(orig);
        if (p && typeof p === "object") { p.name = (p.name || "") + tag; p.batch = o; u = JSON.stringify(p); }
      } catch (e) {}
      opt.value = u;
      setTimeout(function () {
        opt.value = orig; opt.textContent = origText;
        bs.value = "";
        $(cfg.sel + "_nbNo").value = ""; $(cfg.sel + "_nbMfg").value = ""; $(cfg.sel + "_nbExp").value = "";
        nb.classList.add("hidden");
      }, 0);
    }, true);

    refresh();
    return true;
  }

  function boot() {
    var pending = FORMS.slice(), tries = 0;
    (function tick() {
      pending = pending.filter(function (c) { return !setup(c); });
      if (pending.length && ++tries < 60) setTimeout(tick, 1000);
    })();
    document.addEventListener("acx:data-changed", function () { FORMS.forEach(setup); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 600); });
  else setTimeout(boot, 600);
})();


/* ######## acacia-numbering.js ######## */
/* acacia-numbering.js
 * Settings > Customization > Numbering is the single source of truth for document numbers.
 *
 * Every document type below asks acxDocNo(key) for its next number. The number is
 *     prefix + (highest number already used with that prefix + 1, never lower than "Next #") padded + suffix
 * so it never repeats, survives deleted/edited documents and does not burn numbers when a form is opened and closed.
 *
 *   Reset = "never"   : continues forever.
 *   Reset = "yearly"  : only documents dated this year are counted, so the series restarts at 1 each January.
 *   Reset = "monthly" : same, restarting each month.
 *   Reset = "daily"   : same, restarting each day.
 *
 * Loaded after all other app scripts (see index.html).
 */
(function () {
  "use strict";
  if (window.__acxNumbering2) return;
  window.__acxNumbering2 = true;
  var W = window;

  /* where each document type's saved records live (used to find the highest number already issued) */
  var SOURCES = {
    manualJournals: ["manualJournals"],
    recurringJournals: ["recurringJournals"],
    payments: ["billPayments"],
    bills: ["bills"],
    bulkBills: ["bulkBills", "bills"],
    recurringBills: ["recurringBills", "bills"],
    taxPayments: ["taxPayments"],
    operationalCosts: ["operationalCosts"],
    purchaseOrders: ["purchaseOrders"],
    debitNotes: ["supplierDebitNotes", "debitNotes"],
    purchaseReturns: ["purchaseReturns"],
    grns: ["grns"],
    invoices: ["invoices"],
    quotes: ["quotes"],
    orders: ["orders"],
    bulkInvoices: ["bulkInvoices"],
    creditNotes: ["creditNotes"],
    salesReturns: ["salesReturns"],
    receipts: ["receipts"],
    recurringInvoices: ["recurringInvoices", "invoices"],
    deliveries: ["deliveries"]
  };

  function read(k) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function rows() {
    try { if (typeof W.__acxNumberingRows === "function") return W.__acxNumberingRows() || []; } catch (e) {}
    return [];
  }
  function rowFor(key, override) {
    if (override) return override;
    var all = rows();
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].key === key) return all[i];
    return null;
  }
  function matcher(row) {
    /* optional "AB-" style user code between prefix and digits is allowed (multi-user sessions add it) */
    return new RegExp("^" + esc(row.prefix || "") + "(?:[A-Za-z]+\\d*-)?(\\d+)" + esc(row.suffix || "") + "$");
  }
  function isPeriodic(row) { return row.reset === "yearly" || row.reset === "monthly" || row.reset === "daily"; }
  function inPeriod(rec, row) {
    if (!isPeriodic(row)) return true;
    var d = rec.date || rec.invoiceDate || rec.billDate || rec.createdAt;
    var dt = d ? new Date(d) : null;
    if (!dt || isNaN(dt.getTime())) return true;
    var now = new Date();
    if (dt.getFullYear() !== now.getFullYear()) return false;
    if (row.reset === "yearly") return true;
    if (dt.getMonth() !== now.getMonth()) return false;
    return row.reset === "monthly" || dt.getDate() === now.getDate();
  }
  function maxUsed(key, row, extra) {
    var re = matcher(row), max = 0;
    var lists = (SOURCES[key] || []).map(read);
    if (Array.isArray(extra)) lists.push(extra);
    lists.forEach(function (list) {
      list.forEach(function (rec) {
        if (!rec || typeof rec !== "object" || !inPeriod(rec, row)) return;
        Object.keys(rec).forEach(function (f) {
          var v = rec[f];
          if (typeof v !== "string") return;
          var m = re.exec(v);
          if (m) { var n = parseInt(m[1], 10); if (n < 1e9 && n > max) max = n; } /* >= 1e9 is a timestamp id, not a number */
        });
      });
    });
    return max;
  }
  function build(row, n) {
    return (row.prefix || "") + String(n).padStart(+row.pad || 0, "0") + (row.suffix || "");
  }
  function nextN(key, row, opts) {
    var used = maxUsed(key, row, opts && opts.extra);
    var n = used + 1;
    if (!isPeriodic(row)) n = Math.max(parseInt(row.next, 10) || 1, n);
    return n + ((opts && opts.offset) || 0);
  }

  /* next number for a document type, or null when Customization has no row for it */
  W.acxDocNo = function (key, opts) {
    var row = rowFor(key);
    return row ? build(row, nextN(key, row, opts)) : null;
  };
  /* same, for showing a preview in the Customization table (uses the row as currently typed) */
  W.acxPeekNumber = function (key, row) {
    try { var r = rowFor(key, row); return r ? build(r, nextN(key, r)) : null; } catch (e) { return null; }
  };
  /* true when a value already follows the configured prefix/suffix for this document type */
  W.acxDocMatches = function (key, value) {
    var row = rowFor(key);
    return !!(row && matcher(row).test(String(value || "")));
  };

  /* ---------- generators: replace the number logic underneath each existing generateXNumber() ---------- */
  function setIn(id, v) { var el = document.getElementById(id); if (el) el.value = v; }
  function hook(fn, key, opt) {
    var name = fn + "__acxOrig", orig = W[name];
    if (typeof orig !== "function") return false;
    W[name] = function () {
      var n = null;
      try { n = W.acxDocNo(key); } catch (e) { n = null; }
      if (n == null) return orig.apply(this, arguments);
      if (opt && opt.input) setIn(opt.input, n);
      return opt && opt.voidReturn ? undefined : n;
    };
    return true;
  }
  hook("generateInvoiceNumber", "invoices");
  hook("generateQuoteNumber", "quotes", { input: "quoteNumber" });
  hook("generateOrderNumber", "orders");
  hook("generateBulkInvoiceNumber", "bulkInvoices", { input: "bulkInvoiceNumber", voidReturn: true });
  hook("generateCreditNoteNumber", "creditNotes", { input: "creditNumber", voidReturn: true });
  hook("generateReceiptNumber", "receipts");
  hook("generateRecurringInvoiceNumber", "recurringInvoices");
  hook("generateBillNumber", "bills");
  hook("generateBulkBillNumber", "bulkBills");
  hook("generatePONumber", "purchaseOrders");
  hook("generatePurchaseReturnNumber", "purchaseReturns");
  hook("generateNextGRNNumber", "grns");
  hook("nextJournalNumber", "manualJournals");
  hook("nextRecurringJournalNumber", "recurringJournals");
  hook("generateNextTrackNumber", "deliveries", { input: "deliveryTrackNumber", voidReturn: true });

  /* invoices generated by a recurring template continue the recurring series */
  var prevRinv = W.__acxNextRinv;
  W.__acxNextRinv = function (invoices) {
    var n = null;
    try { n = W.acxDocNo("recurringInvoices", { extra: invoices }); } catch (e) {}
    return n != null ? n : (typeof prevRinv === "function" ? prevRinv.apply(this, arguments) : null);
  };
  var prevRbil = W.__acxNextRbil;
  W.__acxNextRbil = function (bills) {
    var n = null;
    try { n = W.acxDocNo("recurringBills", { extra: bills }); } catch (e) {}
    return n != null ? n : (typeof prevRbil === "function" ? prevRbil.apply(this, arguments) : null);
  };

  /* the old Preferences > Documents numbering now follows Customization too */
  var legacyKeys = { inv: "invoices", quote: "quotes", po: "purchaseOrders", rcpt: "receipts", cn: "creditNotes", dn: "debitNotes" };
  var prevNext = W.nextDocNumber;
  W.nextDocNumber = function (t) {
    var key = legacyKeys[t], n = null;
    if (key) { try { n = W.acxDocNo(key); } catch (e) {} }
    return n != null ? n : (typeof prevNext === "function" ? prevNext.apply(this, arguments) : null);
  };

  /* ---------- documents that had no visible number yet: stamp one on every new record ---------- */
  function stampNew(store, key, before) {
    var arr = read(store);
    if (arr.length <= before) return;
    var changed = false;
    for (var i = before; i < arr.length; i++) {
      var r = arr[i];
      if (r && typeof r === "object" && !r.number) {
        var n = W.acxDocNo(key, { extra: arr });
        if (n == null) return;
        r.number = n; changed = true;
      }
    }
    if (changed) { try { localStorage.setItem(store, JSON.stringify(arr)); } catch (e) {} }
  }
  function stamp(fn, store, key) {
    var f = W[fn];
    if (typeof f !== "function" || f.__acxStamped) return;
    var w = function () {
      var before = read(store).length;
      var res = f.apply(this, arguments);
      var done = function () { try { stampNew(store, key, before); } catch (e) {} };
      if (res && typeof res.then === "function") res.then(done, function () {}); else done();
      return res;
    };
    w.__acxStamped = true;
    W[fn] = w;
  }
  stamp("addSupplierPayment", "billPayments", "payments");
  stamp("addTaxPayment", "taxPayments", "taxPayments");
  stamp("addOperationalCost", "operationalCosts", "operationalCosts");
  stamp("saveDebitNote", "supplierDebitNotes", "debitNotes");
  stamp("saveSalesReturn", "salesReturns", "salesReturns");

  /* ---------- Preferences no longer has its own (conflicting) numbering boxes ---------- */
  function replacePrefsGrid() {
    var g = document.getElementById("docNumberingGrid");
    if (!g || g.getAttribute("data-acx-num")) return;
    g.setAttribute("data-acx-num", "1");
    g.innerHTML = '<div class="text-sm text-gray-700 p-2">Document numbers are now set in <b>Settings &rarr; Customization &rarr; Numbering</b>, for every document type. ' +
      '<button type="button" id="acxGoNumbering" class="text-blue-800 underline">Open Numbering</button></div>';
    var b = document.getElementById("acxGoNumbering");
    if (b) b.addEventListener("click", function () {
      try { if (typeof W.showTab === "function") W.showTab("settingstemplateTab"); } catch (e) {}
      setTimeout(function () {
        var n = document.querySelector('#advCustomization [data-cust="cNumber"], #advCustomization button[onclick*="cNumber"]');
        if (n && n.click) n.click();
      }, 50);
    });
  }
  function watchPrefsGrid() {
    replacePrefsGrid();
    var g = document.getElementById("docNumberingGrid");
    if (!g || !W.MutationObserver) return;
    new MutationObserver(function () {
      if (g.querySelector("[data-prefkey]")) { g.removeAttribute("data-acx-num"); replacePrefsGrid(); }
    }).observe(g, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchPrefsGrid); else watchPrefsGrid();

  /* refresh the Customization table once so it shows all document types */
  try { if (typeof W.__initAdvCustomization === "function") W.__initAdvCustomization(); } catch (e) {}
})();


/* ######## acacia-template-redirect.js ######## */
/* ===================================================================
   acacia-template-redirect.js
   Makes Customization > PDF Templates the ONLY place to edit a
   document template.

   Anywhere in the system that used to open its own template editor
   (the per-document "Edit Template" popups, the "Document Template"
   bar, the old "Edit in Customization" button) now takes the user to
   Customization > PDF Templates, with the right Form Type selected
   and the document's saved template loaded (if it has one).

   Load this LAST in index.html (after acacia-numbering.js).
   =================================================================== */
(function () {
  "use strict";
  if (window.__acxTplRedirect) return;
  window.__acxTplRedirect = true;

  /* ---------- hide the old built-in editors & duplicate button ---------- */
  var st = document.createElement("style");
  st.textContent =
    "#utsEditor{display:none!important}" +
    "#templateEditor,#orderTemplateEditor,#bulkTemplateEditor,#quoteTemplateEditor,#salesReturnTemplateEditor{display:none!important}" +
    ".uts-bar [data-role=editInCustomization]{display:none!important}";
  (document.head || document.documentElement).appendChild(st);

  /* ---------- helpers ---------- */
  function registryByKey(key) {
    try { return (window.acxDocRegistryByKey || {})[key] || null; } catch (e) { return null; }
  }

  function registryByContext(el) {
    var reg = window.acxDocRegistry || [];
    var n = el;
    while (n && n !== document.body) {
      if (n.id) {
        for (var i = 0; i < reg.length; i++) {
          if (reg[i].modal === n.id || reg[i].tab === n.id) return reg[i];
        }
      }
      n = n.parentElement;
    }
    return null;
  }

  function savedTemplateFor(key) {
    if (!key) return "";
    try {
      var s = JSON.parse(localStorage.getItem("docTemplateSettings_" + key) || "{}") || {};
      if (s.customTemplate) return s.customTemplate;
    } catch (e) {}
    try {
      var d = JSON.parse(localStorage.getItem("templateModuleDefaults") || "{}") || {};
      if (d[key]) return d[key];
    } catch (e) {}
    return "";
  }

  function closePreviewModals() {
    try {
      document.querySelectorAll('[id$="PreviewModal"], [id*="PreviewModal"]').forEach(function (m) {
        m.classList.add("hidden");
      });
    } catch (e) {}
  }

  function setFormType(formType) {
    var sel = document.getElementById("templateFormType");
    if (!sel || !formType) return;
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === formType || sel.options[i].text === formType) {
        sel.selectedIndex = i; found = true; break;
      }
    }
    if (!found) {
      var o = document.createElement("option");
      o.textContent = formType; o.value = formType;
      sel.appendChild(o);
      sel.value = formType;
    }
  }

  function selectTemplate(name) {
    var dd = document.getElementById("savedTemplatesDropdown");
    if (!dd || !name) return;
    var exists = false;
    try { exists = localStorage.getItem("template_" + name) !== null; } catch (e) {}
    if (!exists) return;
    var has = false;
    for (var i = 0; i < dd.options.length; i++) if (dd.options[i].value === name) { has = true; break; }
    if (!has) {
      var o = document.createElement("option");
      o.value = name; o.textContent = name;
      dd.appendChild(o);
    }
    dd.value = name;
    if (typeof window.loadTemplateEditor === "function") window.loadTemplateEditor();
  }

  /* ---------- the one place to edit templates ---------- */
  function goEditTemplate(opts) {
    opts = opts || {};
    closePreviewModals();

    if (typeof window.showTab === "function") window.showTab("settingstemplateTab");

    function arrive(tries) {
      var host = document.getElementById("settingstemplateTab");
      if (host && host.classList.contains("hidden")) {
        /* showTab refused (plan/role) or not ready - nothing more to do */
        if (tries > 0) return setTimeout(function () { arrive(tries - 1); }, 100);
        return;
      }
      /* open the PDF Templates tab inside Customization */
      var btn = document.querySelector('#custTabs .cust-tab[data-sec="cTemplates"]');
      if (btn) btn.click();

      /* pick the Form Type for this document and load the template list */
      if (opts.formType) setFormType(opts.formType);
      try { if (typeof window.loadTemplateList === "function") window.loadTemplateList(); } catch (e) {}
      try { if (typeof window.updatePreview === "function") window.updatePreview(); } catch (e) {}

      /* load this document's saved template into the editor */
      if (opts.template) selectTemplate(opts.template);

      var target = document.getElementById("allTemplatesGallery") || document.getElementById("cTemplates");
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setTimeout(function () { arrive(10); }, 150);
  }
  window.acxGoEditTemplate = goEditTemplate;

  function goForKey(key) {
    var d = registryByKey(key);
    goEditTemplate({ formType: d && d.formType, template: savedTemplateFor(key) });
  }

  /* ---------- 1. existing "open designer" hook (used by the old
              "Edit in Customization" button and the template cards) ---------- */
  function designerHook(templateName, formType) {
    goEditTemplate({ template: templateName || "", formType: formType || "" });
  }
  try {
    Object.defineProperty(window, "acxOpenTemplateDesigner", {
      configurable: true,
      get: function () { return designerHook; },
      set: function () { /* ignore later overwrites */ }
    });
  } catch (e) { window.acxOpenTemplateDesigner = designerHook; }

  /* ---------- 2. the "Document Template" bar's Edit Template button ---------- */
  function utsHook(key) { goForKey(key); }
  try {
    Object.defineProperty(window, "utsOpenEditor", {
      configurable: true,
      get: function () { return utsHook; },
      set: function () { /* ignore later overwrites */ }
    });
  } catch (e) { window.utsOpenEditor = utsHook; }

  /* ---------- 3. the old per-document editors ---------- */
  var OLD = {
    openTemplateEditor: "invoice",
    openOrderTemplateEditor: "order",
    openBulkTemplateEditor: "bulkinvoice",
    openQuoteTemplateEditor: "quote",
    openSalesReturnTemplateEditor: "salesreturn"
  };
  Object.keys(OLD).forEach(function (fn) {
    window[fn] = function () { goForKey(OLD[fn]); };
  });

  /* ---------- 4. safety net: any other "Edit Template" /
              "Edit in Customization" button outside Customization ---------- */
  document.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("button, a") : null;
    if (!b) return;
    if (b.closest("#settingstemplateTab")) return;           /* already in Customization */
    if (b.closest("#utsEditor")) return;
    var label = (b.textContent || "").replace(/\s+/g, " ").trim();
    if (!/^(✏️\s*)?edit (template|in customization)$/i.test(label)) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();

    var bar = b.closest(".uts-bar");
    var key = "";
    if (bar && bar.id) key = bar.id.replace(/^uts(Modal|Tab)Bar_/, "");
    if (key) return goForKey(key);

    var d = registryByContext(b);
    if (d) return goForKey(d.key);
    goEditTemplate({});
  }, true);
})();


/* ######## Product is the default item type ######## */
(function () {
  "use strict";
  if (window.__acxDefaultProduct) return;
  window.__acxDefaultProduct = true;
  var PAIRS = [["invoiceProductSelect", "invoiceItemType"], ["bulkInvoiceProductSelect", "bulkItemType"], ["recurringInvoiceProductSelect", "recurringInvoiceItemType"]];
  function run() {
    PAIRS.forEach(function (p) { try { if (typeof window.__acxApplyStockRule === "function") window.__acxApplyStockRule(p[0], p[1]); } catch (e) {} });
  }
  var n = 0, iv = setInterval(function () { run(); if (++n > 20) clearInterval(iv); }, 1500);
  document.addEventListener("acx:data-changed", run);
})();
