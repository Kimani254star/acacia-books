/* Sidebar links to the other Acacia apps are limited by User Management → Module Access.
   Admins see them all; other users only see the apps ticked for them. */
(function () {
  "use strict";
  var HUBS = ["inventoryHub", "sellHub", "expensesHub", "payrollHub", "plansHub"];
  window.acxApplyHubLinks = function (user) {
    try {
      user = user || JSON.parse(localStorage.getItem("loggedInUser") || "null");
      var admin = !!user && String(user.role || "").toLowerCase() === "admin";
      var mods = user && Array.isArray(user.modules) ? user.modules : [];
      HUBS.forEach(function (k) {
        var li = document.getElementById(k + "Link");
        if (li) li.classList.toggle("hidden", !(user && (admin || mods.indexOf(k) > -1)));
      });
    } catch (e) { console.warn("[app-access]", e); }
  };
  function run() { window.acxApplyHubLinks(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(run, 500); });
  else setTimeout(run, 500);
  // the logged-in user can change (login / switch company / edit access), so re-check now and then
  setInterval(run, 5000);
})();
