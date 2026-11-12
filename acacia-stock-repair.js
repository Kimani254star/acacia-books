/* Acacia Books — targeted Stock / Inventory repair.
   Keeps the existing application and company storage architecture. */
(function (W) {
  "use strict";
  if (W.__acxStockRepair) return;
  W.__acxStockRepair = true;

  var LS = W.localStorage;
  var writing = false;
  var hooked = false;

  function user() {
    try { return JSON.parse(LS.getItem("loggedInUser") || "null"); }
    catch (e) { return null; }
  }

  function companyId() {
    var u = user(), cid = u && String(u.companyId || "").trim();
    if (!cid) return "";
    try {
      var ns = W.__companyNS;
      var active = ns && typeof ns.activeCompany === "function" ? String(ns.activeCompany() || "") : cid;
      if (active && active !== cid) return "";
    } catch (e) { return ""; }
    return cid;
  }

  function norm(v) {
    return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function hasId(item) {
    return !!item && item.id != null && item.id !== "" && typeof item.id !== "object";
  }

  function hash(value) {
    var h = 2166136261, s = String(value), i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function ensureItems(items, warehouse, cid, prior) {
    if (!Array.isArray(items) || !cid) return false;
    var changed = false, used = Object.create(null), priorByName = Object.create(null);
    (Array.isArray(prior) ? prior : []).forEach(function (item) {
      var name = norm(item && item.name);
      if (name && hasId(item)) (priorByName[name] || (priorByName[name] = [])).push(String(item.id));
    });

    items.forEach(function (item) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      var name = norm(item.name), id = hasId(item) ? String(item.id) : "";
      if (!id && name && priorByName[name] && priorByName[name].length) {
        while (priorByName[name].length && !id) {
          var candidate = priorByName[name].shift();
          if (!used[candidate]) id = candidate;
        }
      }
      if (!id && name) id = "acx-item-" + hash(cid + "|" + String(warehouse || "") + "|" + name);
      if (!id && !name) id = "acx-item-" + hash(cid + "|" + String(warehouse || "") + "|unnamed|" + items.indexOf(item));
      if (used[id]) {
        var suffix = 2, root = id;
        while (used[root + "-" + suffix]) suffix++;
        id = root + "-" + suffix;
      }
      if (String(item.id || "") !== id) {
        item.id = id;
        changed = true;
      }
      used[id] = true;
    });
    return changed;
  }

  W.acxEnsureItemIds = function (items, existing, persist, warehouse) {
    var cid = companyId();
    if (!cid || !Array.isArray(items)) return items;
    ensureItems(items, warehouse || "", cid, existing);
    return items;
  };

  function invalidate() {
    try { W.__invalidateInventoryCache && W.__invalidateInventoryCache(); } catch (e) {}
    try { W.__acxStockChanged && W.__acxStockChanged(); } catch (e) {}
  }

  function ensureWarehouse(warehouse) {
    var cid = companyId();
    if (!cid || !warehouse) return false;
    var key = "inventory_" + warehouse, raw = null, items;
    try { raw = LS.getItem(key); items = raw == null ? null : JSON.parse(raw); }
    catch (e) { return false; }
    if (!Array.isArray(items)) return false;
    if (!ensureItems(items, warehouse, cid, items)) return false;
    writing = true;
    try { LS.setItem(key, JSON.stringify(items)); }
    catch (e) { console.warn("[stock-repair] could not persist item identities", e); }
    finally { writing = false; }
    invalidate();
    return true;
  }

  function hookStorage() {
    var ns = W.__companyNS;
    if (!ns || typeof ns.onSetItem !== "function") return false;
    ns.onSetItem(function (key, value) {
      if (writing || !/^inventory_/.test(String(key || ""))) return;
      var cid = companyId();
      if (!cid) {
        console.error("[stock-repair] blocked company-unscoped inventory processing");
        return;
      }
      var items;
      try { items = JSON.parse(value || "null"); } catch (e) { return; }
      if (!Array.isArray(items)) return;
      var warehouse = String(key).slice("inventory_".length);
      if (!ensureItems(items, warehouse, cid, items)) return;
      writing = true;
      try { LS.setItem(key, JSON.stringify(items)); }
      catch (e) { console.warn("[stock-repair] identity save failed", e); }
      finally { writing = false; }
      invalidate();
    });
    hooked = true;
    return true;
  }

  function wrapInventoryFunctions() {
    if (typeof W.getInventory === "function" && !W.getInventory.__acxCompanyGuard) {
      var getInventory = W.getInventory;
      var guardedGet = function (warehouse) {
        if (!companyId()) return [];
        if (warehouse) ensureWarehouse(warehouse);
        else {
          for (var i = 0; i < LS.length; i++) {
            var key = LS.key(i);
            if (key && key.indexOf("inventory_") === 0) ensureWarehouse(key.slice("inventory_".length));
          }
        }
        return getInventory.apply(this, arguments);
      };
      guardedGet.__acxCompanyGuard = true;
      guardedGet.__acxOriginal = getInventory;
      W.getInventory = guardedGet;
    }

    if (typeof W.saveInventory === "function" && !W.saveInventory.__acxCompanyGuard) {
      var saveInventory = W.saveInventory;
      var guardedSave = function (warehouse, items) {
        var cid = companyId();
        if (!cid) {
          if (typeof W.showNotification === "function") W.showNotification("Select a valid company before saving stock.", "error");
          else W.alert("Select a valid company before saving stock.");
          return false;
        }
        if (!Array.isArray(items)) throw new Error("Inventory must be an array.");
        ensureItems(items, warehouse, cid, null);
        return saveInventory.apply(this, arguments);
      };
      guardedSave.__acxCompanyGuard = true;
      guardedSave.__acxOriginal = saveInventory;
      W.saveInventory = guardedSave;
    }

    if (typeof W.__getAllInventoriesCached === "function" && !W.__getAllInventoriesCached.__acxCompanyGuard) {
      var cachedAll = W.__getAllInventoriesCached;
      var guardedAll = function () {
        if (!companyId()) return [];
        return cachedAll.apply(this, arguments);
      };
      guardedAll.__acxCompanyGuard = true;
      guardedAll.__acxOriginal = cachedAll;
      W.__getAllInventoriesCached = guardedAll;
    }

    if (typeof W.getAllInventories === "function" && !W.getAllInventories.__acxCompanyGuard) {
      var all = W.getAllInventories;
      var guardedGetAll = function () {
        if (!companyId()) return [];
        return all.apply(this, arguments);
      };
      guardedGetAll.__acxCompanyGuard = true;
      guardedGetAll.__acxOriginal = all;
      W.getAllInventories = guardedGetAll;
    }

    if (typeof W.getMergedInventory === "function" && !W.getMergedInventory.__acxCompanyGuard) {
      var merged = W.getMergedInventory;
      var guardedMerged = function () {
        if (!companyId()) return [];
        return merged.apply(this, arguments);
      };
      guardedMerged.__acxCompanyGuard = true;
      guardedMerged.__acxOriginal = merged;
      W.getMergedInventory = guardedMerged;
    }
  }

  function wrapImport() {
    var original = W.importInventoryExcel;
    if (typeof original !== "function" || original.__acxStockCompanyGuard) return false;
    var guarded = function (event) {
      var cid = companyId();
      var input = event && event.target;
      var select = W.document.getElementById("warehouseSelect");
      var warehouse = select && select.value || "";
      var file = input && input.files && input.files[0];
      if (!cid) {
        W.alert("Stock import stopped: sign in to a company before importing inventory.");
        if (input) input.value = "";
        return;
      }
      if (!warehouse) {
        W.alert("Please select a warehouse before importing inventory.");
        if (input) input.value = "";
        return;
      }
      W.__acxStockImportContext = {
        companyId: cid,
        warehouse: warehouse,
        fileName: file && String(file.name || ""),
        token: String(Date.now()) + "-" + hash(cid + "|" + warehouse + "|" + (file && file.name || ""))
      };
      return original.apply(this, arguments);
    };
    guarded.__acxStockCompanyGuard = true;
    guarded.__acxOriginal = original;
    if (original.__syncSafe) guarded.__syncSafe = true;
    if (original.__stockFix) guarded.__stockFix = true;
    W.importInventoryExcel = guarded;
    return true;
  }

  function boot() {
    hookStorage();
    wrapInventoryFunctions();
    wrapImport();
    var cid = companyId();
    if (cid) {
      for (var i = 0; i < LS.length; i++) {
        var key = LS.key(i);
        if (key && key.indexOf("inventory_") === 0) {
          var warehouse = key.slice("inventory_".length);
          ensureWarehouse(warehouse);
        }
      }
    }
    invalidate();
  }

  W.__acxStockRepairStatus = function () {
    var cid = companyId(), count = 0;
    if (cid) {
      for (var i = 0; i < LS.length; i++) {
        var key = LS.key(i);
        if (key && key.indexOf("inventory_") === 0) {
          try {
            var items = JSON.parse(LS.getItem(key) || "[]");
            if (Array.isArray(items)) count += items.length;
          } catch (e) {}
        }
      }
    }
    return { active: !!cid, companyId: cid || null, inventoryItems: count, storageHooked: hooked };
  };

  boot();
  W.addEventListener("acx-idb-ready", boot);
  W.addEventListener("acx:company-changed", boot);
  W.addEventListener("storage", function (event) {
    if (event && event.key === "loggedInUser") setTimeout(boot, 0);
  });
})(window);
