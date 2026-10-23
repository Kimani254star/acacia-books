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
