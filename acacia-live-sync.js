/* acacia-live-sync.js - keeps Books in step with the other Acacia apps and other browsers.
 *
 * Why: Books only pulled cloud changes at login (plus a realtime channel that is not always delivered),
 * so items imported/added in the Inventory app, or Organization Profile data saved in another browser,
 * did not show up until a full re-login. And local saves were pushed with a 2-4 second delay.
 *
 * 1) every 20 s (and when the tab becomes visible / the connection returns) it runs Books' own incremental pull
 *    (only keys whose cloud version changed are downloaded) and refreshes the screens that show them;
 * 2) changes to inventory / organization profile / banks / branding are pushed to the cloud straight away.
 * Load LAST in index.html. */
(function (W) {
  "use strict";
  if (W.__acxLiveSync) return;
  W.__acxLiveSync = true;

  var POLL_MS = 20000, busy = false, timer = null, pushT = null;
  var PUSH_RE = /^(inventory_|warehouses$|orgInfo|acaciaOrgProfile$|banks$|branding$|customDomain$|domain$|branches$)/;

  function user() { try { return JSON.parse(localStorage.getItem("loggedInUser") || "null"); } catch (e) { return null; } }
  function run(n) { try { if (typeof W[n] === "function") W[n](); } catch (e) { console.warn("[live-sync]", n, e); } }

  function reflect(keys) {
    var inv = false, bank = false;
    keys.forEach(function (k) {
      if (/^inventory_|^warehouses$/.test(k)) inv = true;
      if (k === "banks") bank = true;
    });
    if (inv) {
      ["renderInventoryTable", "renderInventorySummary", "renderStockValuation", "renderStockReports", "renderPriceListTable"].forEach(run);
    }
    if (bank) { ["renderBankTable", "updateBankDropdowns"].forEach(run); }
    /* organization profile: acacia-orgprofile (in app-extras-all.js) refills the form by itself when the stored profile changes */
  }

  async function tick() {
    if (busy || document.hidden || !navigator.onLine) return;
    var cs = W.__companySync, u = user();
    if (!cs || !cs.pullCompany || !cs.ver || !u || !u.companyId || u.demo) return;
    busy = true;
    try {
      var before = Object.assign({}, cs.ver());
      await cs.pullCompany();
      var after = cs.ver(), changed = [];
      Object.keys(after).forEach(function (k) { if (before[k] !== after[k]) changed.push(k); });
      if (changed.length) reflect(changed);
    } catch (e) { console.warn("[live-sync] pull failed", e); }
    finally { busy = false; }
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(function () { tick().then(schedule, schedule); }, POLL_MS); }

  /* push important keys immediately instead of waiting for the 2 s debounce */
  function hookPush() {
    var ns = W.__companyNS;
    if (!ns || !ns.onSetItem) return false;
    ns.onSetItem(function (k) {
      if (!PUSH_RE.test(String(k))) return;
      clearTimeout(pushT);
      pushT = setTimeout(function () { try { W.__companySync && W.__companySync.pushDirty && W.__companySync.pushDirty(); } catch (e) {} }, 300);
    });
    return true;
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
  W.addEventListener("online", tick);
  var tries = 0;
  (function boot() {
    if (!hookPush() && ++tries < 20) return setTimeout(boot, 500);
    setTimeout(tick, 6000);
    schedule();
  })();
})(window);
