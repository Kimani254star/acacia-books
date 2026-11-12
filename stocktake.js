(function () {
  'use strict';
  /* Acacia Stock Count - mobile stock take for Acacia Books.
   * Log in with the same company name, email and password as Books. Pick an open stock take (or a warehouse), count
   * (type, +/-, scan), then "Push to Assessment". Books puts the counts on the stock take and shows the variance in
   * Inventory > Assessment. Counts are kept on the phone until you clear them, so a dropped connection loses nothing.
   * The phone never shows system quantities, so counting is always blind. */
  var SUPA = 'https://xglsampckermarjpczdf.supabase.co', KEY = 'sb_publishable_x-dPR7pzhvJgag9soW0I8w_yfKTmi6A';
  var INBOX = 'stocktakeMobile', PAGE = 80;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var enc = encodeURIComponent;
  var LS = window.localStorage;
  function lget(k, d) { try { var v = JSON.parse(LS.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function lset(k, v) { try { LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Phone storage is full. Push your count now.'); return false; } }
  function pj(v) { try { for (var i = 0; i < 3 && typeof v === 'string'; i++) v = JSON.parse(v); } catch (e) { return null; } return v; }
  function fmt(n) { return (Math.round(Number(n) * 10000) / 10000).toLocaleString(undefined, { maximumFractionDigits: 4 }); }

  var tt = null;
  function toast(m, ms) { var t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(tt); tt = setTimeout(function () { t.style.display = 'none'; }, ms || 2200); }

  /* ---------- cloud (same Supabase project as Books) ---------- */
  function api(path, opt) {
    opt = opt || {};
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, opt.timeout || 25000);
    var h = Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, opt.headers || {});
    return fetch(SUPA + '/rest/v1/' + path, { method: opt.method || 'GET', headers: h, body: opt.body, signal: ctl.signal }).then(function (r) {
      clearTimeout(to);
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) { var er = new Error((j && j.message) || ('Request failed (' + r.status + ')')); er.status = r.status; er.code = j && j.code; throw er; }
        return j;
      });
    }, function (e) { clearTimeout(to); throw new Error(e && e.name === 'AbortError' ? 'The connection timed out.' : 'No internet connection.'); });
  }
  function getState(cid, key) {
    return api('company_state?select=value,updated_at&company_id=eq.' + enc(cid) + '&key=eq.' + enc(key)).then(function (a) { return a && a[0] || null; });
  }
  /* add/replace our entry in the shared inbox without overwriting other people's entries (compare-and-set on updated_at) */
  async function pushInbox(cid, sub) {
    for (var n = 0; n < 6; n++) {
      var cur = await getState(cid, INBOX), list = cur ? pj(cur.value) : [];
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (x) { return x && x.id !== sub.id; }); list.push(sub);
      var body = JSON.stringify(list), now = new Date().toISOString();
      try {
        var res;
        if (cur) res = await api('company_state?company_id=eq.' + enc(cid) + '&key=eq.' + enc(INBOX) + '&updated_at=eq.' + enc(cur.updated_at), { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ value: body, updated_at: now }) });
        else res = await api('company_state', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ company_id: cid, key: INBOX, value: body, updated_at: now }) });
        if (res && res.length) return true;
      } catch (e) { if (e.status !== 409 && e.code !== '23505') throw e; }
      await new Promise(function (r) { setTimeout(r, 300 + Math.random() * 700); });   /* someone else wrote at the same moment: read again and retry */
    }
    throw new Error('Could not save the count (busy). Try again.');
  }

  /* ---------- login (same account + password check as Books) ---------- */
  async function sha(s) { var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }
  async function orgMatches(cid, company) {
    var keys = ['orgInfo_' + cid, 'orgInfo'];
    for (var i = 0; i < keys.length; i++) {
      try { var r = await getState(cid, keys[i]), o = r && pj(r.value); if (o && (low(o.name) === company || low(o.companyId) === company)) return true; } catch (e) {}
    }
    return false;
  }
  async function doLogin(company, email, pass) {
    if (!(window.crypto && crypto.subtle)) throw new Error('Open this page over https to sign in.');
    email = low(email); company = low(company);
    /* the password is checked inside Postgres (acx_login); this page never sees a hash */
    async function rpcLogin(co) {
      var r = await fetch(SUPA + '/rest/v1/rpc/acx_login', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_email: email, p_password: pass, p_company: co || null }) });
      if (r.status === 404) return null;                                   /* acx_login not installed yet: old path below */
      if (r.status === 429 || r.status === 400) { var t = await r.text(); throw new Error(/lock|too many/i.test(t) ? 'Too many wrong attempts. Try again in a few minutes.' : 'Invalid email, company name or password.'); }
      if (!r.ok) throw new Error('Could not sign in (' + r.status + ').');
      var j = await r.json(); return Array.isArray(j) ? j : [];
    }
    function accept(r) {
      var d = Object.assign({}, r.data || {}); d.companyId = d.companyId || r.company_id;
      if (d.disabled === true || d.active === false || /^(inactive|disabled|suspended|blocked)$/i.test(String(d.status || ''))) throw new Error('This account is switched off. Ask your administrator.');
      try { if (r.session && window.AcxSession) window.AcxSession.add(r.session); } catch (e) {}
      return { companyId: d.companyId, companyName: d.companyName || company, email: d.email || email, name: d.name || d.fullName || d.username || d.email || email, role: d.role || '' };
    }
    var found = await rpcLogin(company);
    if (found && found.length) return accept(found[0]);
    if (found) {                                                           /* company name may only match the organisation profile: check that here */
      var any = await rpcLogin(null);
      for (var k = 0; k < (any || []).length; k++) {
        var cid = any[k].company_id; try { if (window.AcxSession && any[k].session) window.AcxSession.add(any[k].session); } catch (e) {}
        if (await orgMatches(cid, company)) return accept(any[k]);
      }
      throw new Error('Invalid email, company name or password.');
    }
    var rows = await api('app_accounts?select=login_id,username,company_id,data&or=(login_id.eq.' + enc(email) + ',username.eq.' + enc(email) + ')');
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i], d = Object.assign({}, r.data || {}); d.companyId = d.companyId || r.company_id;
      if (![d.email, d.username, r.login_id, r.username].some(function (x) { return low(x) === email; })) continue;
      var okC = low(d.companyName) === company || low(d.companyId) === company || (Array.isArray(d.previousCompanyNames) && d.previousCompanyNames.some(function (x) { return low(x) === company; }));
      if (!okC) okC = await orgMatches(d.companyId, company);
      if (!okC) continue;
      if (!(d.passwordHash && d.passwordSalt && (await sha(d.passwordSalt + ':' + pass)) === d.passwordHash)) continue;
      return accept(r);
    }
    throw new Error('Invalid email, company name or password.');
  }

  /* ---------- state ---------- */
  var U = lget('acxst_user', null), S = { screen: 'home', sess: null, tab: 'all', q: '', shown: PAGE, view: [], takes: [], whs: [], loadErr: '', loading: false, scanInc: lget('acxst_inc', true), poll: null };
  var ACCENTS = { blue: '#1e3a8a', green: '#166534', purple: '#6d28d9', teal: '#0f766e', red: '#b91c1c', slate: '#334155' };
  function applyLook() {
    var L = lget('acxst_look', {}), h = document.documentElement;
    if (L.theme === 'dark' || L.theme === 'light') h.setAttribute('data-theme', L.theme); else h.removeAttribute('data-theme');
    var c = ACCENTS[L.accent];
    if (c) { h.style.setProperty('--pri', c); h.style.setProperty('--pri2', c); } else { h.style.removeProperty('--pri'); h.style.removeProperty('--pri2'); }
    document.body.style.fontSize = ({ s: '14px', m: '16px', l: '18px' })[L.size] || '16px';
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', c || '#1e3a8a');
  }
  applyLook();
  var dev = LS.getItem('acxst_dev'); if (!dev) { dev = Math.random().toString(36).slice(2, 8); try { LS.setItem('acxst_dev', dev); } catch (e) {} }
  var skey = function (k) { return 'acxst_s_' + U.companyId + '_' + k; };
  var ikey = function () { return 'acxst_idx_' + U.companyId; };
  var saveT = null;
  function saveSess() { clearTimeout(saveT); saveT = setTimeout(function () { if (S.sess) lset(skey(S.sess.k), S.sess); }, 250); }
  function saveNow() { clearTimeout(saveT); if (S.sess) lset(skey(S.sess.k), S.sess); }
  function sessions() { return lget(ikey(), []).map(function (k) { return lget(skey(k), null); }).filter(Boolean); }
  function addIdx(k) { var a = lget(ikey(), []); if (a.indexOf(k) < 0) { a.push(k); lset(ikey(), a); } }
  function delSess(k) { LS.removeItem(skey(k)); lset(ikey(), lget(ikey(), []).filter(function (x) { return x !== k; })); }
  function stats(s) {
    var c = 0, units = 0; s.items.forEach(function (i) { var v = s.counts[i.key]; if (v != null) { c++; units += v; } });
    return { total: s.items.length, counted: c, left: s.items.length - c, units: units };
  }

  /* ---------- data for the home screen ---------- */
  async function loadHome(force) {
    var ck = 'acxst_cache_' + U.companyId, cache = lget(ck, null);
    if (cache && !force) { S.takes = cache.takes || []; S.whs = cache.whs || []; }
    S.loading = true; S.loadErr = ''; render();
    try {
      var rt = await getState(U.companyId, 'stockTakes'), rw = await getState(U.companyId, 'warehouses');
      var all = pj(rt && rt.value); all = Array.isArray(all) ? all : [];
      S.takes = all.filter(function (t) { return t && (t.status === 'Draft' || t.status === 'Counting'); }).map(function (t) {
        return { id: t.id, no: t.no, warehouse: t.warehouse, category: t.category || '', date: t.date || '', status: t.status, count: (t.lines || []).length,
          lines: (t.lines || []).map(function (l) { return { key: l.key || low(l.sku || l.name), name: l.name, sku: l.sku || '', barcode: l.barcode || '', category: l.category || '' }; }) };
      }).reverse();
      var w = pj(rw && rw.value); S.whs = (Array.isArray(w) ? w : []).map(function (x) { return x && x.name; }).filter(Boolean);
      lset(ck, { takes: S.takes.map(function (t) { return { id: t.id, no: t.no, warehouse: t.warehouse, category: t.category, date: t.date, status: t.status, count: t.count }; }), whs: S.whs });
    } catch (e) { S.loadErr = e.message + (cache ? ' Showing what was loaded last time.' : ''); }
    S.loading = false; render();
  }

  /* ---------- starting a count ---------- */
  function startTake(no) {
    var t = S.takes.filter(function (x) { return x.no === no; })[0]; if (!t) return;
    var k = 'T:' + t.no, s = lget(skey(k), null);
    if (!s && !t.lines) return toast('Tap the refresh button to load the items first.', 3000);
    if (!s) { s = { k: k, kind: 'take', takeNo: t.no, takeId: t.id, warehouse: t.warehouse, category: t.category, title: t.no + ' - ' + t.warehouse, startedAt: new Date().toISOString(), items: t.lines, counts: {} }; lset(skey(k), s); addIdx(k); }
    openCount(s);
  }
  async function startWarehouse(wh) {
    var k = 'W:' + wh, s = lget(skey(k), null);
    if (!s) {
      toast('Loading items...');
      try {
        var r = await getState(U.companyId, 'inventory_' + wh), a = pj(r && r.value); a = Array.isArray(a) ? a : [];
        var seen = {}, items = [];
        a.forEach(function (it) {
          if (!it || !it.name) return; var key = low(it.sku || it.name); if (seen[key]) return; seen[key] = 1;
          items.push({ key: key, name: it.name, sku: it.sku || '', barcode: it.barcode || '', category: it.category || it.categoryName || '' });
        });
        if (!items.length) return toast('No items found in ' + wh + '.');
        s = { k: k, kind: 'wh', takeNo: '', warehouse: wh, category: '', title: wh + ' (new count)', startedAt: new Date().toISOString(), items: items, counts: {} }; lset(skey(k), s); addIdx(k);
      } catch (e) { return toast(e.message); }
    }
    openCount(s);
  }
  function openCount(s) { S.sess = s; S.screen = 'count'; S.tab = 'all'; S.q = ''; S.shown = PAGE; render(); }

  /* ---------- counting ---------- */
  function setCount(key, v) {
    var s = S.sess; if (v == null || v === '') delete s.counts[key]; else s.counts[key] = v;
    s.pushedAt = null; saveSess(); progress();
  }
  function parseQ(v) {
    var x = String(v == null ? '' : v).replace(/\s/g, ''); if (x === '') return null;
    if (/^-?\d+,\d+$/.test(x)) x = x.replace(',', '.');
    if (!/^\d*\.?\d+$/.test(x)) return NaN; return parseFloat(x);
  }
  function filtered() {
    var s = S.sess, q = low(S.q);
    return s.items.filter(function (i) {
      var c = s.counts[i.key] != null;
      if (S.tab === 'todo' && c) return false; if (S.tab === 'done' && !c) return false;
      return !q || (low(i.name) + ' ' + low(i.sku) + ' ' + low(i.barcode) + ' ' + low(i.category)).indexOf(q) > -1;
    });
  }
  function rowHtml(i) {
    var v = S.sess.counts[i.key];
    return '<div class="row' + (v != null ? ' done' : '') + '" data-k="' + esc(i.key) + '"><div class="t"><b>' + esc(i.name) + '</b><span>' + esc([i.sku, i.barcode, i.category].filter(Boolean).join(' · ')) + '</span></div>' +
      '<div class="q"><button data-a="dec" aria-label="less">&minus;</button><input type="text" inputmode="decimal" data-a="inp" value="' + (v == null ? '' : esc(fmt(v))) + '" placeholder="-"><button data-a="inc" aria-label="more">+</button></div></div>';
  }
  function drawList() {
    var box = $('#list'); if (!box) return;
    S.view = filtered(); var out = S.view.slice(0, S.shown).map(rowHtml).join('');
    if (!S.view.length) out = '<div class="more center mute">' + (S.q ? 'Nothing matches "' + esc(S.q) + '".' : S.tab === 'todo' ? 'Everything has been counted.' : 'No items here yet.') + '</div>';
    else if (S.view.length > S.shown) out += '<div class="more"><button class="btn sec" data-a="more">Show more (' + (S.view.length - S.shown) + ' left)</button></div>';
    box.innerHTML = out;
  }
  function progress() {
    var st = stats(S.sess), a = $('#prog'), b = $('#bari'), f = $('#fcount');
    if (a) a.textContent = st.counted + ' of ' + st.total + ' counted';
    if (b) b.style.width = (st.total ? st.counted * 100 / st.total : 0) + '%';
    if (f) f.textContent = st.counted + ' / ' + st.total;
  }
  function rowEl(key) { var rs = document.querySelectorAll('#list .row'); for (var i = 0; i < rs.length; i++) if (rs[i].getAttribute('data-k') === key) return rs[i]; return null; }
  function refreshRow(key) {
    var r = rowEl(key); if (!r) return; var v = S.sess.counts[key];
    r.classList.toggle('done', v != null); r.querySelector('input').value = v == null ? '' : fmt(v);
  }
  function bump(key, d) {
    var cur = S.sess.counts[key], nv = cur == null ? (d > 0 ? d : 0) : Math.max(0, Math.round((cur + d) * 10000) / 10000);
    setCount(key, nv); refreshRow(key);
  }
  /* a scan (camera, Bluetooth scanner or typed code + Enter): exact barcode or SKU */
  function handleCode(code) {
    var c = low(code), s = S.sess, hit = null; if (!c) return null;
    for (var n = 0; n < s.items.length; n++) { var i = s.items[n]; if (low(i.barcode) === c || low(i.sku) === c) { hit = i; break; } }
    if (!hit) return { ok: false, msg: 'Not in this list: ' + code };
    if (S.scanInc) { bump(hit.key, 1); return { ok: true, msg: hit.name + ' → ' + fmt(s.counts[hit.key]) }; }
    S.q = hit.sku || hit.barcode || hit.name; S.tab = 'all'; S.shown = PAGE; var qi = $('#q'); if (qi) qi.value = S.q; drawList();
    var r = rowEl(hit.key); if (r) { r.classList.add('flash'); r.scrollIntoView({ block: 'center' }); var inp = r.querySelector('input'); if (inp) { inp.focus(); inp.select(); } }
    return { ok: true, msg: hit.name };
  }

  /* ---------- camera scanner ---------- */
  var cam = { stream: null, timer: null, zx: null, last: '', at: 0 };
  function beep() { try { var a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); setTimeout(function () { o.stop(); a.close(); }, 90); } catch (e) {} try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} }
  function onCam(code) {
    var now = Date.now(); if (code === cam.last && now - cam.at < 1800) return; cam.last = code; cam.at = now;
    var r = handleCode(code); if (!r) return; if (r.ok) beep(); $('#scanMsg').textContent = r.msg;
  }
  async function openScan() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return toast('This browser cannot open the camera. Use a Bluetooth scanner or type the code.');
    var sc = $('#scan'), vid = $('#scanVid'); sc.style.display = 'flex'; $('#scanMsg').textContent = 'Point the camera at a barcode';
    try {
      if ('BarcodeDetector' in window) {
        var want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code'], have = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : want;
        var det = new BarcodeDetector({ formats: want.filter(function (f) { return have.indexOf(f) > -1; }) });
        cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        vid.srcObject = cam.stream; await vid.play();
        cam.timer = setInterval(function () { if (vid.readyState < 2) return; det.detect(vid).then(function (r) { if (r && r.length) onCam(r[0].rawValue); }, function () {}); }, 220);
      } else {
        await new Promise(function (ok, no) { if (window.ZXing) return ok(); var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'; s.onload = ok; s.onerror = function () { no(new Error('Could not load the scanner. Check your connection.')); }; document.head.appendChild(s); });
        cam.zx = new ZXing.BrowserMultiFormatReader();
        cam.zx.decodeFromVideoDevice(null, vid, function (res) { if (res) onCam(res.getText()); });
      }
    } catch (e) { closeScan(); toast(e && e.name === 'NotAllowedError' ? 'Camera permission was blocked.' : (e.message || 'Could not start the camera.'), 3500); }
  }
  function closeScan() {
    clearInterval(cam.timer); cam.timer = null;
    try { if (cam.zx) cam.zx.reset(); } catch (e) {} cam.zx = null;
    if (cam.stream) { cam.stream.getTracks().forEach(function (t) { t.stop(); }); cam.stream = null; }
    var v = $('#scanVid'); if (v) v.srcObject = null; $('#scan').style.display = 'none';
  }

  /* ---------- push ---------- */
  async function doPush(by, zero) {
    var s = S.sess, lines = [];
    s.items.forEach(function (i) { var v = s.counts[i.key]; if (v == null && zero) v = 0; if (v != null) lines.push({ name: i.name, sku: i.sku, barcode: i.barcode, qty: v }); });
    if (!lines.length) throw new Error('Nothing has been counted yet.');
    var sub = { id: 'MC-' + dev + '-' + s.k.replace(/[^A-Za-z0-9_-]/g, '_'), by: by, byEmail: U.email, at: new Date().toISOString(), warehouse: s.warehouse, takeNo: s.takeNo || '', device: dev, applied: false, lines: lines };
    await pushInbox(U.companyId, sub);
    s.pushedAt = sub.at; s.subId = sub.id; s.pushedLines = lines.length; saveNow();
    return sub;
  }
  function startPoll(id) {
    clearInterval(S.poll); var n = 0;
    S.poll = setInterval(async function () {
      if (S.screen !== 'review' || ++n > 90) return clearInterval(S.poll);
      try {
        var r = await getState(U.companyId, INBOX), a = pj(r && r.value), m = Array.isArray(a) && a.filter(function (x) { return x && x.id === id; })[0], b = $('#recv'); if (!m || !b) return;
        if (m.applied === true) { b.className = 'msg ok'; b.innerHTML = '<b>Received in Books as ' + esc(m.takeNo) + '.</b><br>' + esc(m.matched) + ' item(s) counted' + (m.unmatched ? ', ' + esc(m.unmatched) + ' not found in the stock take' : '') + '. Open <b>Inventory &gt; Assessment</b> in Books and tap <b>View Variance</b>.'; clearInterval(S.poll); }
        else if (m.applied === 'rejected') { b.className = 'msg bad'; b.innerHTML = '<b>Books could not use this count.</b><br>' + esc(m.note || ''); clearInterval(S.poll); }
      } catch (e) {}
    }, 10000);
  }

  /* ---------- screens ---------- */
  function topbar(title, sub, back, right) {
    return '<div class="top">' + MENU + (back ? '<button class="ib" data-a="back" aria-label="back">&#8592;</button>' : '') + '<h1>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</h1>' + (right || '') + '</div>' + (navigator.onLine ? '' : '<div class="off">Offline - counts are saved on this phone</div>');
  }
  var MENU = '<button class="ib menu" data-a="menu" aria-label="menu">&#9776;</button>';
  function vLogin(err) {
    return '<div class="wrap"><img class="logo" src="acaciabooks-logo.png" alt=""><h1 class="center" style="margin:6px 0 2px;font-size:22px">Acacia Stock Count</h1><p class="center mute" style="margin:0 0 16px">Sign in with your Acacia Books login</p>' +
      '<div class="card"><label>Company name</label><input id="lc" type="text" autocomplete="organization" autocapitalize="none" value="' + esc(lget('acxst_lastco', '')) + '">' +
      '<label>Email</label><input id="le" type="email" autocomplete="username" autocapitalize="none" value="' + esc(lget('acxst_lastem', '')) + '">' +
      '<label>Password</label><input id="lp" type="password" autocomplete="current-password">' +
      (err ? '<div class="msg bad">' + esc(err) + '</div>' : '') + '<button class="btn" id="lgo" data-a="login">Sign in</button></div></div>';
  }
  function vHome() {
    var ss = sessions(), h = topbar('Dashboard', U.companyName + ' · ' + U.name, false, '<button class="ib" data-a="refresh" aria-label="refresh">&#8635;</button>') + '<div class="wrap">';
    if (S.loadErr) h += '<div class="msg warn">' + esc(S.loadErr) + '</div>';
    h += '<div class="card"><h2>On this phone</h2>';
    if (!ss.length) h += '<div class="mute">No counts started yet.</div>';
    ss.forEach(function (s) {
      var st = stats(s);
      h += '<div class="item"><div class="t"><b>' + esc(s.title) + '</b><span>' + st.counted + ' of ' + st.total + ' counted' + (s.pushedAt ? ' · sent ' + new Date(s.pushedAt).toLocaleString() : '') + '</span></div>' + (s.pushedAt ? '<span class="pill ok">sent</span>' : '') + '<button class="go" data-a="resume" data-k="' + esc(s.k) + '">Open</button></div>';
    });
    h += '</div><div class="card"><h2>Stock takes waiting in Books</h2>' + (S.loading ? '<div class="mute">Loading...</div>' : '');
    if (!S.loading && !S.takes.length) h += '<div class="mute">No open stock takes. Create one in Books (Inventory &gt; Assessment) or count a warehouse below.</div>';
    S.takes.forEach(function (t) {
      var mine = lget(skey('T:' + t.no), null);
      h += '<div class="item"><div class="t"><b>' + esc(t.no) + ' · ' + esc(t.warehouse) + '</b><span>' + esc(t.category || 'All categories') + ' · ' + t.count + ' items' + (t.date ? ' · ' + esc(t.date) : '') + '</span></div><button class="go" data-a="take" data-no="' + esc(t.no) + '">' + (mine ? 'Continue' : 'Count') + '</button></div>';
    });
    h += '</div><div class="card"><h2>Count a warehouse</h2><div class="mute" style="margin-bottom:8px">Books will add this count to that warehouse\'s open stock take, or start a new one.</div>';
    if (!S.whs.length && !S.loading) h += '<div class="mute">No warehouses loaded.</div>';
    S.whs.forEach(function (w) { h += '<div class="item"><div class="t"><b>' + esc(w) + '</b></div><button class="go" data-a="wh" data-w="' + esc(w) + '">' + (lget(skey('W:' + w), null) ? 'Continue' : 'Count') + '</button></div>'; });
    return h + '</div></div>';
  }
  function vCount() {
    var s = S.sess, st = stats(s);
    return '<div class="stick"><div class="top">' + MENU + '<button class="ib" data-a="back" aria-label="back">&#8592;</button><h1>' + esc(s.title) + '<small id="prog">' + st.counted + ' of ' + st.total + ' counted</small><div class="bar"><i id="bari" style="width:' + (st.total ? st.counted * 100 / st.total : 0) + '%"></i></div></h1><button class="ib" data-a="scan" aria-label="scan">&#128247;</button></div>' + (navigator.onLine ? '' : '<div class="off">Offline - counts are saved on this phone</div>') +
      '<div class="tools"><div class="srch"><input id="q" type="search" placeholder="Search, or scan a barcode / SKU" value="' + esc(S.q) + '" autocomplete="off"></div>' +
      '<div class="tabs"><button data-a="tab" data-t="all" class="' + (S.tab === 'all' ? 'on' : '') + '">All</button><button data-a="tab" data-t="todo" class="' + (S.tab === 'todo' ? 'on' : '') + '">To count</button><button data-a="tab" data-t="done" class="' + (S.tab === 'done' ? 'on' : '') + '">Counted</button></div>' +
      '<label class="sw"><input type="checkbox" id="inc"' + (S.scanInc ? ' checked' : '') + '> A scan adds 1 to the count</label></div></div>' +
      '<div id="list"></div><div class="foot"><div style="min-width:70px"><b id="fcount">' + st.counted + ' / ' + st.total + '</b><div class="mute" style="font-size:11px">counted</div></div><button class="btn" data-a="review">Review &amp; push</button></div>';
  }
  function vReview(msg) {
    var s = S.sess, st = stats(s), h = topbar('Push to Assessment', s.title, true) + '<div class="wrap"><div class="card"><div class="sum"><div><b>' + st.counted + '</b><span>items counted</span></div><div><b>' + st.left + '</b><span>not counted</span></div><div><b>' + fmt(st.units) + '</b><span>units counted</span></div><div><b>' + st.total + '</b><span>items on the list</span></div></div></div>';
    if (st.left && !s.pushedAt) h += '<div class="msg warn">' + st.left + ' item(s) have no count. They are left out of the variance unless you tick the box below. <button class="go" data-a="todo" style="margin-top:8px">Show items not counted</button></div>';
    if (s.pushedAt) {
      h += '<div class="msg ok"><b>Sent ' + esc(new Date(s.pushedAt).toLocaleTimeString()) + '.</b> ' + esc(s.pushedLines) + ' item(s) are waiting for Books.</div><div id="recv" class="msg warn">Waiting for Books to pick it up. Books must be open and signed in on a computer. You can close this screen.</div>' +
        '<button class="btn sec" data-a="back">Back to counting</button><button class="btn sec" data-a="clear">Clear this count from the phone</button>';
    } else {
      h += '<div class="card"><label>Counted by</label><input id="by" type="text" value="' + esc(lget('acxst_by', U.name)) + '">' +
        (st.left ? '<label class="sw" style="margin-top:14px"><input type="checkbox" id="zero"> Treat the ' + st.left + ' uncounted item(s) as 0 (not on the shelf)</label>' : '') + '</div>' +
        (msg ? '<div class="msg bad">' + esc(msg) + '</div>' : '') + '<button class="btn ok" id="pgo" data-a="push">Push to Assessment</button><button class="btn sec" data-a="back">Back to counting</button>';
    }
    return h + '</div>';
  }

  function vSide() {
    var on = (S.screen === 'reports' || S.screen === 'appearance') ? S.screen : 'home';
    function it(id, ico, label) { return '<button class="nav' + (on === id ? ' on' : '') + '" data-a="nav" data-s="' + id + '"><span>' + ico + '</span>' + label + '</button>'; }
    return '<aside class="side" id="side"><div class="sh"><img src="acaciabooks-logo.png" alt=""><div><b>Stock Count</b><small>' + esc(U.companyName || '') + '</small></div></div>' +
      '<nav>' + it('home', '&#9632;', 'Dashboard') + it('reports', '&#9776;', 'Reports') + it('appearance', '&#9788;', 'Appearance') + '</nav>' +
      '<div class="sf"><div class="mute" style="margin:0 12px 8px">' + esc(U.name || U.email || '') + '</div><button class="nav out" data-a="logout"><span>&#9211;</span>Log out</button></div></aside><div class="scrim" id="scrim" data-a="menu"></div>';
  }
  function vReports() {
    var ss = sessions(), sent = 0, units = 0, counted = 0, h = topbar('Reports', U.companyName + ' · ' + U.name, false, '') + '<div class="wrap">';
    ss.forEach(function (s) { var st = stats(s); if (s.pushedAt) sent++; units += st.units; counted += st.counted; });
    h += '<div class="card"><h2>Summary</h2><div class="sum"><div><b>' + ss.length + '</b><span>counts on this phone</span></div><div><b>' + sent + '</b><span>sent to Books</span></div><div><b>' + fmt(counted) + '</b><span>items counted</span></div><div><b>' + fmt(units) + '</b><span>units counted</span></div></div></div>';
    h += '<div class="card"><h2>Counts</h2>';
    if (!ss.length) h += '<div class="mute">No counts yet. Start one from the Dashboard.</div>';
    ss.slice().sort(function (a, b) { return String(b.startedAt || '').localeCompare(String(a.startedAt || '')); }).forEach(function (s) {
      var st = stats(s), pct = st.total ? Math.round(st.counted * 100 / st.total) : 0;
      h += '<div class="item"><div class="t"><b>' + esc(s.title) + '</b><span>' + st.counted + ' of ' + st.total + ' counted (' + pct + '%) · ' + fmt(st.units) + ' units · ' + st.left + ' left' + (s.startedAt ? ' · started ' + new Date(s.startedAt).toLocaleDateString() : '') + (s.pushedAt ? ' · sent ' + new Date(s.pushedAt).toLocaleString() : '') + '</span></div>' + (s.pushedAt ? '<span class="pill ok">sent</span>' : '<span class="pill warn">not sent</span>') + '<button class="go" data-a="resume" data-k="' + esc(s.k) + '">Open</button></div>';
    });
    return h + '</div></div>';
  }
  function vAppearance() {
    var L = lget('acxst_look', {}), th = L.theme || 'auto', ac = L.accent || 'blue', sz = L.size || 'm';
    function seg(a, cur, opts) { return '<div class="tabs">' + opts.map(function (o) { return '<button data-a="' + a + '" data-v="' + o[0] + '" class="' + (cur === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
    var sw = Object.keys(ACCENTS).map(function (k) { return '<button class="swatch' + (ac === k ? ' on' : '') + '" data-a="accent" data-v="' + k + '" style="background:' + ACCENTS[k] + '" aria-label="' + k + '"></button>'; }).join('');
    return topbar('Appearance', 'Saved on this phone', false, '') + '<div class="wrap"><div class="card"><h2>Theme</h2>' + seg('theme', th, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]) + '</div>' +
      '<div class="card"><h2>Colour</h2><div class="swatches">' + sw + '</div></div><div class="card"><h2>Text size</h2>' + seg('size', sz, [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) + '</div></div>';
  }
  function render() {
    var app = $('#app'); if (!app) return;
    if (!U) { app.innerHTML = vLogin(); return; }
    var body, after = null;
    if (S.screen === 'count' && S.sess) { body = vCount(); after = drawList; }
    else if (S.screen === 'review' && S.sess) { body = vReview(); after = function () { if (S.sess.pushedAt && S.sess.subId) startPoll(S.sess.subId); }; }
    else if (S.screen === 'reports') body = vReports();
    else if (S.screen === 'appearance') body = vAppearance();
    else { S.screen = 'home'; body = vHome(); }
    app.innerHTML = '<div class="shell">' + vSide() + '<main class="main">' + body + '</main></div>';
    if (after) after();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('[data-a]'); if (!b) return; var a = b.getAttribute('data-a');
    if (a === 'inp') return;
    if (a === 'menu') { var sd = $('#side'), sc = $('#scrim'); if (sd) { sd.classList.toggle('open'); sc.classList.toggle('on', sd.classList.contains('open')); } return; }
    if (a === 'nav') {
      var to = b.getAttribute('data-s'); clearInterval(S.poll); saveNow(); closeScan(); S.sess = null; S.screen = to; render();
      if (to === 'home') loadHome(); window.scrollTo(0, 0); return;
    }
    if (a === 'theme' || a === 'accent' || a === 'size') { var L = lget('acxst_look', {}); L[a] = b.getAttribute('data-v'); lset('acxst_look', L); applyLook(); render(); return; }
    if (a === 'login') {
      var c = $('#lc').value.trim(), em = $('#le').value.trim(), pw = $('#lp').value.trim();
      if (!c || !em || !pw) return toast('Enter company name, email and password.');
      b.disabled = true; b.textContent = 'Signing in...';
      try { U = await doLogin(c, em, pw); lset('acxst_user', U); lset('acxst_lastco', c); lset('acxst_lastem', em); S.screen = 'home'; loadHome(); }
      catch (er) { $('#app').innerHTML = vLogin(er.message); }
    }
    else if (a === 'logout') { if (confirm('Sign out? Counts not yet pushed stay on this phone.')) { LS.removeItem('acxst_user'); try { window.AcxSession && window.AcxSession.clear(true); } catch (e) {} U = null; S.sess = null; S.screen = 'home'; render(); } }
    else if (a === 'refresh') loadHome(true);
    else if (a === 'take') startTake(b.getAttribute('data-no'));
    else if (a === 'wh') startWarehouse(b.getAttribute('data-w'));
    else if (a === 'resume') { var s = lget(skey(b.getAttribute('data-k')), null); if (s) openCount(s); }
    else if (a === 'back') { clearInterval(S.poll); if (S.screen === 'review') { S.screen = 'count'; render(); } else { saveNow(); closeScan(); S.screen = 'home'; S.sess = null; render(); } }
    else if (a === 'tab') { S.tab = b.getAttribute('data-t'); S.shown = PAGE; render(); }
    else if (a === 'todo') { S.tab = 'todo'; S.screen = 'count'; S.shown = PAGE; render(); }
    else if (a === 'more') { S.shown += PAGE; drawList(); }
    else if (a === 'scan') openScan();
    else if (a === 'review') { saveNow(); S.screen = 'review'; render(); }
    else if (a === 'inc' || a === 'dec') { var r = b.closest('.row'); if (r) bump(r.getAttribute('data-k'), a === 'inc' ? 1 : -1); }
    else if (a === 'clear') { if (confirm('Remove this count from the phone? It cannot be undone.')) { delSess(S.sess.k); S.sess = null; S.screen = 'home'; render(); } }
    else if (a === 'push') {
      var by = ($('#by').value || '').trim() || U.name, zero = !!($('#zero') && $('#zero').checked), st = stats(S.sess);
      if (zero && !confirm('Mark ' + st.left + ' uncounted item(s) as 0? Books will show them as missing stock.')) return;
      if (!navigator.onLine) return toast('No internet. Your count is saved; push again when you are online.', 3500);
      lset('acxst_by', by); b.disabled = true; b.textContent = 'Sending...';
      try { await doPush(by, zero); render(); }
      catch (er) { $('#app').innerHTML = vReview(er.message); }
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'inc') { S.scanInc = t.checked; lset('acxst_inc', S.scanInc); return; }
    if (t.getAttribute && t.getAttribute('data-a') === 'inp') {
      var r = t.closest('.row'), k = r.getAttribute('data-k'), v = parseQ(t.value);
      if (isNaN(v)) { toast('Enter a number (0 or more).'); refreshRow(k); return; }
      setCount(k, v); refreshRow(k);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { S.q = e.target.value; S.shown = PAGE; clearTimeout(S.qt); S.qt = setTimeout(drawList, 150); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'q') { var v = e.target.value.trim(); if (!v) return; var r = handleCode(v); if (r && r.ok) { if (S.scanInc) { S.q = ''; e.target.value = ''; drawList(); } toast(r.msg); } e.preventDefault(); }
    else if (e.target.id === 'lp') { var g = $('#lgo'); if (g) g.click(); }
    else if (e.target.getAttribute && e.target.getAttribute('data-a') === 'inp') e.target.blur();
  });
  $('#scanClose').addEventListener('click', closeScan);
  window.addEventListener('online', function () { render(); });
  window.addEventListener('offline', function () { render(); });
  window.addEventListener('pagehide', saveNow);

  if (U) loadHome(); else render();
})();
