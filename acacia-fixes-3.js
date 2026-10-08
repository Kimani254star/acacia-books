/* acacia-fixes-3.js — loaded last.
 * 1. Bulk invoices always feed the dashboard (Accounts Receivable card + Receivables Aging chart)
 * 2. Bulk bills use their own BBIL- number series and show only in the Bulk Bills table
 * 3. Cash flow: Closing Cash = Opening Cash + Cash Inflows − Cash Outflows (report + dashboard card)
 * 4. Organization profile keeps every section's inputs after refresh (auto-save + no stale overwrite)
 * 5. Reports: working Favorites list (star any report) + last-opened tracking
 */
(function () {
  "use strict";
  var W = window;
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function call(n) { try { if (typeof W[n] === "function") W[n](); } catch (e) { console.warn("[fix3] " + n, e); } }
  function wrap(name, after, before) {
    var f = W[name];
    if (typeof f !== "function" || f.__fix3) return;
    var w = function () {
      var ctx = before ? before() : null;
      try { return f.apply(this, arguments); }
      finally { try { after && after(ctx); } catch (e) { console.warn("[fix3] after " + name, e); } }
    };
    for (var k in f) { try { w[k] = f[k]; } catch (e) {} }
    w.__fix3 = true; W[name] = w;
  }

  /* ---------------- 1. Bulk invoices -> dashboard ---------------- */
  function syncBulkInvoiceMirrors() {
    var bulk = J("bulkInvoices", []), inv = J("invoices", []);
    if (!Array.isArray(bulk) || !Array.isArray(inv)) return false;
    var dp = W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2, changed = false, nos = {};
    bulk.forEach(function (b) {
      if (!b || !b.invoiceNo) return;
      nos[b.invoiceNo] = 1;
      var total = num(b.total), vat = num(b.vat), cust = (b.customers || [])[0] || b.customer || "";
      var i = inv.findIndex(function (x) { return x && x.invoiceNumber === b.invoiceNo; });
      if (i === -1) {
        var paid = num(b.paidAmount != null ? b.paidAmount : b.amountPaid);
        inv.push({
          id: Date.now() + Math.random(), invoiceNumber: b.invoiceNo, date: b.date, customer: cust,
          netDays: b.netDays, dueDate: b.dueDate, account: b.account,
          items: (b.items || []).map(function (e) { return { desc: e.itemName || e.desc, sku: e.sku || "", qty: e.qty, price: e.price, discount: e.discount || 0, vatRate: e.tax === "exempt" ? 0 : num(e.tax) }; }),
          total: total.toFixed(dp), vat: vat.toFixed(dp), currency: b.currency, exchangeRate: b.rate || 1, totalKES: total,
          amountPaid: paid, balance: Math.max(total - paid, 0), paid: total > 0 && paid >= total,
          status: b.status || (paid > 0 ? "Partial" : "Unpaid"), source: "bulk"
        });
        changed = true;
      } else if (inv[i].source === "bulk") {
        var m = inv[i];
        if (num(m.total) !== total || m.date !== b.date || (cust && m.customer !== cust) || (b.dueDate && m.dueDate !== b.dueDate)) {
          var p = num(m.amountPaid);
          m.total = total.toFixed(dp); m.vat = vat.toFixed(dp); m.totalKES = total; m.date = b.date;
          if (cust) m.customer = cust; if (b.dueDate) m.dueDate = b.dueDate;
          m.balance = Math.max(total - p, 0); changed = true;
        }
      }
    });
    var kept = inv.filter(function (x) { return !(x && x.source === "bulk" && x.invoiceNumber && !nos[x.invoiceNumber]); });
    if (kept.length !== inv.length) { inv = kept; changed = true; }
    if (changed) S("invoices", inv);
    return changed;
  }
  function refreshDashboard() {
    call("loadDashboard"); call("renderCharts"); call("renderReceivablesAgingChart");
    call("renderAccountsReceivable"); call("recalculateCustomerReceivables");
    call("refreshDashboardCards"); call("updateDashboardTotals"); updateCashCard();
  }
  function afterBulkInvoice() { syncBulkInvoiceMirrors(); refreshDashboard(); }

  /* ---------------- 2. Bulk bills: own BBIL- series, own table ---------------- */
  function nextBBIL(extra) {
    var max = 0;
    J("bulkBills", []).concat(J("bills", [])).forEach(function (b) {
      var m = /^BBIL-(\d+)/.exec(String((b && (b.billNumber || b.billNo)) || ""));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "BBIL-" + String(max + 1 + (extra || 0)).padStart(4, "0");
  }
  function bulkBillNumbers() {
    var set = {};
    J("bulkBills", []).forEach(function (b) { if (b && b.billNumber) set[b.billNumber] = 1; });
    J("bills", []).forEach(function (b) { if (b && (b.source === "bulk" || /^BBIL-/.test(b.billNumber || ""))) set[b.billNumber] = 1; });
    return set;
  }
  function hideBulkFromBillsTable() {
    var body = document.getElementById("supplierBillsList");
    if (!body) return;
    var set = bulkBillNumbers();
    Array.prototype.slice.call(body.rows).forEach(function (tr) {
      var c = tr.cells[1], no = c ? c.textContent.trim() : "";
      if (no && set[no]) tr.parentNode.removeChild(tr);
    });
  }
  function setBulkNumberField() {
    var el = document.getElementById("bulkBillNumber");
    if (el && !/^BBIL-/.test(el.value || "")) el.value = nextBBIL();
  }

  /* ---------------- 3. Cash flow ---------------- */
  function patchCashflowEngine() {
    var FR = W.FR;
    if (!FR || typeof FR.cashflow !== "function" || FR.cashflow.__fix3) return;
    var orig = FR.cashflow;
    var w = function (from, to, opts) {
      var c = orig.apply(this, arguments);
      try {
        var inflow = 0, outflow = 0;
        Object.keys(c.rows || {}).forEach(function (k) { var v = num(c.rows[k]); if (v >= 0) inflow += v; else outflow += -v; });
        c.inflow = inflow; c.outflow = outflow;
        c.net = inflow - outflow;
        c.closing = num(c.opening) + inflow - outflow;
      } catch (e) {}
      return c;
    };
    w.__fix3 = true; FR.cashflow = w;
  }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fyRange() {
    try {
      if (W.__fy && typeof W.__fy.range === "function") {
        var r = W.__fy.range(typeof W.__fy.current === "function" ? W.__fy.current() : undefined);
        if (r && (r.from || r.start)) return { from: r.from || r.start, to: iso(new Date()) };
      }
    } catch (e) {}
    var n = new Date(); return { from: n.getFullYear() + "-01-01", to: iso(n) };
  }
  function fmt(v) { var dp = W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2; return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function updateCashCard() {
    patchCashflowEngine();
    var FR = W.FR; if (!FR || typeof FR.cashflow !== "function") return;
    try {
      var r = fyRange(), c = FR.cashflow(r.from, r.to);
      var cur = W.__getBaseCurrencyEarly ? W.__getBaseCurrencyEarly() : "KES";
      var shown = W.__cvBase ? W.__cvBase(c.closing, "KES") : c.closing;
      var txt = cur + " " + fmt(shown);
      var tip = "Opening " + fmt(c.opening) + " + Inflows " + fmt(c.inflow) + " − Outflows " + fmt(c.outflow) + " = Closing " + fmt(c.closing);
      ["dashCashFlow", "dashCashFlowKPI"].forEach(function (id) { var e = document.getElementById(id); if (e) { e.textContent = txt; e.title = tip; } });
    } catch (e) { console.warn("[fix3] cash card", e); }
  }
  function cashSummaryBox() {
    var host = document.getElementById("cashFlowReport");
    if (!host || !W.FR) return;
    var box = host.querySelector("#fix3CashSummary");
    var from = (document.getElementById("cfStartDate") || {}).value || "", to = (document.getElementById("cfEndDate") || {}).value || "";
    var mo = (document.getElementById("cfSummaryMonth") || {}).value || "";
    if (mo && !from) { var p = mo.split("-"); from = mo + "-01"; to = iso(new Date(+p[0], +p[1], 0)); }
    if (!from) { var r = fyRange(); from = r.from; to = to || r.to; }
    if (!to) to = iso(new Date());
    var c; try { c = W.FR.cashflow(from, to); } catch (e) { return; }
    var html = '<table class="w-full border border-gray-300 text-sm"><thead><tr class="bg-blue-900" style="color:#fff"><th class="border px-3 py-2 text-left" colspan="2">Cash Position (' + from + ' to ' + to + ')</th></tr></thead><tbody>' +
      '<tr><td class="border px-3 py-1">Opening Cash Balance</td><td class="border px-3 py-1 text-right">' + fmt(c.opening) + '</td></tr>' +
      '<tr><td class="border px-3 py-1">Add: Cash Inflows</td><td class="border px-3 py-1 text-right text-green-700">' + fmt(c.inflow) + '</td></tr>' +
      '<tr><td class="border px-3 py-1">Less: Cash Outflows</td><td class="border px-3 py-1 text-right text-red-700">(' + fmt(c.outflow) + ')</td></tr>' +
      '<tr class="bg-gray-100 font-bold"><td class="border px-3 py-1">Closing Cash Balance</td><td class="border px-3 py-1 text-right">' + fmt(c.closing) + '</td></tr>' +
      '</tbody></table><div class="text-xs text-gray-500 mt-1">Closing Cash Balance = Opening Cash Balance + Cash Inflows − Cash Outflows</div>';
    if (!box) { box = document.createElement("div"); box.id = "fix3CashSummary"; box.className = "mt-4 mb-4"; host.appendChild(box); }
    if (box.__h !== html) { box.innerHTML = html; box.__h = html; }
    try {
      S("cashFlowSummary", Object.assign(J("cashFlowSummary", {}) || {}, { openingCash: c.opening, closingCash: c.closing, netChange: c.net, cashInflows: c.inflow, cashOutflows: c.outflow }));
    } catch (e) {}
    // keep the legacy cells consistent with the formula
    var oc = document.getElementById("cfOpeningCash"), nc = document.getElementById("cfNetChange"), cc = document.getElementById("cfClosingCash");
    if (oc && nc && cc) {
      var o = num(String(oc.textContent).replace(/[^0-9.\-]/g, "")), n = num(String(nc.textContent).replace(/[^0-9.\-]/g, ""));
      var want = fmt(o + n);
      if (cc.textContent.indexOf(want) === -1) cc.textContent = (cc.textContent.match(/^[A-Z]{3}\s/) || [""])[0] + want;
    }
  }

  /* ---------------- 4. Organization profile persistence ---------------- */
  function orgKey() { try { var u = J("loggedInUser", {}); return u && u.companyId ? "orgInfo_" + u.companyId : null; } catch (e) { return null; } }
  function reconcileOrg() {
    var k = orgKey(); if (!k) return;
    var plain = J("orgInfo", null), scoped = J(k, null);
    if (!plain || !scoped) return;
    var sameCo = !plain.companyId || !scoped.companyId || String(plain.companyId) === String(scoped.companyId);
    if (!sameCo) return;
    var tp = Date.parse(plain.updatedAt || 0) || 0, ts = Date.parse(scoped.updatedAt || 0) || 0;
    var merged = ts > tp ? Object.assign({}, plain, scoped) : Object.assign({}, scoped, plain);
    var s = JSON.stringify(merged);
    try { localStorage.setItem("orgInfo", s); localStorage.setItem(k, s); } catch (e) {}
  }
  var orgTimer = null, orgSaving = false;
  function silentSaveOrg() {
    if (typeof W.saveOrgInfo !== "function" || orgSaving) return;
    var logo = document.getElementById("orgLogo");
    if (logo && logo.files && logo.files.length) return; // a new logo is saved with the Save button
    orgSaving = true;
    var a = W.alert; W.alert = function () {};
    try { W.saveOrgInfo(); } catch (e) { console.warn("[fix3] org autosave", e); }
    finally { W.alert = a; orgSaving = false; }
  }
  function hookOrgAutosave() {
    var tab = document.getElementById("orgProfileTab");
    if (!tab || tab.__fix3) return;
    tab.__fix3 = true;
    var sched = function (e) {
      if (e && e.target && e.target.type === "file") return;
      clearTimeout(orgTimer); orgTimer = setTimeout(silentSaveOrg, 800);
    };
    tab.addEventListener("input", sched, true);
    tab.addEventListener("change", sched, true);
    tab.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest("button");
      if (b && /remove|delete|×|✕|🗑/i.test((b.getAttribute("onclick") || "") + b.textContent)) sched();
    }, true);
    W.addEventListener("beforeunload", function () { if (orgTimer) { clearTimeout(orgTimer); silentSaveOrg(); } });
  }

  /* ---------------- install ---------------- */
  function install() {
    // 1
    ["saveBulkInvoice", "editBulkInvoice", "updateBulkInvoice", "deleteBulkInvoice", "deleteSelectedBulkInvoices",
     "importBulkInvoices", "convertBulkInvoiceDraft", "cloneBulkInvoice"].forEach(function (n) { wrap(n, afterBulkInvoice); });
    // 2
    wrap("saveBulkBill", function (ctx) {
      W.generateBillNumber = ctx.orig;
      // tag any mirrored rows created by this save
      var bulk = J("bulkBills", []), bills = J("bills", []), ch = false;
      bills.forEach(function (b) { if (b && /^BBIL-/.test(b.billNumber || "") && b.source !== "bulk") { b.source = "bulk"; ch = true; } });
      if (ch) S("bills", bills);
      setBulkNumberField(); hideBulkFromBillsTable(); refreshDashboard();
    }, function () {
      var orig = W.generateBillNumber, n = 0;
      W.generateBillNumber = function () { return nextBBIL(n++); };
      return { orig: orig };
    });
    var gb = W.generateBulkBillNumber;
    W.generateBulkBillNumber = function () { return nextBBIL(); };
    if (gb) W.generateBulkBillNumber.__orig = gb;
    wrap("loadSupplierBills", hideBulkFromBillsTable);
    ["searchSupplierBills", "filterSupplierBills", "filterBills"].forEach(function (n) { wrap(n, hideBulkFromBillsTable); });
    var sbl = document.getElementById("supplierBillsList");
    if (sbl && W.MutationObserver) new MutationObserver(function () { hideBulkFromBillsTable(); }).observe(sbl, { childList: true });
    // 3
    patchCashflowEngine();
    wrap("loadDashboard", updateCashCard);
    ["renderCashFlow", "showReport", "renderReports"].forEach(function (n) { wrap(n, function () { setTimeout(cashSummaryBox, 0); }); });
    var cfr = document.getElementById("cashFlowReport");
    if (cfr && W.MutationObserver) {
      var t = null;
      new MutationObserver(function (muts) {
        var own = muts.every(function (m) { var b = document.getElementById("fix3CashSummary"); return b && (b === m.target || b.contains(m.target)); });
        if (own) return;
        clearTimeout(t); t = setTimeout(cashSummaryBox, 150);
      }).observe(cfr, { childList: true, subtree: true, characterData: true });
    }
    // 4
    reconcileOrg();
    wrap("loadOrgInfo", null, function () { reconcileOrg(); return null; });
    hookOrgAutosave();
  }

  install(); // wrap now, before other scripts capture the original functions on DOMContentLoaded
  function boot() {
    install();
    setTimeout(function () {
      try { if (typeof W.loadOrgInfo === "function") W.loadOrgInfo(); } catch (e) {}
      setBulkNumberField(); hideBulkFromBillsTable();
      if (syncBulkInvoiceMirrors()) refreshDashboard(); else updateCashCard();
      cashSummaryBox();
    }, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

/* ---- 5. Reports: Favorites list + last opened ------------------------------------------ */
(function () {
  "use strict";
  var W = window, FAV_KEY = "reportFavorites_v1", LAST_KEY = "reportLastOpened_v1", MODE_KEY = "reportsHomeMode_v1";
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function favs() { var a = J(FAV_KEY, []); return Array.isArray(a) ? a : []; }
  function lastMap() { var m = J(LAST_KEY, {}); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmt(iso) {
    if (!iso) return "—"; var d = new Date(iso); if (isNaN(d)) return "—";
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function catalog() {
    var map = {}, order = [];
    document.querySelectorAll('.reports-sidebar li[onclick*="showReport("]').forEach(function (li) {
      var m = /showReport\(\s*['"]([^'"]+)['"]/.exec(li.getAttribute("onclick") || "");
      if (!m || m[1] === "reportsHome" || map[m[1]]) return;
      var cat = "Reports", ul = li.closest("ul.rep-cat-children");
      if (ul) {
        var h = document.querySelector('li.rep-cat-header[data-cat="' + ul.getAttribute("data-cat") + '"] .rep-cat-title');
        if (h) cat = h.textContent.trim();
      }
      map[m[1]] = { id: m[1], name: (li.textContent || m[1]).replace(/^[^\w(]+/, "").trim(), cat: cat, li: li };
      order.push(m[1]);
    });
    return { map: map, order: order };
  }
  function setFav(id, on) {
    var a = favs().filter(function (x) { return x !== id; });
    if (on) a.push(id);
    S(FAV_KEY, a); refresh();
  }
  function openReport(id) {
    var c = catalog().map[id];
    if (typeof W.showReport === "function") W.showReport(id, c ? c.li : null);
  }
  function styles() {
    if (document.getElementById("favReportsStyles")) return;
    var st = document.createElement("style"); st.id = "favReportsStyles";
    st.textContent =
      ".reports-sidebar li .rep-star{float:right;cursor:pointer;color:#cbd5e1;font-size:14px;line-height:1.2;margin-left:6px;padding:0 3px}" +
      ".reports-sidebar li .rep-star::before{content:'\\2606'}.reports-sidebar li .rep-star.on{color:#f59e0b}" +
      ".reports-sidebar li .rep-star.on::before{content:'\\2605'}.reports-sidebar li .rep-star:hover{color:#f59e0b}" +
      "#favReportsBox .fav-tabs{display:flex;gap:6px;margin-bottom:10px}" +
      "#favReportsBox .fav-tabs button{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer}" +
      "#favReportsBox .fav-tabs button.on{background:#fef3c7;border-color:#f59e0b;color:#92400e;font-weight:600}" +
      "#favReportsBox .fav-last{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      "#favReportsBox .fav-last button,#favReportsBox .fav-rm{border:1px solid #93c5fd;background:#fff;border-radius:5px;padding:2px 10px;font-size:12px;cursor:pointer}" +
      "#favReportsBox tr.fav-row.is-last{background:#eff6ff}#favReportsBox tr.fav-row:hover{background:#f8fafc}";
    document.head.appendChild(st);
  }
  function syncStars() {
    var f = favs(), c = catalog();
    c.order.forEach(function (id) {
      var li = c.map[id].li, s = li.querySelector(".rep-star");
      if (!s) { s = document.createElement("span"); s.className = "rep-star"; li.appendChild(s); }
      s.setAttribute("data-id", id); s.title = f.indexOf(id) > -1 ? "Remove from favorites" : "Add to favorites";
      s.classList.toggle("on", f.indexOf(id) > -1);
    });
  }
  function homeTable() {
    var home = document.getElementById("reportsHome"); if (!home) return null;
    for (var i = 0; i < home.children.length; i++) if (home.children[i].tagName === "TABLE") return home.children[i];
    return null;
  }
  function syncHomeTable() {
    var t = homeTable(); if (!t) return;
    var f = favs(), last = lastMap();
    t.querySelectorAll("tbody tr").forEach(function (tr) {
      var id = (tr.id || "").replace(/_homeRow$/, ""); if (!id) return;
      var cb = tr.querySelector('input[type="checkbox"]'), nm = tr.querySelector(".report-name"), lv = tr.querySelector(".last-visited");
      if (cb) cb.checked = f.indexOf(id) > -1;
      if (nm) nm.classList.toggle("favorite", f.indexOf(id) > -1);
      if (lv) lv.textContent = last[id] ? fmt(last[id]) : "-";
    });
  }
  function renderBox() {
    var home = document.getElementById("reportsHome"); if (!home) return;
    var box = document.getElementById("favReportsBox");
    if (!box) { box = document.createElement("div"); box.id = "favReportsBox"; home.insertBefore(box, home.firstChild); }
    var mode = J(MODE_KEY, "favorites"), f = favs(), last = lastMap(), c = catalog(), t = homeTable();
    var ids = f.filter(function (id) { var r = c.map[id]; return r && !r.li.classList.contains("hidden"); });
    ids.sort(function (a, b) {
      var x = last[a] || "", y = last[b] || "";
      if (x !== y) return x < y ? 1 : -1;
      return c.order.indexOf(a) - c.order.indexOf(b);
    });
    var lastId = null, lastT = "";
    Object.keys(last).forEach(function (id) { if (c.map[id] && last[id] > lastT) { lastT = last[id]; lastId = id; } });
    var h = '<div class="fav-tabs"><button type="button" data-fav-mode="favorites" class="' + (mode === "favorites" ? "on" : "") + '">\u2B50 Favorites (' + ids.length + ')</button>' +
            '<button type="button" data-fav-mode="all" class="' + (mode === "all" ? "on" : "") + '">All reports</button></div>';
    if (mode === "favorites") {
      if (lastId) h += '<div class="fav-last"><span>Last opened: <b>' + esc(c.map[lastId].name) + '</b> &middot; ' + esc(fmt(lastT)) +
                       '</span><button type="button" data-open="' + esc(lastId) + '">Open</button></div>';
      if (!ids.length) {
        h += '<p class="text-sm" style="color:#64748b;padding:8px 2px">No favorite reports yet. Click the \u2606 next to any report in the list on the left, ' +
             'or open <b>All reports</b> and tick the box beside a report.</p>';
      } else {
        h += '<table class="w-full border text-sm"><thead class="bg-gray-100"><tr><th class="border px-2 py-1 text-left">Report Name</th>' +
             '<th class="border px-2 py-1 text-left">Category</th><th class="border px-2 py-1 text-left">Last Opened</th><th class="border px-2 py-1"></th></tr></thead><tbody>';
        ids.forEach(function (id) {
          var r = c.map[id];
          h += '<tr class="fav-row' + (id === lastId ? " is-last" : "") + '"><td class="border px-2 py-1"><span class="report-name cursor-pointer" data-open="' + esc(id) + '">\uD83D\uDCC1 ' + esc(r.name) + '</span>' +
               (id === lastId ? ' <small style="color:#2563eb">(last opened)</small>' : "") + '</td><td class="border px-2 py-1">' + esc(r.cat) + '</td>' +
               '<td class="border px-2 py-1">' + esc(fmt(last[id])) + '</td><td class="border px-2 py-1 text-center"><button type="button" class="fav-rm" data-unfav="' + esc(id) + '">\u2605 Remove</button></td></tr>';
        });
        h += "</tbody></table>";
      }
    }
    box.innerHTML = h;
    if (t) t.style.display = mode === "all" ? "" : "none";
  }
  function refresh() { try { styles(); syncStars(); syncHomeTable(); renderBox(); } catch (e) { console.warn("[fav-reports]", e); } }

  W.toggleFavorite = function (cb) {
    var tr = cb && cb.closest ? cb.closest("tr") : null, id = tr && tr.id ? tr.id.replace(/_homeRow$/, "") : "";
    if (id) setFav(id, !!cb.checked);
  };

  var wrapped = false, inside = false;
  function wrap() {
    var cur = W.showReport; if (typeof cur !== "function" || cur.__favWrapped) return;
    var w = function (id) {
      var outer = !inside, r; inside = true;
      try { r = cur.apply(this, arguments); } finally { inside = false; }
      if (outer) {
        try {
          if (id === "reportsHome") { refresh(); }
          else if (id) {
            var p = document.getElementById(id);
            if (p && !p.classList.contains("hidden") && p.style.display !== "none") {
              var m = lastMap(); m[id] = new Date().toISOString(); S(LAST_KEY, m); refresh();
            }
          }
        } catch (e) {}
      }
      return r;
    };
    for (var k in cur) { try { w[k] = cur[k]; } catch (e) {} }
    w.__favWrapped = true; W.showReport = w;
  }

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var star = t.closest(".rep-star");
    if (star) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      var id = star.getAttribute("data-id"); setFav(id, favs().indexOf(id) < 0); return;
    }
    var box = t.closest("#favReportsBox"); if (!box) return;
    var el;
    if ((el = t.closest("[data-fav-mode]"))) { S(MODE_KEY, el.getAttribute("data-fav-mode")); renderBox(); }
    else if ((el = t.closest("[data-unfav]"))) { setFav(el.getAttribute("data-unfav"), false); }
    else if ((el = t.closest("[data-open]"))) { openReport(el.getAttribute("data-open")); }
  }, true);

  function boot() {
    wrap(); refresh();
    [800, 2000, 4500, 9000].forEach(function (ms) { setTimeout(function () { wrap(); refresh(); }, ms); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
