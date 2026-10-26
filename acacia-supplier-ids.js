/* acacia-supplier-ids.js - gives every Books supplier an "id".
 *
 * Why: Books saved suppliers without an id (customers always had one). The other Acacia apps (Expenses, ...) match records by id,
 * so suppliers could not be linked and never showed up there. New suppliers now get an id when they are saved (app-2.js / app-3.js);
 * this script adds one to the suppliers that already exist, once, on load and whenever the supplier list is saved.
 * The id rule (bks-<hash of the name>, -2, -3 for same-name suppliers) is the same one acacia-bridge.js uses, so both sides agree.
 * Load LAST in index.html. */
(function (W) {
  'use strict';
  if (W.__acxSupplierIds) return;
  W.__acxSupplierIds = true;
  var busy = false, t = null;
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  function hx(s) { var o = '', k; for (k = 1; k <= 4; k++) { var x = 5381 * k, i; for (i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i) * k) | 0; o += ('00000000' + (x >>> 0).toString(16)).slice(-8); } return o; }
  function user() { try { return JSON.parse(localStorage.getItem('loggedInUser') || 'null'); } catch (e) { return null; } }

  function stamp() {
    if (busy || !user()) return;
    var raw, arr;
    try { raw = localStorage.getItem('suppliers'); if (!raw) return; arr = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    var used = {}, changed = 0, i, x;
    for (i = 0; i < arr.length; i++) { x = arr[i]; if (x && x.id != null && x.id !== '') used[String(x.id)] = 1; }
    for (i = 0; i < arr.length; i++) {
      x = arr[i];
      if (!x || typeof x !== 'object' || (x.id != null && x.id !== '') || !String(x.name || '').trim()) continue;
      var base = 'bks-' + hx(low(x.name)).slice(0, 10), id = base, n = 1;
      while (used[id]) { n++; id = base + '-' + n; }
      used[id] = 1; x.id = id; changed++;
    }
    if (!changed) return;
    busy = true;
    try { localStorage.setItem('suppliers', JSON.stringify(arr)); } catch (e) { console.warn('[supplier-ids]', e); }
    finally { busy = false; }
    try { if (typeof W.renderSuppliers === 'function') W.renderSuppliers(); } catch (e) {}
  }
  function soon() { clearTimeout(t); t = setTimeout(stamp, 400); }

  function hook() {
    var ns = W.__companyNS;
    if (ns && ns.onSetItem) { ns.onSetItem(function (k) { if (!busy && String(k) === 'suppliers') soon(); }); return true; }
    return false;
  }
  var tries = 0, h = setInterval(function () { if (hook() || ++tries > 40) clearInterval(h); }, 500);
  setInterval(function () { if (!document.hidden) stamp(); }, 15000);   /* also catches suppliers that arrive from the cloud */
  setTimeout(stamp, 2500); setTimeout(stamp, 8000);
})(window);
