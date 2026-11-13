/* acacia-stock-doctor.js - shows why stock does not match between this device and the cloud, and repairs it.
 *
 * Open it:  add  ?stockdoctor=1  to the Books address (e.g. https://acacia-books.vercel.app/?stockdoctor=1)
 *           or run  acxStockDoctor()  in the browser console.
 * Run it on the device that has the FULL stock. It never changes anything until you press a button.
 *   1. Compare   - items on this device vs the cloud, per warehouse (count, size, last saved, differences)
 *   2. Deletion markers - old "deleted" markers for stock items (these made other devices drop items)
 *   3. Repair    - remove stock deletion markers; push this device's stock to the cloud
 * Load LAST in index.html (after acacia-stock-repair.js). */
(function (W) {
  "use strict";
  if (W.__acxStockDoctor) return;
  W.__acxStockDoctor = true;

  var LS = W.localStorage, lastPushErr = "";

  /* remember the last real push error the sync engine reported */
  (function () {
    if (console.__acxDocHook) return;
    var ow = console.warn;
    console.warn = function () {
      try {
        var a = arguments;
        if (String(a[0] || "").indexOf("[companySync] push") === 0 && a[1]) {
          var e = a[1];
          lastPushErr = typeof e === "object" ? ((e.code ? "[" + e.code + "] " : "") + String(e.message || e.details || e.hint || "")) : String(e);
        }
      } catch (x) {}
      return ow.apply(this, arguments);
    };
    console.__acxDocHook = true;
  })();

  function J(k, d) { try { var v = JSON.parse(LS.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function cid() { var u = J("loggedInUser", null); return u && u.companyId ? String(u.companyId) : ""; }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function nm(v) { return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " "); }
  function hdr(x) { var h = { apikey: W.__SUPA_KEY__, Authorization: "Bearer " + W.__SUPA_KEY__ }; for (var k in (x || {})) h[k] = x[k]; return h; }
  var REST = function () { return W.__SUPA_URL__ + "/rest/v1/company_state"; };

  function toList(v) {
    var x = v, n = 0;
    while (typeof x === "string" && n < 4) { try { x = JSON.parse(x); } catch (e) { return null; } n++; }
    return Array.isArray(x) ? x : null;
  }
  function localWarehouses() {
    var out = [];
    for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf("inventory_") === 0) out.push(k); }
    return out.sort();
  }
  function getCloud(key) {
    var url = REST() + "?company_id=eq." + encodeURIComponent(cid()) + "&key=eq." + encodeURIComponent(key) + "&select=value,updated_at&limit=1";
    return fetch(url, { cache: "no-store", headers: hdr() }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { return { error: "HTTP " + r.status + " " + t.slice(0, 160) }; });
      return r.json().then(function (rows) {
        if (!rows.length) return { missing: true };
        var raw = rows[0].value, txt = typeof raw === "string" ? raw : JSON.stringify(raw);
        return { list: toList(raw), kb: Math.round(txt.length / 102.4) / 10, at: rows[0].updated_at, native: typeof raw !== "string" };
      });
    }).catch(function (e) { return { error: "network: " + (e && e.message || e) }; });
  }
  function cloudKeys() {
    var url = REST() + "?company_id=eq." + encodeURIComponent(cid()) + "&key=like." + encodeURIComponent("inventory_*") + "&select=key,updated_at";
    return fetch(url, { cache: "no-store", headers: hdr() }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }

  /* deletion markers that point at stock items */
  function stockMarkers(liveByKey) {
    var t = J("tombstones", {}), dead = 0, onLive = 0, cols = 0;
    Object.keys(t || {}).forEach(function (col) {
      if (col.indexOf("inventory_") !== 0) return;
      cols++;
      var live = liveByKey[col] || {};
      Object.keys(t[col] || {}).forEach(function (id) {
        var e = t[col][id]; if (!e || !e[1]) return;
        dead++;
        if (live[id]) onLive++;
      });
    });
    return { cols: cols, dead: dead, onLive: onLive };
  }

  async function diagnose() {
    var rows = [], liveByKey = {}, keys = localWarehouses();
    var cl = await cloudKeys();
    cl.forEach(function (r) { if (keys.indexOf(r.key) < 0) keys.push(r.key); });
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], loc = J(k, null), lst = Array.isArray(loc) ? loc : null;
      var o = { key: k, wh: k.slice(10), local: lst ? lst.length : null, localKb: lst ? Math.round(JSON.stringify(lst).length / 102.4) / 10 : 0 };
      if (lst) {
        var ids = {}, dupId = 0, noId = 0, sku = {}, live = {};
        lst.forEach(function (it) {
          if (!it) return;
          if (it.id == null || it.id === "") noId++; else { if (ids[it.id]) dupId++; ids[it.id] = 1; live["i:id:" + it.id] = 1; }
          var s = String(it.sku || "").toLowerCase(); if (s) sku[s] = (sku[s] || 0) + 1;
        });
        liveByKey[k] = live; o.noId = noId; o.dupId = dupId;
        o.sharedSku = Object.keys(sku).filter(function (x) { return sku[x] > 1; }).length;
      }
      var c = await getCloud(k); o.cloud = c;
      if (c.list && lst) {
        var byId = {}, byName = {};
        c.list.forEach(function (it) { if (!it) return; if (it.id != null && it.id !== "") byId[it.id] = it; byName[nm(it.name)] = it; });
        var lid = {}, lname = {};
        lst.forEach(function (it) { if (!it) return; if (it.id != null && it.id !== "") lid[it.id] = 1; lname[nm(it.name)] = 1; });
        o.onlyLocal = lst.filter(function (it) { return it && !(it.id != null && byId[it.id]) && !byName[nm(it.name)]; }).length;
        o.onlyCloud = c.list.filter(function (it) { return it && !(it.id != null && lid[it.id]) && !lname[nm(it.name)]; }).length;
        o.qtyDiff = lst.filter(function (it) {
          if (!it) return false; var m = (it.id != null && byId[it.id]) || byName[nm(it.name)];
          return m && Math.abs(num(m.qty) - num(it.qty)) > 0.000001;
        }).length;
      }
      rows.push(o);
    }
    return { rows: rows, markers: stockMarkers(liveByKey), pushErr: lastPushErr, dirty: (function () { try { return Object.keys(W.__companyNS.dirty || {}).filter(function (x) { return /^inventory_/.test(x); }); } catch (e) { return []; } })() };
  }

  /* ---- repairs ---- */
  function clearStockMarkers() {
    var t = J("tombstones", {}), n = 0;
    Object.keys(t).forEach(function (col) { if (col.indexOf("inventory_") === 0) { n += Object.keys(t[col] || {}).length; delete t[col]; } });
    LS.setItem("tombstones", JSON.stringify(t));       /* the normal storage hook marks it for cloud sync */
    try { W.__companySync && W.__companySync.pushDirty && W.__companySync.pushDirty(); } catch (e) {}
    return n;
  }
  function forcePush(key) {
    var raw = LS.getItem(key);
    if (typeof raw !== "string" || raw.charAt(0) !== "[") return Promise.resolve("nothing to push for " + key);
    var row = { company_id: cid(), key: key, value: raw, updated_at: new Date().toISOString() };
    return fetch(REST() + "?on_conflict=company_id,key", {
      method: "POST", headers: hdr({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }), body: JSON.stringify([row])
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) { var m = t; try { var j = JSON.parse(t); m = (j.code ? "[" + j.code + "] " : "") + (j.message || j.details || j.hint || t); } catch (e) {} return "HTTP " + r.status + " " + String(m).slice(0, 220); }
        var back = []; try { back = JSON.parse(t) || []; } catch (e) {}
        if (!back.length) return "Supabase saved no row (a security rule is blocking writes from this browser)";
        try { var ver = W.__companySync.ver(); if (ver) ver[key] = back[0].updated_at; delete W.__companyNS.dirty[key]; } catch (e) {}
        return "";
      });
    }).catch(function (e) { return "network error: " + (e && e.message || e); });
  }

  /* ---- screen ---- */
  var box;
  function shell() {
    if (box) box.remove();
    box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:12px;font:14px/1.45 system-ui,sans-serif";
    box.innerHTML = '<div style="background:#fff;color:#111;max-width:860px;width:100%;max-height:92vh;overflow:auto;border-radius:12px;padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">Stock sync doctor</b><button id="sdClose" style="border:0;background:none;font-size:22px;cursor:pointer">&times;</button></div>' +
      '<div id="sdBody" style="margin-top:10px">Checking…</div></div>';
    document.body.appendChild(box);
    box.querySelector("#sdClose").onclick = function () { box.remove(); box = null; };
    return box.querySelector("#sdBody");
  }
  function btn(id, label, color) { return '<button id="' + id + '" style="margin:4px 6px 4px 0;padding:8px 12px;border:0;border-radius:8px;background:' + color + ';color:#fff;cursor:pointer;font:600 13px system-ui">' + label + '</button>'; }

  async function open() {
    if (!cid()) { alert("Sign in to a company first."); return; }
    if (!W.__SUPA_URL__ || !W.__SUPA_KEY__) { alert("Cloud is not configured on this page."); return; }
    var body = shell(), d;
    try { d = await diagnose(); } catch (e) { body.textContent = "Could not run the check: " + (e && e.message || e); return; }
    var h = '<div style="color:#555;margin-bottom:8px">Company <b>' + esc(cid()) + '</b>. Run this on the device that has the full stock.</div>';
    h += '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#f3f4f6;text-align:left"><th style="padding:6px">Warehouse</th><th>This device</th><th>Cloud</th><th>Only here</th><th>Only cloud</th><th>Qty differs</th><th>Items w/o id</th></tr>';
    d.rows.forEach(function (o) {
      var c = o.cloud, cs = c.error ? '<span style="color:#b91c1c">' + esc(c.error) + '</span>' : c.missing ? '<span style="color:#b91c1c">no row</span>' :
        !c.list ? '<span style="color:#b91c1c">unreadable format</span>' : c.list.length + " items, " + c.kb + " KB<br><small style='color:#666'>" + esc(String(c.at || "").replace("T", " ").slice(0, 19)) + (c.native ? " · native array" : "") + "</small>";
      h += '<tr style="border-top:1px solid #e5e7eb"><td style="padding:6px">' + esc(o.wh) + '</td><td>' + (o.local == null ? "-" : o.local + " items, " + o.localKb + " KB") + '</td><td>' + cs + '</td><td>' + (o.onlyLocal == null ? "-" : o.onlyLocal) + '</td><td>' + (o.onlyCloud == null ? "-" : o.onlyCloud) + '</td><td>' + (o.qtyDiff == null ? "-" : o.qtyDiff) + '</td><td>' + (o.noId == null ? "-" : o.noId + (o.dupId ? " (+" + o.dupId + " duplicate ids)" : "")) + '</td></tr>';
    });
    h += '</table>';
    h += '<div style="margin-top:12px;padding:10px;border-radius:8px;background:' + (d.markers.onLive ? "#fef2f2" : "#f9fafb") + '"><b>Deletion markers on stock:</b> ' + d.markers.dead + ' marked deleted' +
      (d.markers.onLive ? ' - <b style="color:#b91c1c">' + d.markers.onLive + ' of them point at items that exist on this device. Another device removes those items when it syncs.</b>' : ' (none point at current items)') + '</div>';
    h += '<div style="margin-top:8px;padding:10px;border-radius:8px;background:#f9fafb"><b>Waiting to upload:</b> ' + (d.dirty.length ? esc(d.dirty.join(", ")) : "nothing") + '<br><b>Last upload error:</b> ' + (d.pushErr ? '<span style="color:#b91c1c">' + esc(d.pushErr) + '</span>' : "none seen since this page opened") + '</div>';
    h += '<div style="margin-top:12px">' + btn("sdMark", "1. Remove stock deletion markers", "#7c3aed") + btn("sdPush", "2. Upload this device's stock to the cloud", "#047857") + btn("sdAgain", "Check again", "#374151") + '</div>';
    h += '<div id="sdMsg" style="margin-top:8px;color:#374151;white-space:pre-wrap"></div>';
    h += '<div style="margin-top:8px;color:#6b7280;font-size:12px">Step 2 replaces the cloud copy of each warehouse with this device\'s copy (last save wins). Do it only on the device with the correct, full stock.</div>';
    body.innerHTML = h;
    var msg = body.querySelector("#sdMsg");
    body.querySelector("#sdAgain").onclick = open;
    body.querySelector("#sdMark").onclick = function () { var n = clearStockMarkers(); msg.textContent = "Removed " + n + " stock deletion marker(s) and queued the change for the cloud. Now run step 2, then open Books on the other device."; };
    body.querySelector("#sdPush").onclick = async function () {
      var keys = d.rows.filter(function (o) { return o.local; }).map(function (o) { return o.key; });
      if (!keys.length) { msg.textContent = "This device has no stock to upload."; return; }
      if (!W.confirm("Replace the cloud stock with this device's stock for: " + keys.map(function (k) { return k.slice(10); }).join(", ") + "?")) return;
      msg.textContent = "Uploading…"; var out = [];
      for (var i = 0; i < keys.length; i++) { var r = await forcePush(keys[i]); out.push(keys[i].slice(10) + ": " + (r || "uploaded")); }
      msg.textContent = out.join("\n") + "\n\nClick “Check again” to confirm the counts match.";
    };
  }

  W.acxStockDoctor = open;
  if (/[?&]stockdoctor=1/.test(String(location.search))) {
    var n = 0, iv = setInterval(function () { if ((cid() && W.__companySync) || ++n > 60) { clearInterval(iv); if (cid()) setTimeout(open, 1500); } }, 500);
  }
})(window);
