/* scripts/nonCurrentAssets.js — Non-Current Assets support.
 * The full Non-Current Assets module (addNonCurrentAsset,
 * editNonCurrentAsset, deleteNonCurrentAsset, depreciateNonCurrentAsset,
 * getNonCurrentAssets, reports, CSV export, etc.) already lives in
 * app.js / app-3.js. This file only guarantees the balance-sheet data
 * shape exists so those features never read an undefined list. */
(function () {
  "use strict";
  var W = window;

  if (typeof W.getNonCurrentAssets !== "function") {
    W.getNonCurrentAssets = function () {
      try {
        var bs = JSON.parse(localStorage.getItem("balanceSheet") || "{}") || {};
        return bs.nonCurrentAssets || [];
      } catch (e) {
        return [];
      }
    };
  }
})();
