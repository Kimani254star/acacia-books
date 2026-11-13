/* acacia-stock-sync.js - dedicated, per-company stock sync (replaces the generic sync for inventory_<warehouse> keys).
 *
 * Why: the generic sync merged stock with old cloud copies and "deleted" markers, so a second device could lose items and an
 * import could fail to reach the cloud. Stock now syncs on its own, one cloud row per (company id + warehouse), nothing else:
 *   - every request is limited to the signed-in company's id; if the active company is not that company, nothing runs;
 *   - this device remembers the last cloud version it synced (a "revision") and the last synced copy (the "base");
 *   - only this device changed  -> upload it;          only the cloud changed -> take the cloud copy;
 *   - both changed              -> 3-way merge (quantity changes from both sides are added together), then upload;
 *   - a new device (no base)    -> takes the cloud copy (or merges if it already holds items);
 *   - every upload is checked against the row Supabase returns, so "saved" always means saved.
 * The generic engine (app-3.js) skips inventory_ keys; Stock Take / Assessment keys are untouched.
 * Load LAST in index.html (after acacia-stock-repair.js). */
(function (W) {
  "use strict";
  if (W.__acxStockSync) return;
  W.__acxStockSync = true;

  var LS = W.localStorage, POLL_MS = 20000, DEBOUNCE_MS = 1500, busy = {}, again = {}, applying = false;
  var status = { state: "idle", msg: "", at: 0, byWh: {} };

  /* ---------- helpers ---------- */
  function J(k, d) { try { var v = JSON.parse(LS.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function ns() { return W.__companyNS || null; }
  function cid() {
    var u = J("loggedInUser", null), c = u && u.companyId && !u.demo ? String(u.companyId) : "", n = ns(), act = "";
    if (!c) return "";
    try { act = n && n.activeCompany ? String(n.activeCompany() || "") : c; } catch (e) { act = c; }
    return act && act !== c ? "" : c;              /* company mismatch => do nothing */
  }
  function REST() { return W.__SUPA_URL__ + "/rest/v1/company_state"; }
  function hdr(x) { var h = { apikey: W.__SUPA_KEY__, Authorization: "Bearer " + W.__SUPA_KEY__ }; for (var k in (x || {})) h[k] = x[k]; return h; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rawGet(k) { var n = ns(); try { return n.nGet.call(n.real, k); } catch (e) { return null; } }
  function rawSet(k, v) { var n = ns(); try { n.nSet.call(n.real, k, v); return true; } catch (e) { return false; } }
  function bKey(c, w) { return "__stkbase_" + c + "_" + w; }
  function rKey(c, w) { return "__stkrev_" + c + "_" + w; }
  function setStatus(state, msg, w) { status.state = state; status.msg = msg || ""; status.at = Date.now(); if (w) status.byWh[w] = { state: state, msg: msg || "", at: status.at }; }

  function toList(v) {
    var x = v, n = 0;
    while (typeof x === "string" && n < 4) { try { x = JSON.parse(x); } catch (e) { return null; } n++; }
    return Array.isArray(x) ? x : null;
  }
  function ensureIds(list, w) { try { if (typeof W.acxEnsureItemIds === "function") W.acxEnsureItemIds(list, null, false, w); } catch (e) {} return list; }
  function errText(t, status) { var m = t; try { var j = JSON.parse(t); m = (j.code ? "[" + j.code + "] " : "") + (j.message || j.details || j.hint || t); } catch (e) {} return "HTTP " + status + " " + String(m).slice(0, 220); }

  /* ---------- cloud calls (always filtered by company id + key) ---------- */
  function getRow(c, key) {
    var url = REST() + "?company_id=eq." + encodeURIComponent(c) + "&key=eq." + encodeURIComponent(key) + "&select=value,updated_at&limit=1";
    return fetch(url, { cache: "no-store", headers: hdr() }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("read failed: " + errText(t, r.status)); });
      return r.json();
    }).then(function (rows) { return rows && rows.length ? rows[0] : null; });
  }
  function listKeys(c) {
    var url = REST() + "?company_id=eq." + encodeURIComponent(c) + "&key=like." + encodeURIComponent("inventory_*") + "&select=key";
    return fetch(url, { cache: "no-store", headers: hdr() }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      return (rows || []).map(function (x) { return x.key; }).filter(function (k) { return /^inventory_/.test(k); });
    }).catch(function () { return []; });
  }
  /* upload: update only if the cloud is still at `rev`; otherwise insert when there is no row. Returns {ok,rev} | {conflict} | {error} */
  function putRow(c, key, valueStr, rev) {
    var now = new Date().toISOString(), req;
    if (rev) {
      req = fetch(REST() + "?company_id=eq." + encodeURIComponent(c) + "&key=eq." + encodeURIComponent(key) + "&updated_at=eq." + encodeURIComponent(rev), {
        method: "PATCH", headers: hdr({ "Content-Type": "application/json", Prefer: "return=representation" }), body: JSON.stringify({ value: valueStr, updated_at: now })
      });
    } else {
      req = fetch(REST(), {
        method: "POST", headers: hdr({ "Content-Type": "application/json", Prefer: "return=representation" }), body: JSON.stringify({ company_id: c, key: key, value: valueStr, updated_at: now })
      });
    }
    return req.then(function (r) {
      return r.text().then(function (t) {
        if (r.status === 409 || /23505|duplicate key/i.test(t)) return { conflict: true };
        if (!r.ok) return { error: errText(t, r.status) };
        var rows = []; try { rows = JSON.parse(t) || []; } catch (e) {}
        if (!rows.length) return rev ? { conflict: true, empty: true } : { error: "Supabase saved no row (a security rule is blocking writes from this browser)" };
        var back = toList(rows[0].value);
        if (!back) return { error: "Supabase stored the row but it cannot be read back as a list" };
        return { ok: true, rev: rows[0].updated_at || now, count: back.length };
      });
    }).catch(function (e) { return { error: "network error: " + (e && e.message || e) }; });
  }

  /* ---------- local writes ---------- */
  function writeLocal(w, listOrStr) {
    var n = ns(), c = cid(); if (!n || !c) return false;
    var str = typeof listOrStr === "string" ? listOrStr : JSON.stringify(listOrStr);
    applying = true;
    try {
      if (n.setApplying) n.setApplying(true);
      try { n.nSet.call(n.real, "inventory_" + w + n.SEP + c, str); } finally { if (n.setApplying) n.setApplying(false); }
    } catch (e) { applying = false; return false; }
    applying = false;
    try { if (n.dirty) delete n.dirty["inventory_" + w]; } catch (e) {}
    return true;
  }
  function refresh() {
    try { W.__invalidateInventoryCache && W.__invalidateInventoryCache(); } catch (e) {}
    ["stTopUp", "renderInventoryTable", "renderInventorySummary", "renderStockValuation", "renderStockReports", "renderPriceListTable"].forEach(function (f) {
      try { if (typeof W[f] === "function") W[f](); } catch (e) {}
    });
  }
  function remember(c, w, str, rev) { var ok = rawSet(bKey(c, w), str); rawSet(rKey(c, w), rev || ""); return ok; }

  /* ---------- the decision ---------- */
  function merge3(localArr, cloudArr, baseArr) {
    var M = W.__acxMerge;
    if (!M || typeof M.merge3 !== "function") return null;
    var base = baseArr ? M.fpOf(baseArr, true) : null;
    return M.merge3(localArr, cloudArr, base, { preferLocal: true, additive: ["qty"] });
  }

  /* one pass for one warehouse; resolves { ok, msg, changed } */
  async function syncOnce(c, w) {
    var key = "inventory_" + w, localStr = LS.getItem(key), baseStr = rawGet(bKey(c, w)), rev = rawGet(rKey(c, w)) || "";
    var local = toList(localStr);
    if (local) ensureIds(local, w);
    var cloudRow = await getRow(c, key);
    var cloud = cloudRow ? toList(cloudRow.value) : null;
    if (cloudRow && !cloud) throw new Error("the cloud row for " + w + " is not a readable list");
    if (cloud) ensureIds(cloud, w);
    var cloudRev = cloudRow ? cloudRow.updated_at : "";
    var localHas = !!(local && local.length);

    /* nothing in the cloud yet */
    if (!cloudRow) {
      if (!localHas) return { ok: true, msg: "nothing to sync", changed: false };
      var p0 = await putRow(c, key, JSON.stringify(local), "");
      if (p0.conflict) return { retry: true };
      if (p0.error) throw new Error(p0.error);
      remember(c, w, JSON.stringify(local), p0.rev);
      if (JSON.stringify(local) !== localStr) writeLocal(w, local);
      return { ok: true, msg: "uploaded " + p0.count + " item(s)", changed: false };
    }

    var hasBase = baseStr != null && baseStr !== "";
    var localChanged = hasBase ? (!!local && localStr !== baseStr && JSON.stringify(local) !== baseStr) : localHas;
    /* safety: never wipe a full cloud warehouse because this device suddenly holds none */
    if (hasBase && localChanged && local && !local.length && cloud && cloud.length > 5) {
      throw new Error("this device has no stock for " + w + " but the cloud has " + cloud.length + " items - not overwriting. Open Stock sync doctor.");
    }
    var cloudChanged = !hasBase || cloudRev !== rev;

    /* this device is new for this warehouse (no base) */
    if (!hasBase) {
      if (!localHas) {
        writeLocal(w, cloud); remember(c, w, JSON.stringify(cloud), cloudRev); refresh();
        return { ok: true, msg: "took " + cloud.length + " item(s) from the cloud", changed: true };
      }
      /* local already holds items: union by id, then upload */
      var u = merge3(local, cloud, null);
      if (!u) throw new Error("merge module is not loaded yet");
      ensureIds(u, w);
      var pu = await putRow(c, key, JSON.stringify(u), cloudRev);
      if (pu.conflict) return { retry: true };
      if (pu.error) throw new Error(pu.error);
      writeLocal(w, u); remember(c, w, JSON.stringify(u), pu.rev); refresh();
      return { ok: true, msg: "linked this device: " + pu.count + " item(s)", changed: true };
    }

    if (!localChanged && !cloudChanged) return { ok: true, msg: "in sync", changed: false };

    if (!localChanged && cloudChanged) {                                  /* only the cloud changed */
      writeLocal(w, cloud); remember(c, w, JSON.stringify(cloud), cloudRev); refresh();
      return { ok: true, msg: "took the newer cloud copy (" + cloud.length + " items)", changed: true };
    }

    if (localChanged && !cloudChanged) {                                  /* only this device changed */
      var body = JSON.stringify(local);
      var pl = await putRow(c, key, body, cloudRev);
      if (pl.conflict) return { retry: true };
      if (pl.error) throw new Error(pl.error);
      remember(c, w, body, pl.rev);
      if (body !== localStr) writeLocal(w, body);
      return { ok: true, msg: "uploaded " + pl.count + " item(s)", changed: false };
    }

    /* both changed: 3-way merge from the last synced copy */
    var m = merge3(local, cloud, toList(baseStr));
    if (!m) throw new Error("merge module is not loaded yet");
    ensureIds(m, w);
    var mb = JSON.stringify(m), pm = await putRow(c, key, mb, cloudRev);
    if (pm.conflict) return { retry: true };
    if (pm.error) throw new Error(pm.error);
    writeLocal(w, mb); remember(c, w, mb, pm.rev); refresh();
    return { ok: true, msg: "merged this device with the cloud: " + pm.count + " item(s)", changed: true };
  }

  /* sync one warehouse; never runs twice at once for the same warehouse */
  function syncNow(w) {
    var c = cid();
    if (!c) return Promise.resolve({ ok: false, msg: "no active company" });
    if (!W.__SUPA_URL__ || !W.__SUPA_KEY__) return Promise.resolve({ ok: false, msg: "cloud is not configured" });
    if (!navigator.onLine) return Promise.resolve({ ok: false, msg: "offline - will sync when the connection returns" });
    if (busy[w]) { again[w] = true; return busy[w]; }
    busy[w] = (async function () {
      var res = { ok: false, msg: "unknown" }, tries = 0;
      try {
        for (;;) {
          tries++;
          if (cid() !== c) { res = { ok: false, msg: "company changed during sync - stopped" }; break; }
          var r = await syncOnce(c, w);
          if (r.retry && tries < 4) { await wait(300 + Math.random() * 500); continue; }
          res = r.retry ? { ok: false, msg: "the cloud kept changing; will retry shortly" } : r;
          break;
        }
        setStatus(res.ok ? "ok" : "warn", res.msg, w);
      } catch (e) {
        res = { ok: false, msg: String(e && e.message || e) };
        setStatus("error", res.msg, w);
        console.warn("[stock-sync]", w, res.msg);
      } finally { delete busy[w]; }
      if (again[w]) { delete again[w]; setTimeout(function () { syncNow(w); }, 400); }
      return res;
    })();
    return busy[w];
  }

  function localWarehouses() {
    var out = [];
    for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf("inventory_") === 0) out.push(k.slice(10)); }
    return out;
  }
  async function syncAll() {
    var c = cid(); if (!c || !W.__SUPA_URL__) return [];
    var set = {}, results = [];
    localWarehouses().forEach(function (w) { set[w] = 1; });
    (await listKeys(c)).forEach(function (k) { set[k.slice(10)] = 1; });
    var list = Object.keys(set);
    for (var i = 0; i < list.length; i++) results.push({ warehouse: list[i], result: await syncNow(list[i]) });
    return results;
  }

  /* ---------- triggers ---------- */
  var timers = {};
  function hook() {
    var n = ns(); if (!n || !n.onSetItem) return false;
    n.onSetItem(function (k) {
      if (applying || !/^inventory_/.test(String(k))) return;
      var w = String(k).slice(10);
      clearTimeout(timers[w]);
      timers[w] = setTimeout(function () { syncNow(w); }, DEBOUNCE_MS);
    });
    return true;
  }
  var tries = 0;
  (function boot() {
    if (!hook() && ++tries < 40) return setTimeout(boot, 500);
    setTimeout(function () { syncAll(); }, 4000);
    setInterval(function () { if (!document.hidden) syncAll(); }, POLL_MS);
  })();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) syncAll(); });
  W.addEventListener("online", function () { syncAll(); });
  W.addEventListener("acx:company-changed", function () { setTimeout(syncAll, 1500); });
  W.addEventListener("pagehide", function () { /* push anything pending right now */ localWarehouses().forEach(function (w) { clearTimeout(timers[w]); }); });

  W.acxStockSync = {
    syncNow: syncNow, syncAll: syncAll, status: function () { return status; },
    /* test hooks */ _syncOnce: syncOnce
  };
})(window);
