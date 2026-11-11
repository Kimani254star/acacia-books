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

  /* Ask the server to check a login. Returns {status:'ok'|'denied'|'missing'|'error', rows:[...]}; rows carry no password fields and one 'session' each.
     Nothing is stored: the caller decides which row to accept and calls add(row.session). */
  var recent = { k: '', t: 0 };
  async function login(email, password, company) {
    try {
      var em = String(email || '').trim().toLowerCase();
      var r = await rawFetch.call(w, BASE + 'rpc/acx_login', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: em, p_password: password, p_company: company || null }) });
      if (r.status === 404) return { status: 'missing', rows: [] };
      if (!r.ok) return { status: 'error', rows: [] };
      var rows = await r.json(); rows = Array.isArray(rows) ? rows : [];
      if (rows.length) recent = { k: em, t: Date.now() };
      return { status: rows.length ? 'ok' : 'denied', rows: rows };
    } catch (e) { return { status: 'network', rows: [] }; }
  }

  /* For apps whose own login runs in the browser (Books): after it succeeds, ask the server for a session. */
  async function start(email, password, company) {
    if (recent.k && recent.k === String(email || '').trim().toLowerCase() && Date.now() - recent.t < 60000) return true;   /* login() just did this */
    try {
      var r = await rawFetch.call(w, BASE + 'rpc/acx_login', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: String(email || '').trim().toLowerCase(), p_password: password, p_company: company || null }) });
      if (!r.ok) return false;
      var rows = await r.json(); if (!Array.isArray(rows) || !rows.length) return false;
      rows.forEach(function (x) { if (x && x.session) add(x.session); });
      return true;
    } catch (e) { return false; }
  }

  /* Books: check the password on the server first. Only when acx_login is missing or unreachable does it use the old
     'fallback' (which reads the account row). Returns the account data to merge into the local users list, or null. */
  async function accountFirst(email, company, fallback) {
    var pass = ''; try { pass = String((w.document.getElementById('loginPass') || {}).value || '').trim(); } catch (e) {}
    if (!pass) return fallback();
    var res = await login(email, pass, company);
    if (res.status === 'missing' || res.status === 'network') return fallback();
    if (res.status !== 'ok') return null;
    var row = res.rows[0];
    if (company && w.acxCompanyMatches) {
      var m = res.rows.filter(function (x) { var d = Object.assign({}, x.data || {}); d.companyId = d.companyId || x.company_id; return w.acxCompanyMatches(d, company); })[0];
      if (m) row = m;
    }
    var u = Object.assign({}, row.data || {}); u.companyId = u.companyId || row.company_id;
    /* the server just confirmed this password, so keep a salted hash of it on this device for the app's own local check */
    var sb = new Uint8Array(16); w.crypto.getRandomValues(sb);
    var salt = Array.prototype.map.call(sb, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    var dig = await w.crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pass));
    u.passwordHash = Array.prototype.map.call(new Uint8Array(dig), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    u.passwordSalt = salt; delete u.password;
    if (row.session) add(row.session);
    return u;
  }

  w.AcxSession = { add: add, list: list, clear: clear, start: start, login: login, accountFirst: accountFirst };
})(window);

/* HTML helpers used by the escaping done in app-1/2/3.js. They are defined here because this file loads first. */
(function (w) {
  if (!w.__invEsc) w.__invEsc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  /* for fields that may hold formatted text (notes, terms, descriptions): keep simple formatting, drop scripts, handlers and unsafe links */
  w.__acxClean = function (v) {
    if (v == null) return ''; v = String(v);
    if (!/[<&]/.test(v)) return v;
    try {
      var d = new DOMParser().parseFromString('<body>' + v + '</body>', 'text/html');
      d.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,svg,math,template').forEach(function (n) { n.remove(); });
      d.querySelectorAll('*').forEach(function (el) {
        Array.prototype.slice.call(el.attributes).forEach(function (a) {
          var n = a.name.toLowerCase(), val = a.value;
          if (n.indexOf('on') === 0 || n === 'srcdoc' || n === 'formaction' || ((n === 'href' || n === 'src' || n === 'action' || n === 'xlink:href') && !/^\s*(https?:|mailto:|tel:|#|\/|data:image\/(png|jpe?g|gif|webp);)/i.test(val))) el.removeAttribute(a.name);
        });
      });
      return d.body.innerHTML;
    } catch (e) { return w.__invEsc(v); }
  };
})(window);
