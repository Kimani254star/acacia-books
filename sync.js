/* sync.js — Sync status helpers.
 * The real cloud-sync logic (startCloudSync, syncAll, Google backup
 * connect/backup/restore and the Settings buttons) already lives in
 * app.js / app-3.js. This file only fills in safe fallbacks and keeps the
 * "last sync" / status labels honest when cloud sync isn't available. */
(function () {
  "use strict";
  var W = window;

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  W.updateSyncStatus =
    W.updateSyncStatus ||
    function (message) {
      var msg = message || "Saved locally on this device";
      setText("system_synchronizationStatus", msg);
      setText("system_synchronizationStatus_homeRow", msg);
      setText("syncStatus", msg);
    };

  W.refreshLastSyncLabel = function () {
    var ts = null;
    try {
      ts =
        localStorage.getItem("__gsyncLastPush") ||
        localStorage.getItem("lastSyncAt");
    } catch (e) {}
    setText(
      "lastSync",
      ts ? "Last sync: " + new Date(ts).toLocaleString() : "Not synced yet"
    );
  };

  if (typeof W.startCloudSync !== "function") {
    W.startCloudSync = function () {
      W.updateSyncStatus("Cloud sync is not configured — data is saved locally");
    };
  }
  if (typeof W.syncAll !== "function") {
    W.syncAll = function () {
      W.updateSyncStatus("Cloud sync is not configured — data is saved locally");
    };
  }

  document.addEventListener("DOMContentLoaded", function () {
    W.refreshLastSyncLabel();
    if (!document.getElementById("system_synchronizationStatus")) return;
    var el = document.getElementById("system_synchronizationStatus");
    if (!el.textContent.trim()) W.updateSyncStatus();
  });
})();
