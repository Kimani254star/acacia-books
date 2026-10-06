/* recycle-restore.js — Recycle Bin support.
 * The full Recycle Bin implementation (getRecycleBin, saveRecycleBin,
 * renderRecycleBin, emptyRecycleBin, filterRecycleBin, nextRecyclePage,
 * previousRecyclePage, downloadRecycleItem, printRecycleItem,
 * cloneRecycleItem) already lives in app.js / app-3.js.
 * This file only provides safe fallbacks so index.html never hits a
 * "function is not defined" error if those files fail to load. */
(function () {
  "use strict";
  var W = window;

  function lsGet(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  if (typeof W.getRecycleBin !== "function") {
    W.getRecycleBin = function () {
      return lsGet("recycleBin", []);
    };
  }
  if (typeof W.saveRecycleBin !== "function") {
    W.saveRecycleBin = function (items) {
      lsSet("recycleBin", items || []);
    };
  }

  var page = 0;
  var PAGE_SIZE = 10;

  if (typeof W.renderRecycleBin !== "function") {
    W.renderRecycleBin = function () {
      var list = document.getElementById("recycleList");
      if (!list) return;
      var q = (document.getElementById("recycleSearch") || {}).value || "";
      q = q.toLowerCase();
      var items = W.getRecycleBin().filter(function (it) {
        return !q || JSON.stringify(it).toLowerCase().indexOf(q) !== -1;
      });
      var pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      if (page >= pages) page = pages - 1;
      var slice = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (!slice.length) {
        list.innerHTML =
          '<p style="padding:1rem;color:#666;">Recycle Bin is empty.</p>';
      } else {
        list.innerHTML = slice
          .map(function (it, i) {
            var idx = page * PAGE_SIZE + i;
            var label =
              it.name || it.title || it.description || it.type || "Record";
            return (
              '<div style="display:flex;justify-content:space-between;align-items:center;' +
              'padding:.6rem .8rem;border-bottom:1px solid #eee;">' +
              "<span>" + String(label) + "</span>" +
              '<button onclick="restoreRecycleItem(' + idx + ')" ' +
              'style="padding:.3rem .8rem;border-radius:6px;border:1px solid #ccc;' +
              'background:#f5f5f5;cursor:pointer;">Restore</button></div>'
            );
          })
          .join("");
      }
      var ctrl = document.getElementById("recyclePaginationControls");
      if (ctrl)
        ctrl.querySelector("span") &&
          (ctrl.querySelector("span").textContent =
            "Page " + (page + 1) + " of " + pages);
    };
  }

  if (typeof W.filterRecycleBin !== "function") {
    W.filterRecycleBin = function () {
      page = 0;
      W.renderRecycleBin();
    };
  }
  if (typeof W.nextRecyclePage !== "function") {
    W.nextRecyclePage = function () {
      page++;
      W.renderRecycleBin();
    };
  }
  if (typeof W.previousRecyclePage !== "function") {
    W.previousRecyclePage = function () {
      if (page > 0) page--;
      W.renderRecycleBin();
    };
  }
  if (typeof W.emptyRecycleBin !== "function") {
    W.emptyRecycleBin = function () {
      if (!confirm("Permanently delete everything in the Recycle Bin?")) return;
      W.saveRecycleBin([]);
      W.renderRecycleBin();
    };
  }
  if (typeof W.restoreRecycleItem !== "function") {
    W.restoreRecycleItem = function (idx) {
      var items = W.getRecycleBin();
      var it = items[idx];
      if (!it) return;
      if (it.collection && Array.isArray(lsGet(it.collection, null))) {
        var arr = lsGet(it.collection, []);
        arr.push(it.data || it);
        lsSet(it.collection, arr);
      }
      items.splice(idx, 1);
      W.saveRecycleBin(items);
      W.renderRecycleBin();
    };
  }
})();
