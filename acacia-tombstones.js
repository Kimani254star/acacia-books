/* acacia-tombstones.js
 * Deletion tombstones so deleted records never come back after cloud sync,
 * a missing __syncbase_ baseline, or restoring an old Google backup.
 *
 * - Captures deletions automatically via __companyNS.onSetItem (listener gets key,newValue,oldValue).
 * - Stored as the per-company key "tombstones" => syncs through company_state like any other key.
 * - Shape: { "<collection>": { "<ident>": [timestampMs, 1|0] } }   1 = deleted, 0 = revived (Recycle-Bin restore / re-added)
 * - Newest timestamp wins when two copies are merged.
 * - Hooks called from app-3.js: filterVal, cleanKey, remote, snapshot.
 */
(function () {
  'use strict';
  if (window.__acxTomb) return;
  var KEY = 'tombstones';
  var IDF = ['id', '_id', 'uuid', 'invoiceNumber', 'billNumber', 'quoteNumber', 'orderNumber', 'receiptNumber', 'poNumber', 'grnNumber', 'sku']; // same order as sync ident()
  var SKIP = /(^|[_:])(audit|logs?|notif|notifications|history|session|cache|draft|recent|activity|backup|stamps?|tombstones)/i;
  var DEL_KEEP = 365 * 864e5, REV_KEEP = 30 * 864e5, MAX_ENTRIES = 20000;
  var pending = Object.create(null), timer = null;

  function ns() { return window.__companyNS; }
  function now() { return Date.now() + (window.__acxClockOffset || 0); }
  function comp() { try { var n = ns(); return n && n.activeCompany ? n.activeCompany() : null; } catch (e) { return null; } }
  function rawGet(k) { var n = ns(), c = comp(); if (!n || !c) return null; try { return n.nGet.call(n.real, k + n.SEP + c); } catch (e) { return null; } }
  function rawSet(k, v) { var n = ns(), c = comp(); if (!n || !c) return; try { n.nSet.call(n.real, k + n.SEP + c, v); } catch (e) {} }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function parse(s) { if (typeof s !== 'string' || s.charAt(0) !== '[') return null; try { var a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch (e) { return null; } }
  function parseT(s) { if (typeof s !== 'string') return {}; try { var o = JSON.parse(s); return isObj(o) ? o : {}; } catch (e) { return {}; } }
  function ident(r) {
    if (!isObj(r)) return null;
    for (var i = 0; i < IDF.length; i++) { var v = r[IDF[i]]; if (v != null && v !== '' && typeof v !== 'object') return 'i:' + IDF[i] + ':' + String(v); }
    return null; // hash-only records are not tombstoned
  }
  function trackable(k) {
    k = String(k);
    if (!k || k === KEY || SKIP.test(k) || k.indexOf('__') === 0) return false;
    var n = ns(); try { if (n && n.isGlobal && n.isGlobal(k)) return false; } catch (e) {}
    return true;
  }
  function loadT() { return parseT(rawGet(KEY)); }
  function saveT(t, touch) {
    prune(t);
    var s = JSON.stringify(t);
    if (s === rawGet(KEY)) return;
    // use the virtual localStorage so the normal dirty/push flow marks it for sync
    if (touch !== false) { try { window.localStorage.setItem(KEY, s); return; } catch (e) {} }
    rawSet(KEY, s);
  }
  function prune(t) {
    var cut = now(), total = 0, cols = Object.keys(t);
    cols.forEach(function (c) {
      var m = t[c];
      Object.keys(m).forEach(function (id) {
        var e = m[id], age = cut - e[0];
        if ((e[1] ? age > DEL_KEEP : age > REV_KEEP)) delete m[id]; else total++;
      });
      if (!Object.keys(m).length) delete t[c];
    });
    if (total > MAX_ENTRIES) { // drop oldest revived first, then oldest deleted
      var all = [];
      Object.keys(t).forEach(function (c) { Object.keys(t[c]).forEach(function (id) { all.push([c, id, t[c][id]]); }); });
      all.sort(function (a, b) { return (a[2][1] - b[2][1]) || (a[2][0] - b[2][0]); });
      for (var i = 0; i < all.length - MAX_ENTRIES; i++) { delete t[all[i][0]][all[i][1]]; }
    }
  }
  function mergeT(a, b) { // newest timestamp wins; tie => deleted wins
    var out = {};
    [a, b].forEach(function (src) {
      Object.keys(src || {}).forEach(function (c) {
        if (!isObj(src[c])) return;
        out[c] = out[c] || {};
        Object.keys(src[c]).forEach(function (id) {
          var e = src[c][id]; if (!Array.isArray(e)) return;
          var cur = out[c][id];
          if (!cur || e[0] > cur[0] || (e[0] === cur[0] && e[1] > cur[1])) out[c][id] = [e[0], e[1] ? 1 : 0];
        });
      });
    });
    return out;
  }
  function deadSet(t, col) {
    var m = t && t[col], s = null;
    if (!m) return null;
    Object.keys(m).forEach(function (id) { if (m[id][1]) { s = s || Object.create(null); s[id] = 1; } });
    return s;
  }
  function filterArr(arr, dead) {
    var out = [], n = 0;
    for (var i = 0; i < arr.length; i++) { var id = ident(arr[i]); if (id && dead[id]) n++; else out.push(arr[i]); }
    return { arr: out, n: n };
  }

  /* ---------- capture ---------- */
  function diff(key, oldS, newS) {
    var o = parse(oldS), n = parse(newS);
    if (!o || !n) return;
    var nowIds = Object.create(null), added = [], removed = [], i, id;
    for (i = 0; i < n.length; i++) { id = ident(n[i]); if (id) nowIds[id] = 1; }
    var oldIds = Object.create(null);
    for (i = 0; i < o.length; i++) { id = ident(o[i]); if (id) { oldIds[id] = 1; if (!nowIds[id]) removed.push(id); } }
    for (id in nowIds) if (!oldIds[id]) added.push(id);
    if (!removed.length && !added.length) return;
    var t = loadT(), ts = now(), changed = false, m = t[key] || (t[key] = {});
    removed.forEach(function (x) { m[x] = [ts, 1]; changed = true; });
    added.forEach(function (x) { if (m[x] && m[x][1]) { m[x] = [ts, 0]; changed = true; } }); // Recycle-Bin restore / re-created
    if (changed) saveT(t);
  }
  function flush() {
    var p = pending; pending = Object.create(null); clearTimeout(timer); timer = null;
    Object.keys(p).forEach(function (k) { try { diff(k, p[k].o, p[k].n); } catch (e) { console.warn('[tombstones] diff', k, e); } });
  }
  function onSet(key, newV, oldV) {
    if (typeof newV !== 'string' || typeof oldV !== 'string' || newV === oldV) return;
    if (newV.charAt(0) !== '[' || oldV.charAt(0) !== '[') return;
    if (!trackable(key)) return;
    var p = pending[key];
    if (p) p.n = newV; else pending[key] = { o: oldV, n: newV };
    if (!timer) timer = setTimeout(flush, 300);
  }

  /* ---------- hooks used by app-3.js ---------- */
  // remote collection value -> filtered value (never mutates input)
  function filterVal(key, val) {
    try {
      if (typeof val !== 'string' || val.charAt(0) !== '[' || key === KEY) return { v: val, n: 0 };
      flush();
      var dead = deadSet(loadT(), key); if (!dead) return { v: val, n: 0 };
      var a = parse(val); if (!a) return { v: val, n: 0 };
      var r = filterArr(a, dead);
      return r.n ? { v: JSON.stringify(r.arr), n: r.n } : { v: val, n: 0 };
    } catch (e) { return { v: val, n: 0 }; }
  }
  // purge tombstoned records from the LOCAL copy of one collection (silent: no listeners, no re-tombstoning)
  function cleanKey(key, e) {
    try {
      if (key === KEY) return 0;
      flush();
      var dead = deadSet(loadT(), key); if (!dead) return 0;
      var cur = rawGet(key), a = parse(cur); if (!a) return 0;
      var r = filterArr(a, dead); if (!r.n) return 0;
      var n = ns(); n.setApplying && n.setApplying(true);
      try { rawSet(key, JSON.stringify(r.arr)); } finally { n.setApplying && n.setApplying(false); }
      return r.n;
    } catch (x) { console.warn('[tombstones] cleanKey', key, x); return 0; }
  }
  // incoming "tombstones" value from the cloud: merge (never overwrite), then purge every local collection
  function remote(val, e) {
    var res = { changed: [], pushBack: false };
    try {
      flush();
      var local = loadT(), inc = parseT(val), merged = mergeT(local, inc);
      var s = JSON.stringify(merged), n = ns();
      if (s !== rawGet(KEY)) { n.setApplying && n.setApplying(true); try { rawSet(KEY, s); } finally { n.setApplying && n.setApplying(false); } }
      if (s !== JSON.stringify(inc)) { try { e.dirty[KEY] = 1; } catch (x) {} res.pushBack = true; }
      Object.keys(merged).forEach(function (col) { if (cleanKey(col, e)) { res.changed.push(col); try { e.dirty[col] = 1; } catch (x) {} } });
    } catch (x) { console.warn('[tombstones] remote', x); }
    return res;
  }
  // Google Backup restore: merge the backup's tombstones into local, then strip dead records out of the backup data
  function snapshot(t, companyId, e) {
    try {
      if (!t || !t.data) return;
      flush();
      var local = loadT(), bk = parseT(t.data[KEY]), merged = mergeT(local, bk), s = JSON.stringify(merged), n = ns();
      delete t.data[KEY];
      if (t.stamps) delete t.stamps[KEY];
      Object.keys(t.data).forEach(function (k) {
        var dead = deadSet(merged, k); if (!dead) return;
        var a = parse(t.data[k]); if (!a) return;
        var r = filterArr(a, dead); if (r.n) t.data[k] = JSON.stringify(r.arr);
      });
      if (s !== rawGet(KEY)) {
        rawSet(KEY, s);
        setTimeout(function () { try { n.touch && n.touch(KEY); } catch (x) {} }, 0); // mark for cloud push after applying flag clears
      }
      Object.keys(merged).forEach(function (col) { cleanKey(col, e); }); // local collections not in the backup
    } catch (x) { console.warn('[tombstones] snapshot', x); }
  }

  window.__acxTomb = { filterVal: filterVal, cleanKey: cleanKey, remote: remote, snapshot: snapshot, flush: flush, _ident: ident, _merge: mergeT };

  function hook() {
    var n = ns();
    if (!n || !n.onSetItem) return false;
    n.onSetItem(onSet);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
    return true;
  }
  if (!hook()) { var tries = 0, iv = setInterval(function () { if (hook() || ++tries > 50) clearInterval(iv); }, 200); }
})();
