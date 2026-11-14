/* acacia-plan-sidebar.js - the sidebar only shows what the company's plan (and the user's role) includes.
 *
 * Why it was not working: filterSidebarByRole() looked for showTab('x') with SINGLE quotes, but the sidebar buttons are
 * written showTab("x") with double quotes, so no button ever matched and nothing was hidden.
 *
 * What this does:
 *   - hides every sidebar item whose module is not in the plan (Free / Starter / Pro / Business / Enterprise / All Access)
 *     or not allowed for the signed-in user's role;
 *   - hides a whole hub (Inventory Hub, Sales Hub ...) when none of its items are available;
 *   - keeps Dashboard and Plans always visible, so a company can always upgrade;
 *   - re-checks by itself when the plan, role or modules change (for example after an upgrade);
 *   - blocks opening a locked module by any other route (it also adds the plan test to acxCanOpenTab).
 * Load LAST in index.html. */
(function (W) {
  "use strict";
  if (W.__acxPlanSidebar) return;
  W.__acxPlanSidebar = true;

  var ORDER = ["free", "starter", "pro", "business", "enterprise", "all_access"];
  var ALWAYS = { dashboard: 1, plansTab: 1 };           /* never hidden */
  var KEEP_GROUPS = { plansSubmenu: 1 };

  function user() { try { return JSON.parse(localStorage.getItem("loggedInUser") || "null"); } catch (e) { return null; } }
  function companyPlan(u) {
    try {
      var id = String((u && u.companyId) || ""), list = JSON.parse(localStorage.getItem("companies") || "[]") || [];
      var c = list.filter(function (x) { return String(x.companyId || "") === id; })[0];
      return c && c.plan ? c.plan : "";
    } catch (e) { return ""; }
  }
  function planIndex(u) {
    var p = (u && u.plan) || companyPlan(u) || localStorage.getItem("selectedPlan") || "";
    var n = String(p).toLowerCase().replace(/[\s-]+/g, "_");
    if (n === "allaccess") n = "all_access";
    return ORDER.indexOf(n);                               /* -1 = unknown plan: do not filter by plan */
  }
  /* same rule the app already uses: an unregistered admin sees everything */
  function planApplies(u) { return !(u && String(u.role || "").toLowerCase() === "admin" && !u.registered); }
  function access() { try { return typeof submoduleAccess !== "undefined" ? submoduleAccess : null; } catch (e) { return null; } }

  /* does the plan include this module? */
  function planSees(tab, pi, sa) {
    if (ALWAYS[tab]) return true;
    sa = sa || access();
    if (!sa || pi < 0 || !Object.prototype.hasOwnProperty.call(sa, tab)) return true;
    var row = sa[tab];
    return !Array.isArray(row) || row[pi] !== false;
  }
  /* plan AND role/user permission */
  function canSee(tab, u) {
    if (ALWAYS[tab]) return true;
    if (planApplies(u) && !planSees(tab, planIndex(u))) return false;
    try { if (!origCanOpen(tab)) return false; } catch (e) {}
    return true;
  }

  var origCanOpen = typeof W.acxCanOpenTab === "function" ? W.acxCanOpenTab : function () { return true; };
  /* the same plan test when a module is opened by any other route (a link, a button, the quick-create menu) */
  W.acxCanOpenTab = function (tab) {
    if (!origCanOpen(tab)) return false;
    var u = user();
    return !planApplies(u) || planSees(tab, planIndex(u));
  };

  function tabOf(btn) {
    var m = String(btn.getAttribute("onclick") || "").match(/showTab\(\s*["']([^"']+)["']/);
    return m ? m[1] : "";
  }
  function setHidden(btn, hide) {
    var li = btn.closest ? btn.closest("li") : null;
    btn.classList.toggle("hidden", hide);
    if (li && li.querySelectorAll("button").length === 1) {
      if (hide) { li.setAttribute("data-acx-plan-hid", "1"); li.style.display = "none"; }
      else if (li.getAttribute("data-acx-plan-hid")) { li.removeAttribute("data-acx-plan-hid"); li.style.removeProperty("display"); }
    }
  }

  function apply() {
    var u = user(), sb = document.getElementById("sidebar");
    if (!u || !sb) return;
    /* 1. individual modules */
    var tabs = sb.querySelectorAll("button[onclick]");
    Array.prototype.forEach.call(tabs, function (b) {
      var id = tabOf(b); if (!id) return;
      setHidden(b, !canSee(id, u));
    });
    /* 2. hubs with nothing left inside */
    Array.prototype.forEach.call(sb.querySelectorAll("button[onclick]"), function (b) {
      var m = String(b.getAttribute("onclick") || "").match(/toggleSubmenu\(\s*["']([^"']+)["']/);
      if (!m || KEEP_GROUPS[m[1]]) return;
      var ul = document.getElementById(m[1]); if (!ul) return;
      var any = false;
      Array.prototype.forEach.call(ul.querySelectorAll("button[onclick]"), function (c) {
        var id = tabOf(c);
        if (id && !c.classList.contains("hidden")) any = true;
        else if (!id) any = true;                          /* a button that is not a module link: keep the hub */
      });
      setHidden(b, !any);
      if (!any) ul.classList.add("hidden");
    });
  }

  W.filterSidebarByRole = apply;                           /* the app calls this after sign-in */

  /* re-check when plan / role / modules change, and when the sidebar is (re)drawn */
  var last = "";
  function sig() { var u = user() || {}; return [u.plan, u.role, u.registered, JSON.stringify(u.modules || null), localStorage.getItem("selectedPlan"), localStorage.getItem("customModules")].join("|"); }
  function tick() { var s = sig(); if (s !== last) { last = s; try { apply(); } catch (e) { console.warn("[plan-sidebar]", e); } } }
  setInterval(tick, 1500);
  document.addEventListener("DOMContentLoaded", function () { setTimeout(function () { last = ""; tick(); }, 800); });
  W.addEventListener("storage", function () { tick(); });
  setTimeout(function () { last = ""; tick(); }, 1200);

  W.acxPlanSidebar = { apply: apply, planSees: planSees, planIndex: planIndex, canSee: canSee };
})(window);
