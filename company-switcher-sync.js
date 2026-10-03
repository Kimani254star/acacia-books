/* Company switcher cloud sync.
   Problem: the switcher only listed companies whose user record was already stored on THIS browser.
   Fix: look up every company registered with the logged-in email in the cloud table app_accounts
   (one row per company_id + login_id) and add the missing ones to the local users / companies lists,
   so Company A, B, C, D created with the same email all show in the Organizations panel on any device.

   Load AFTER company-switcher-panel.js (and after app.js / app-2.js / app-3.js).
   Run company-switcher-sync.sql in Supabase once. */
(function () {
  'use strict';
  var last = 0, running = null;

  function NS() { return window.__companyNS; }
  function rawGet(k) { var n = NS(); try { return n ? n.nGet.call(n.real, k) : window.localStorage.getItem(k); } catch (e) { return null; } }
  function rawSet(k, v) { var n = NS(); try { n ? n.nSet.call(n.real, k, v) : window.localStorage.setItem(k, v); } catch (e) { } }
  function J(k, d) { try { var v = JSON.parse(rawGet(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }

  var sb = null;
  function client() {
    if (sb) return sb;
    if (!window.supabase || !window.__SUPA_URL__ || !window.__SUPA_KEY__) return null;
    try {
      sb = window.supabase.createClient(window.__SUPA_URL__, window.__SUPA_KEY__, {
        auth: { storageKey: 'acx-switcher-sync', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } catch (e) { sb = null; }
    return sb;
  }

  /* returns Promise<number> = how many companies were added locally */
  function sync(force) {
    if (running) return running;
    if (!force && Date.now() - last < 4000) return Promise.resolve(0);
    var me = J('loggedInUser', null), email = String((me && me.email) || '').trim().toLowerCase();
    var c = client();
    if (!email || !c) return Promise.resolve(0);
    last = Date.now();
    running = Promise.resolve(c.from('app_accounts').select('company_id,login_id,data').eq('login_id', email))
      .then(function (res) {
        if (!res || res.error || !res.data || !res.data.length) { if (res && res.error) console.warn('[switcherSync]', res.error.message); return 0; }
        var users = J('users', []); if (!Array.isArray(users)) users = [];
        var companies = J('companies', []); if (!Array.isArray(companies)) companies = [];
        var haveUser = {}, haveCo = {}, added = 0;
        users.forEach(function (u) { if (u && String(u.email || '').trim().toLowerCase() === email) haveUser[String(u.companyId || '')] = 1; });
        companies.forEach(function (x) { if (x && x.companyId) haveCo[String(x.companyId)] = 1; });
        res.data.forEach(function (r) {
          var d = Object.assign({}, r.data || {}), cid = String(d.companyId || r.company_id || '');
          if (!cid) return;
          d.companyId = cid;
          if (!d.email) d.email = email;
          if (!haveUser[cid]) { users.push(d); haveUser[cid] = 1; added++; }
          if (!haveCo[cid]) {
            companies.push({
              companyId: cid, companyName: d.companyName || cid, ownerName: d.fullName || d.username || '', email: email,
              plan: d.plan || 'Free', price: d.price || 0, status: d.status || 'active', registered: d.registered || new Date().toISOString(), expiry: d.expiry || ''
            });
            haveCo[cid] = 1; added++;
          }
        });
        if (added) { rawSet('users', JSON.stringify(users)); rawSet('companies', JSON.stringify(companies)); }
        return added;
      })
      .catch(function (e) { console.warn('[switcherSync] failed', e); return 0; })
      .then(function (n) { running = null; return n; });
    return running;
  }
  window.acxSyncMyCompanies = sync;

  function panelOpen() { var p = document.getElementById('acxOrgPanel'); return !!(p && p.classList.contains('open')); }

  function boot() {
    var prev = window.acxToggleCompanyMenu;
    if (typeof prev !== 'function') return setTimeout(boot, 400);
    if (prev.__sync) return;
    var wrapped = function (e) {
      var wasOpen = panelOpen(), ret = prev.apply(this, arguments);
      if (!wasOpen) {
        sync(true).then(function (n) {
          if (n && panelOpen()) { prev(); prev(); }      /* close + reopen so the new companies are drawn */
        });
      }
      return ret;
    };
    wrapped.__sync = true;
    window.acxToggleCompanyMenu = wrapped;
    /* also pull in the rest of my companies shortly after the app opens */
    setTimeout(function () { sync(true); }, 2500);
    setTimeout(function () { sync(true); }, 8000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
