/*
 * acacia-fixes-4.js — Bank ↔ source sync
 *
 *  1. Operational costs (incl. Plan expenses): when a cost is deleted, or is
 *     paid via a current account, its row is removed from Bank → Manual
 *     Transactions (and the bank "transactions" list). IDs are compared as
 *     text so number/string mismatches no longer leave orphan rows.
 *  2. Current / non-current asset purchases: deleting the asset removes its
 *     bank row; deleting the bank row removes the asset (moved to Recycle Bin).
 *     Same two-way link for operational costs.
 *  3. Stock adjustments: deleting an adjustment immediately re-posts the
 *     adjustment cost, so Cost of Goods Sold / P&L update right away.
 *
 *  Orphan clean-up never changes bank balances: the original delete already
 *  reversed the balance, so touching it again would double count.
 */
(function () {
  "use strict";
  if (window.__acxFix4) return;
  window.__acxFix4 = true;

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function S(v) { return v == null ? "" : String(v); }
  function call(fn) { try { if (typeof window[fn] === "function") window[fn](); } catch (e) {} }
  function recycle(rec, mod) { try { if (typeof moveToRecycle === "function") moveToRecycle(rec, "File", mod); } catch (e) {} }

  /* keep in-memory arrays (used by some renders) in step with storage */
  function syncMem(list) {
    try {
      /* eslint-disable no-undef */
      if (typeof manualTransactions !== "undefined" && Array.isArray(manualTransactions)) {
        manualTransactions.length = 0;
        list.forEach(function (t) { manualTransactions.push(t); });
      }
    } catch (e) {}
  }

  function allAssetIds() {
    var ids = {};
    var bs = get("balanceSheet", {}) || {};
    Object.keys(bs).forEach(function (k) {
      if (Array.isArray(bs[k])) bs[k].forEach(function (a) { if (a && a.id != null && a.status !== "deleted") ids[S(a.id)] = 1; });
    });
    ["currentAssets", "nonCurrentAssets", "fixedAssets"].forEach(function (k) {
      var a = get(k, null); if (Array.isArray(a)) a.forEach(function (x) { if (x && x.id != null) ids[S(x.id)] = 1; });
    });
    return ids;
  }

  function refreshViews() {
    ["renderManualTransactions", "renderBankTable", "updateBankSummary", "renderReconciliationTransactions",
     "renderOperationalCosts", "updateExpensesCard", "renderBalanceSheet", "renderReports", "renderProfitLoss",
     "renderProfitMargin", "phRenderExpenses", "__refreshDashCashFlow"].forEach(call);
  }

  /* ---------- 1 & 2: remove bank rows whose source is gone ---------- */
  function reconcileBank() {
    var costs = get("operationalCosts", []) || [];
    var costById = {};
    costs.forEach(function (c) { if (c && c.id != null) costById[S(c.id)] = c; });
    var assets = allAssetIds();
    var hasAssets = Object.keys(get("balanceSheet", {}) || {}).length > 0;

    function orphan(t) {
      if (!t) return true;
      if (t.operationalCostId != null && t.operationalCostId !== "") {
        var c = costById[S(t.operationalCostId)];
        if (!c) return true;                         // cost deleted
        if (c.paidVia === "current") return true;    // not a bank payment
        if (c.paidVia === "Stock Adjustment" || c.source === "stockAdjustment") return true; // non-cash
      }
      if (t.source === "asset_purchase" && t.assetId != null && hasAssets && !assets[S(t.assetId)]) return true;
      return false;
    }

    var changed = false;
    var manual = get("manualTransactions", []) || [];
    var keep = manual.filter(function (t) { return !orphan(t); });
    if (keep.length !== manual.length) { set("manualTransactions", keep); syncMem(keep); changed = true; }

    var tx = get("transactions", []) || [];
    var keepTx = tx.filter(function (t) { return !(t && t.operationalCostId != null && t.operationalCostId !== "" && orphan(t)); });
    if (keepTx.length !== tx.length) { set("transactions", keepTx); changed = true; }

    /* operational costs created from a bank entry whose bank entry is gone */
    var manIds = {};
    keep.forEach(function (t) { if (t && t.id != null) manIds[S(t.id)] = 1; });
    var keepCosts = costs.filter(function (c) {
      return !(c && c.source === "fundsTransaction" && c.linkedManualTxId != null && !manIds[S(c.linkedManualTxId)]);
    });
    if (keepCosts.length !== costs.length) { set("operationalCosts", keepCosts); changed = true; }

    if (changed) refreshViews();
    return changed;
  }
  window.acxSyncBankLinks = reconcileBank;

  /* ---------- 2b: deleting a bank row also removes its source ---------- */
  function wrapDeleteManual() {
    var orig = window.deleteManualTransaction;
    if (typeof orig !== "function" || orig.__acx4) return;
    var w = function (id) {
      var before = (get("manualTransactions", []) || []).find(function (t) { return t && S(t.id) === S(id); });
      var r = orig.apply(this, arguments);
      try {
        if (!before) return r;
        var still = (get("manualTransactions", []) || []).some(function (t) { return t && S(t.id) === S(id); });
        if (still) return r; // user cancelled
        var touched = false;

        if (before.operationalCostId != null && before.operationalCostId !== "") {
          var costs = get("operationalCosts", []) || [];
          var gone = costs.filter(function (c) { return c && S(c.id) === S(before.operationalCostId); });
          if (gone.length) {
            gone.forEach(function (c) { recycle(c, "OperationalCosts"); });
            set("operationalCosts", costs.filter(function (c) { return !(c && S(c.id) === S(before.operationalCostId)); }));
            var tx = (get("transactions", []) || []).filter(function (t) { return !(t && S(t.operationalCostId) === S(before.operationalCostId)); });
            set("transactions", tx);
            touched = true;
          }
        }

        if (before.source === "asset_purchase" && before.assetId != null) {
          var bs = get("balanceSheet", {}) || {};
          Object.keys(bs).forEach(function (k) {
            if (!Array.isArray(bs[k])) return;
            var hit = bs[k].filter(function (a) { return a && S(a.id) === S(before.assetId); });
            if (!hit.length) return;
            hit.forEach(function (a) { recycle(a, "Assets"); });
            bs[k] = bs[k].filter(function (a) { return !(a && S(a.id) === S(before.assetId)); });
            try { if (typeof balanceSheet !== "undefined" && balanceSheet && Array.isArray(balanceSheet[k])) balanceSheet[k] = bs[k]; } catch (e) {}
            touched = true;
          });
          if (touched) {
            set("balanceSheet", bs);
            ["renderNonCurrentAssets", "renderNonCurrentAssetsSummary", "renderBalanceSheetAssets",
             "syncNonCurrentAssetsToOpeningBalances", "renderCurrentAssets"].forEach(call);
          }
        }
        if (touched) refreshViews();
      } catch (e) { console.error("[acacia-fixes-4] delete sync", e); }
      return r;
    };
    w.__acx4 = true;
    window.deleteManualTransaction = w;
  }

  /* ---------- after any source delete, clean bank immediately ---------- */
  function wrapAfter(name, fn) {
    var orig = window[name];
    if (typeof orig !== "function" || orig["__acx4" + name]) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { fn(); } catch (e) {}
      setTimeout(function () { try { fn(); } catch (e) {} }, 300);
      return r;
    };
    w["__acx4" + name] = true;
    window[name] = w;
  }

  /* ---------- 3: adjustments → Cost of Goods Sold ---------- */
  function syncCOGS() {
    if (typeof window.syncAdjustmentCostsToPnL === "function") {
      try { window.syncAdjustmentCostsToPnL(); } catch (e) {}
    }
    reconcileBank();
    ["renderProfitLoss", "renderProfitMargin", "renderReports", "renderTrialBalance", "renderBalanceSheet",
     "renderOperationalCosts", "updateExpensesCard", "renderAmendedWarehouseMovement", "renderStockReports"].forEach(call);
  }
  window.acxSyncAdjustmentCOGS = syncCOGS;

  function install() {
    wrapDeleteManual();
    ["deleteOperationalCost", "bulkDeleteOperationalCosts", "phDeleteExpense", "deleteNonCurrentAsset",
     "deleteAsset", "deleteCurrentAsset", "bulkDeleteAssets", "saveOperationalCost", "phAddExpense"]
      .forEach(function (n) { wrapAfter(n, reconcileBank); });
    ["deleteAmendment", "bulkDeleteAmendments", "bulkDeleteAdjustments", "deleteBulkAdjustment",
     "deleteAdjustment", "editAmendment"]
      .forEach(function (n) { wrapAfter(n, syncCOGS); });
  }

  function boot() {
    install();
    setTimeout(function () { install(); reconcileBank(); syncCOGS(); }, 2000);
    setInterval(function () { install(); reconcileBank(); }, 5000);
    window.addEventListener("storage", function () { setTimeout(reconcileBank, 400); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
