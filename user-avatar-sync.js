/* Per-user avatar, synced across devices.
   - Each user's picture is stored under their own key (company + username/email), never shared.
   - Pictures are cropped square and shrunk to 256x256 JPEG before saving (about 15-30 KB), so they sync fast.
   - Saved in this browser (as before) AND in Supabase table app_user_avatars, so it follows the user to any device.
   - Newest change wins. If the cloud is unreachable the picture is kept locally and uploaded on the next sync.
   - Users with no picture get a coloured initials badge (the old placeholder service no longer works).

   Setup: run user-avatar-sync.sql in Supabase once, then add AFTER app-3.js (and after supabase-js):
       <script defer src="user-avatar-sync.js"></script>
   Uses the same window.__SUPA_URL__ / window.__SUPA_KEY__ as company-switcher-sync.js. */
(function () {
  'use strict';
  var TABLE = 'app_user_avatars', SIZE = 256, MAX_FILE = 10 * 1024 * 1024, EVERY = 60000;
  var COLORS = ['#1e3a8a', '#047857', '#b45309', '#7c3aed', '#be123c', '#0e7490', '#4d7c0f', '#a21caf'];

  function $(id) { return document.getElementById(id); }
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- who is logged in ---------- */
  function who() {
    var u = J('loggedInUser', null); if (!u) return null;
    var id = u.username || u.email || u.id; if (!id) return null;
    return { id: String(id), key: String(id).trim().toLowerCase(), company: String(u.companyId || ''), name: String(u.username || u.fullName || u.email || id) };
  }
  function keys(u) { return { img: '__userAvatar_' + u.id, at: '__userAvatarAt_' + u.id, dirty: '__userAvatarDirty_' + u.id }; }

  /* ---------- default badge ---------- */
  function colorFor(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  function initials(n) { var w = String(n || '?').trim().split(/\s+/); return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase(); }
  function badge(u) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="' + colorFor(u ? u.key : '?') +
      '"/><text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fff">' +
      esc(initials(u ? u.name : '?')) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function show(src, u) {
    var el = $('userAvatar'); if (!el) return;
    var want = src || badge(u);
    if (el.getAttribute('src') !== want) el.src = want;
    el.style.objectFit = 'cover'; el.title = 'Click to change your photo';
    el.onerror = function () { el.onerror = null; el.src = badge(u); };
  }

  /* ---------- Supabase ---------- */
  var sb = null;
  function client() {
    if (sb) return sb;
    if (!window.supabase || !window.__SUPA_URL__ || !window.__SUPA_KEY__) return null;
    try {
      sb = window.supabase.createClient(window.__SUPA_URL__, window.__SUPA_KEY__, {
        auth: { storageKey: 'acx-avatar-sync', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } catch (e) { sb = null; }
    return sb;
  }
  function push(u, dataUrl, at) {
    var c = client(), k = keys(u);
    if (!c) { try { localStorage.setItem(k.dirty, '1'); } catch (e) { } return Promise.resolve(false); }
    return Promise.resolve(c.from(TABLE).upsert(
      { company_id: u.company, user_key: u.key, avatar: dataUrl, updated_at: at }, { onConflict: 'company_id,user_key' }))
      .then(function (r) {
        if (r && r.error) throw r.error;
        try { localStorage.removeItem(k.dirty); } catch (e) { }
        return true;
      })
      .catch(function (e) { console.warn('[avatarSync] upload failed, will retry', e && e.message); try { localStorage.setItem(k.dirty, '1'); } catch (x) { } return false; });
  }

  /* ---------- sync one user ---------- */
  var busy = false;
  function sync(force) {
    var u = who(); if (!u) return Promise.resolve();
    var k = keys(u), localImg = localStorage.getItem(k.img) || '', localAt = localStorage.getItem(k.at) || '';
    show(localImg, u);                                   // instant: show what this browser already has
    var c = client(); if (!c || busy) return Promise.resolve();
    busy = true;
    return Promise.resolve(c.from(TABLE).select('avatar,updated_at').eq('company_id', u.company).eq('user_key', u.key).maybeSingle())
      .then(function (res) {
        if (res && res.error) throw res.error;
        var row = res && res.data, cloudAt = row ? String(row.updated_at || '') : '';
        var cloudNewer = row && row.avatar && (!localImg || !localAt || new Date(cloudAt) > new Date(localAt));
        if (cloudNewer) {                                // another device changed it: take it
          try { localStorage.setItem(k.img, row.avatar); localStorage.setItem(k.at, cloudAt); localStorage.removeItem(k.dirty); } catch (e) { }
          if (who() && who().key === u.key) show(row.avatar, u);
        } else if (localImg && (!row || localStorage.getItem(k.dirty) || new Date(localAt) > new Date(cloudAt))) {
          var at = localAt || new Date().toISOString();  // this device is newer (or first upload of an existing picture)
          try { localStorage.setItem(k.at, at); } catch (e) { }
          return push(u, localImg, at);
        }
      })
      .catch(function (e) { console.warn('[avatarSync] sync failed', e && e.message); })
      .then(function () { busy = false; });
  }

  /* ---------- choosing a new picture (replaces the old previewImage) ---------- */
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var fr = new FileReader();
      fr.onerror = function () { bad(new Error('Could not read the file')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { bad(new Error('That file is not a valid image')); };
        img.onload = function () {
          var s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = (img.height - s) / 2;
          var cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, SIZE, SIZE);
          cx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
          ok(cv.toDataURL('image/jpeg', 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  window.previewImage = function (e) {
    var f = e && e.target && e.target.files && e.target.files[0]; if (!f) return;
    var input = e.target, u = who();
    if (!u) { alert('User not logged in \u2014 cannot save avatar.'); input.value = ''; return; }
    if (!/^image\//.test(f.type)) { alert('Please choose an image file.'); input.value = ''; return; }
    if (f.size > MAX_FILE) { alert('That image is too large. Choose one under 10 MB.'); input.value = ''; return; }
    shrink(f).then(function (data) {
      var k = keys(u), at = new Date().toISOString();
      try { localStorage.setItem(k.img, data); localStorage.setItem(k.at, at); }
      catch (x) { alert('Browser storage is full \u2014 could not save the photo.'); return; }
      show(data, u);
      return push(u, data, at);
    }).catch(function (err) { alert(err.message || 'Could not use that image.'); })
      .then(function () { input.value = ''; });
  };

  /* ---------- keep it fresh ---------- */
  var last = '';
  function tick() {                                      // login / logout / switch company or user
    var u = who(), id = u ? u.company + '|' + u.key : '';
    if (id !== last) { last = id; if (u) sync(true); else show('', null); }
  }
  window.acxSyncAvatar = function () { return sync(true); };
  function boot() {
    tick();
    setInterval(tick, 2500);
    setInterval(function () { if (!document.hidden) sync(); }, EVERY);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    window.addEventListener('focus', function () { sync(); });
    window.addEventListener('online', function () { sync(true); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
