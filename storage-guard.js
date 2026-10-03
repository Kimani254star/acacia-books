/* Storage guard - never lose data when browser storage (localStorage) is full.

   Problem: localStorage is limited (about 5 MB). When a write does not fit, the app showed
   "Browser storage is full or unavailable" and that save was lost.

   Fix: this file wraps the browser's own localStorage write at the lowest level. If a write is
   refused because the storage is full, the value is kept in an IndexedDB database ("acx_spill")
   instead and is served back to the app exactly as if it were still in localStorage:
     - getItem / setItem / removeItem / clear / key / length all see the spilled keys
     - works for EVERY key (company data, orgInfo, users, companies, logos, templates, ...)
     - spilled keys are included when the app lists localStorage keys (backups, cloud sync, export)
     - survives reloads; other open tabs are updated
   The red toast now only appears if the database ALSO refuses the write (device really out of space).

   INSTALL (once): in index.html add this line BEFORE  <script defer src="app-1.js"></script>
       <script src="storage-guard.js"></script>
   It must run before app-1.js because app-1.js captures the storage functions when it starts.

   Console helper:  acxSpillStatus()  -> table of keys currently kept in the database. */
(function () {
  'use strict';
  if (window.__acxSpillGuard) return;
  var REAL, SP;
  try { REAL = window.localStorage; SP = Storage.prototype; } catch (e) { return; }
  if (!REAL || !window.indexedDB) return;
  var lenDesc = Object.getOwnPropertyDescriptor(SP, 'length');
  var oLen = lenDesc && lenDesc.get;
  if (!oLen) return;
  window.__acxSpillGuard = true;

  var oGet = SP.getItem, oSet = SP.setItem, oRem = SP.removeItem, oKey = SP.key, oClr = SP.clear;
  var IDX = '__acxSpillIdx', RES = '__acxReserve';
  var S = Object.create(null);          // spilled key -> value (newest copy of that key)
  var idxKeys = Object.create(null);    // keys known to be spilled (also stored in localStorage as a tiny list)
  var delEarly = Object.create(null);   // removed before the database finished loading
  var loaded = false, dbp = null;
  var q = Object.create(null), qn = 0, qt = null;
  var extraCache = null, extraAt = 0, extraVer = -1, ver = 0;
  var bc = null, toasted = false;

  function nget(k) { try { return oGet.call(REAL, k); } catch (e) { return null; } }
  function hasS() { for (var k in S) return true; return false; }
  function isQuota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014 || /quota|storage/i.test(String(e.message || '')));
  }

  /* ---------- tiny index of spilled keys (so the next page load knows to wait for the database) ---------- */
  try { JSON.parse(nget(IDX) || '[]').forEach(function (k) { idxKeys[k] = 1; }); } catch (e) {}
  var hadIdx = hasKeys(idxKeys);
  function hasKeys(o) { for (var k in o) return true; return false; }
  function writeIdx() {
    var ks = Object.keys(idxKeys);
    try {
      if (!ks.length) { oRem.call(REAL, IDX); return; }
      var v = JSON.stringify(ks);
      try { oSet.call(REAL, IDX, v); }
      catch (e) { oRem.call(REAL, RES); oSet.call(REAL, IDX, v); }   // use the reserved space
    } catch (e2) { try { console.warn('[storage-guard] could not store spill index', e2); } catch (x) {} }
    setTimeout(ensureReserve, 3000);
  }
  function ensureReserve() {
    if (nget(RES) !== null) return;
    try { oSet.call(REAL, RES, new Array(8193).join('x')); } catch (e) {}
  }

  /* ---------- IndexedDB ---------- */
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r;
      try { r = indexedDB.open('acx_spill', 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
      r.onsuccess = function () { var d = r.result; d.onversionchange = function () { try { d.close(); } catch (e) {} dbp = null; }; res(d); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB open failed')); };
      r.onblocked = function () { rej(new Error('IndexedDB blocked')); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function loadAll() {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var out = Object.create(null), tx = db.transaction('kv', 'readonly'), rq = tx.objectStore('kv').openCursor();
        rq.onsuccess = function () { var c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } };
        tx.oncomplete = function () { res(out); };
        tx.onerror = tx.onabort = function () { rej(tx.error || new Error('spill read failed')); };
      });
    });
  }

  function toast(msg) {
    if (toasted) return; toasted = true;
    try {
      var d = document.createElement('div');
      d.textContent = msg;
      d.style.cssText = 'position:fixed;left:16px;bottom:16px;max-width:380px;background:#b91c1c;color:#fff;padding:10px 14px;border-radius:8px;z-index:2147483647;font:13px/1.4 sans-serif';
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); toasted = false; }, 12000);
    } catch (e) { toasted = false; }
  }

  /* ---------- write-behind queue ---------- */
  function sched() { if (!qt) qt = setTimeout(flush, 20); }
  function qPut(k, v) { if (!(k in q)) qn++; q[k] = { v: v }; sched(); }
  function qDel(k) { if (!(k in q)) qn++; q[k] = { d: 1 }; sched(); }
  function flush() {
    if (qt) { clearTimeout(qt); qt = null; }
    if (!qn) return;
    var batch = q; q = Object.create(null); qn = 0;
    open().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', 'readwrite'), os = tx.objectStore('kv');
        for (var k in batch) { if (batch[k].d) os.delete(k); else os.put(batch[k].v, k); }
        tx.oncomplete = function () { res(); };
        tx.onerror = tx.onabort = function () { rej(tx.error || new Error('spill write failed')); };
      });
    }).then(function () {
      var keys = [];
      for (var k in batch) {
        keys.push(k);
        /* safely stored in the database: drop the old (stale) localStorage copy to free space */
        if (!batch[k].d && (k in S) && S[k] === batch[k].v) { try { oRem.call(REAL, k); } catch (e) {} }
      }
      ver++; extraCache = null;
      if (bc) { try { bc.postMessage({ keys: keys }); } catch (e) {} }
    }, function (err) {
      try { console.error('[storage-guard] database write failed', err); } catch (e) {}
      var lost = false;
      for (var k in batch) {
        if (batch[k].d) continue;
        try { oSet.call(REAL, k, batch[k].v); } catch (e) { lost = true; }   // last chance: localStorage again
      }
      if (lost) toast('Browser storage is full and the backup database is unavailable. Your latest changes may not be saved. Please export a backup.');
    });
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  /* ---------- spill / unspill ---------- */
  function spillPut(k, v) {
    S[k] = v; delete delEarly[k]; ver++; extraCache = null;
    qPut(k, v);
    if (!idxKeys[k]) { idxKeys[k] = 1; writeIdx(); }
  }
  function spillDel(k) {
    delete S[k]; if (!loaded) delEarly[k] = 1;
    qDel(k);
    if (idxKeys[k]) { delete idxKeys[k]; writeIdx(); }
    ver++; extraCache = null;
  }

  /* ---------- wrap the native localStorage functions (only for the real localStorage object) ---------- */
  SP.getItem = function (k) {
    if (this === REAL) { k = String(k); if (k in S) return S[k]; }
    return oGet.apply(this, arguments);
  };
  SP.setItem = function (k, v) {
    if (this !== REAL) return oSet.apply(this, arguments);
    k = String(k); v = String(v);
    if ((k in S) || (!loaded && idxKeys[k])) { spillPut(k, v); return; }       // key already lives in the database
    try { oSet.call(this, k, v); }
    catch (e) {
      if (!isQuota(e)) throw e;
      spillPut(k, v);                                                          // storage full -> keep it in the database
      try { console.info('[storage-guard] localStorage full, kept "' + k + '" in the database'); } catch (x) {}
    }
  };
  SP.removeItem = function (k) {
    if (this === REAL) { k = String(k); if ((k in S) || idxKeys[k]) spillDel(k); }
    return oRem.apply(this, arguments);
  };
  SP.clear = function () {
    if (this === REAL) {
      Object.keys(S).forEach(function (k) { qDel(k); delete S[k]; });
      idxKeys = Object.create(null); ver++; extraCache = null;
    }
    return oClr.apply(this, arguments);
  };

  /* spilled keys that no longer exist in localStorage must still be listed by key()/length */
  function extra() {
    var now = Date.now();
    if (extraCache && extraVer === ver && now - extraAt < 100) return extraCache;
    var out = [];
    for (var k in S) if (nget(k) === null) out.push(k);
    extraCache = out; extraAt = now; extraVer = ver;
    return out;
  }
  Object.defineProperty(SP, 'length', {
    configurable: true, enumerable: lenDesc.enumerable,
    get: function () { var n = oLen.call(this); return (this === REAL && hasS()) ? n + extra().length : n; }
  });
  SP.key = function (i) {
    if (this !== REAL || !hasS()) return oKey.apply(this, arguments);
    var n = oLen.call(this); i = Number(i) || 0;
    if (i < n) return oKey.call(this, i);
    var x = extra(); return x[i - n] !== undefined ? x[i - n] : null;
  };

  /* ---------- load what is already in the database ---------- */
  function fireChanged(keys) {
    ver++; extraCache = null;
    window.__acxDataVersion = (window.__acxDataVersion || 0) + 1;
    keys.forEach(function (k) { try { window.dispatchEvent(new StorageEvent('storage', { key: k })); } catch (e) {} });
  }
  var ready = loadAll().then(function (all) {
    var changed = [];
    for (var k in all) {
      if (typeof all[k] !== 'string' || (k in S) || delEarly[k]) continue;   // a newer write in this session wins
      S[k] = all[k]; changed.push(k);
      if (!idxKeys[k]) idxKeys[k] = 1;
    }
    loaded = true;
    if (changed.length) fireChanged(changed);
    if (hasKeys(idxKeys)) writeIdx();
    setTimeout(ensureReserve, 1500);
  }, function (e) {
    loaded = true;
    try { console.error('[storage-guard] could not read the spill database', e); } catch (x) {}
  });

  /* hold DOMContentLoaded / load handlers until the database is read (only when something was spilled before) */
  if (hadIdx && window.EventTarget && EventTarget.prototype) {
    var EP = EventTarget.prototype, orig = EP.addEventListener, held = [], released = false, dcl = false, ld = false;
    orig.call(document, 'DOMContentLoaded', function () { dcl = true; });
    orig.call(window, 'load', function () { ld = true; });
    EP.addEventListener = function (type, fn, opts) {
      if (!released && (type === 'DOMContentLoaded' || type === 'load') && (this === window || this === document) && fn) {
        held.push({ t: this, type: type, fn: fn, opts: opts, firedAtReg: type === 'load' ? ld : dcl });
        return;
      }
      return orig.apply(this, arguments);
    };
    var release = function () {
      if (released) return; released = true;      // the wrapper stays installed (other code may wrap on top of it)
      held.forEach(function (h) {
        if (h.firedAtReg) return;
        var fired = h.type === 'load' ? ld : dcl;
        if (!fired) { try { orig.call(h.t, h.type, h.fn, h.opts); } catch (e) {} return; }
        try {
          var ev = new Event(h.type);
          if (typeof h.fn === 'function') h.fn.call(h.t, ev); else if (h.fn && h.fn.handleEvent) h.fn.handleEvent(ev);
        } catch (e) { console.error(e); }
      });
      held = [];
    };
    ready.then(release, release);
    setTimeout(release, 5000);
  }

  /* ---------- other tabs ---------- */
  try {
    bc = new BroadcastChannel('acx_spill');
    bc.onmessage = function (ev) {
      var keys = ev && ev.data && ev.data.keys;
      if (!keys || !keys.length || !loaded) return;
      open().then(function (db) {
        var tx = db.transaction('kv', 'readonly'), os = tx.objectStore('kv'), got = {};
        keys.forEach(function (k) { var rq = os.get(k); rq.onsuccess = function () { got[k] = rq.result; }; });
        tx.oncomplete = function () {
          var changed = [];
          keys.forEach(function (k) {
            if (k in q) return;
            if (got[k] === undefined) { if (k in S) { delete S[k]; delete idxKeys[k]; changed.push(k); } }
            else if (S[k] !== got[k]) { S[k] = got[k]; idxKeys[k] = 1; changed.push(k); }
          });
          if (changed.length) fireChanged(changed);
        };
      }, function () {});
    };
  } catch (e) { bc = null; }

  window.acxSpillStatus = function () {
    var rows = Object.keys(S).map(function (k) { return { key: k, chars: String(S[k]).length }; })
      .sort(function (a, b) { return b.chars - a.chars; });
    try { console.table(rows); } catch (e) {}
    return rows;
  };
})();
