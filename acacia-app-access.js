/* Acacia Books - App access per user (User Management > Create / Edit User)
 * Adds "App access" ticks to the user form. Only apps the company has paid for
 * can be ticked; the choice is saved on the user ("apps") and synced, and every
 * companion app checks it at sign-in (sql/acacia_app_access.sql).
 */
(function () {
  "use strict";
  if (window.__acxAppAccess) return; window.__acxAppAccess = true;

  var APPS = [
    { k: "crm", l: "🤝 Acacia Books CRM" },
    { k: "projects", l: "🗂️ Acacia Projects" },
    { k: "payroll", l: "💵 Acacia Payroll" },
    { k: "sell", l: "🛒 Acacia Sell" }
  ];
  var planIncl = null; // apps included by the plan (from acacia_plan_apps)

  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function low(s) { return String(s || "").trim().toLowerCase(); }
  function hdr() { return { apikey: window.__SUPA_KEY__, Authorization: "Bearer " + window.__SUPA_KEY__ }; }

  async function loadPaidList() {
    if (!window.__SUPA_URL__) return;
    try {
      var r = await fetch(window.__SUPA_URL__ + "/rest/v1/acacia_paid_apps?select=app,label", { headers: hdr() });
      if (r.ok) { var a = await r.json(); if (a && a.length) APPS = a.map(function (x) { var o = APPS.find(function (y) { return y.k === x.app; }); return { k: x.app, l: o ? o.l : x.label }; }); }
    } catch (e) {}
  }
  async function loadPlanIncl() {
    var row = window.__acxCompanyRow || {}, plan = low(row.plan || (jget("loggedInUser", {}) || {}).plan || "free").replace(/\s+/g, " ");
    planIncl = [];
    if (!window.__SUPA_URL__) return;
    try {
      var r = await fetch(window.__SUPA_URL__ + "/rest/v1/acacia_plan_apps?select=app&plan=eq." + encodeURIComponent(plan), { headers: hdr() });
      if (r.ok) planIncl = (await r.json()).map(function (x) { return x.app; });
    } catch (e) {}
  }

  /* which apps this company has paid for */
  function paidApps() {
    var row = window.__acxCompanyRow || {}, me = jget("loggedInUser", {}) || {};
    var plan = low(row.plan || me.plan);
    var all = !!row.all_apps || !!me.allApps || /^(all\s*access|all\s*(9|nine)?\s*apps(\s*included)?|enterprise)$/.test(plan) || (planIncl || []).indexOf("*") > -1;
    var bought = String(row.apps || "").split(",").map(low).filter(Boolean);
    if (!bought.length && Array.isArray(me.apps)) bought = me.apps.map(low);
    if (row.paid_until && new Date(row.paid_until) < new Date() && plan !== "free") return [];
    return APPS.map(function (a) { return a.k; }).filter(function (k) { return all || bought.indexOf(k) > -1 || (planIncl || []).indexOf(k) > -1; });
  }

  function box() {
    var el = document.getElementById("acxAppAccessBox");
    if (el) return el;
    var list = document.getElementById("moduleAccessList");
    if (!list) return null;
    el = document.createElement("div");
    el.id = "acxAppAccessBox";
    el.className = "mb-4 p-2 border rounded bg-gray-50 text-sm";
    list.parentNode.insertBefore(el, list);
    return el;
  }

  function render(selected) {
    var el = box(); if (!el) return;
    var paid = paidApps();
    el.innerHTML = '<div class="font-semibold mb-1">🔑 App access</div>' +
      '<div class="text-xs text-gray-500 mb-1">Tick the apps this user may open. Admins can open every paid app.</div>' +
      APPS.map(function (a) {
        var ok = paid.indexOf(a.k) > -1, on = ok && selected.indexOf(a.k) > -1;
        return '<label class="flex items-center justify-between py-0.5 ' + (ok ? "cursor-pointer" : "opacity-60") + '">' +
          '<span><input type="checkbox" class="acx-app-access mr-2" value="' + a.k + '"' + (on ? " checked" : "") + (ok ? "" : " disabled") + ">" + a.l + "</span>" +
          (ok ? "" : '<span class="text-xs text-red-600">Not paid</span>') + "</label>";
      }).join("") +
      (paid.length < APPS.length ? '<div class="text-xs text-gray-500 mt-1">Apps marked "Not paid" unlock after the company pays for them (Settings &gt; Subscription).</div>' : "");
  }

  function chosen() {
    return Array.from(document.querySelectorAll("#acxAppAccessBox .acx-app-access:checked")).map(function (x) { return x.value; });
  }

  function wrap() {
    var open = window.openCreateUserModal, save = window.saveUser;
    if (typeof open !== "function" || typeof save !== "function" || open.__acxApps) return false;

    var newOpen = function (idx) {
      var r = open.apply(this, arguments);
      try {
        var u = (idx != null) ? (jget("users", [])[idx] || {}) : null;
        render(u && Array.isArray(u.apps) ? u.apps.map(low) : paidApps());   // new user: all paid apps ticked by default
      } catch (e) { console.warn("[app-access]", e); }
      return r;
    };
    newOpen.__acxApps = true;
    window.openCreateUserModal = newOpen;
    try { openCreateUserModal = newOpen; } catch (e) {}

    var newSave = async function () {
      var apps = chosen();
      var email = low((document.getElementById("newEmail") || {}).value);
      var uname = low((document.getElementById("newUsername") || {}).value);
      var cid = String((jget("loggedInUser", {}) || {}).companyId || "");
      var res = await save.apply(this, arguments);
      try {
        var users = jget("users", []), hit = false;
        users.forEach(function (u) {
          if (String(u.companyId || "") !== cid) return;
          if ((email && low(u.email) === email) || low(u.username) === uname) { u.apps = apps; hit = true; }
        });
        if (hit) {
          localStorage.setItem("users", JSON.stringify(users));
          if (typeof window.__acxPushAccounts === "function") await window.__acxPushAccounts();
        }
      } catch (e) { console.warn("[app-access] save", e); }
      return res;
    };
    newSave.__acxApps = true;
    window.saveUser = newSave;
    try { saveUser = newSave; } catch (e) {}
    return true;
  }


  /* Sign-up: if the visitor picked a plan on the "All 9 Apps Included" tab of the
     home page, carry that choice into the registration form so the company is
     saved with all apps paid (all_apps = true) instead of Books only. */
  /* Suite price: when the visitor picked a plan on the "All 9 Apps Included" tab,
     the sign-up form must show the suite price from that tab, not Books + add-ons.
     landing.html stores the clicked price in acxSuitePrice / acxSuitePer. */
  function suitePriceLine() {
    var price = localStorage.getItem("acxSuitePrice");
    if (!price) return "";
    var per = localStorage.getItem("acxSuitePer") || "";
    return "You will pay " + price + (per ? " " + per : "") + " — suite price, all 9 apps included.";
  }
  function applySuitePrice() {
    if (localStorage.getItem("acxSuiteMode") !== "all") return;
    var sum = document.getElementById("regPlanSummary");
    if (!sum || !sum.offsetParent) return; // register form not open
    var line = suitePriceLine();
    if (line && sum.textContent !== line) sum.textContent = line;
  }

  function applySuiteChoice() {
    var box = document.getElementById("regAppsBox"), sel = document.getElementById("regPlan");
    if (!box || !sel) return;
    var mode = localStorage.getItem("acxSuiteMode");
    if (mode !== "all") return;
    if (!box.__acxSuiteDone) {
      box.__acxSuiteDone = true;
      var plan = localStorage.getItem("acxSuitePlan");
      if (plan) {
        var opt = Array.from(sel.options).find(function (o) { return low(o.value) === low(plan); });
        if (opt && sel.value !== opt.value) { sel.value = opt.value; sel.dispatchEvent(new Event("change")); }
      }
      var all = document.getElementById("regAllApps");
      if (all && !all.disabled && !all.checked) { all.checked = true; all.dispatchEvent(new Event("change")); }
      else box.querySelectorAll(".reg-app").forEach(function (c) { if (!c.disabled && !c.checked) { c.checked = true; c.dispatchEvent(new Event("change")); } });
    }
    applySuitePrice();
  }

  function boot() {
    setInterval(applySuiteChoice, 700);
    setInterval(applySuitePrice, 700);
    loadPaidList().then(loadPlanIncl);
    window.addEventListener("acx-company-row", function () { loadPlanIncl(); });
    var n = 0, t = setInterval(function () { if (wrap() || ++n > 60) clearInterval(t); }, 500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
