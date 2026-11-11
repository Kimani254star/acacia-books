/* acacia-session.js - sends the Acacia session token with every Supabase request.
 * Load FIRST in <head> (before supabase-js / any app script). Tokens come from the acx_login RPC. */
(function (w) {
  'use strict';
  if (w.AcxSession) return;
  var BASE = 'https://xglsampckermarjpczdf.supabase.co/rest/v1/';
  var ANON = 'sb_publishable_x-dPR7pzhvJgag9soW0I8w_yfKTmi6A';
  var KEY = 'acx_sessions', MAX = 8, rawFetch = w.fetch;

  function list() { try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(function (t) { return /^[0-9a-f]{64}$/.test(t); }) : []; } catch (e) { return []; } }
  function save(a) { try { if (a.length) localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX))); else localStorage.removeItem(KEY); } catch (e) {} }
  function add(t) { if (!/^[0-9a-f]{64}$/.test(String(t || ''))) return; var a = list().filter(function (x) { return x !== t; }); a.push(t); save(a); }
  function clear(logout) {
    var a = list(); save([]);
    if (logout && rawFetch) a.forEach(function (t) {
      try { rawFetch.call(w, BASE + 'rpc/acx_logout', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: t }), keepalive: true }); } catch (e) {}
    });
  }

  if (rawFetch) w.fetch = function (input, init) {
    try {
      var a = list();
      var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      if (a.length && url.indexOf(BASE) === 0) {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          var h = new Headers(input.headers); h.set('x-acx-session', a.join(',')); input = new Request(input, { headers: h });
        } else {
          init = Object.assign({}, init); var hh = new Headers(init.headers || {}); hh.set('x-acx-session', a.join(',')); init.headers = hh;
        }
      }
    } catch (e) {}
    return rawFetch.call(this, input, init);
  };

  /* For apps whose own login runs in the browser (Books): after it succeeds, ask the server for a session. */
  async function start(email, password, company) {
    try {
      var r = await rawFetch.call(w, BASE + 'rpc/acx_login', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: String(email || '').trim().toLowerCase(), p_password: password, p_company: company || null }) });
      if (!r.ok) return false;
      var rows = await r.json(); if (!Array.isArray(rows) || !rows.length) return false;
      rows.forEach(function (x) { if (x && x.session) add(x.session); });
      return true;
    } catch (e) { return false; }
  }

  w.AcxSession = { add: add, list: list, clear: clear, start: start };
})(window);
