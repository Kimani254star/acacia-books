/* Acacia Books: "What's new" bell + Training (webinars). No dependencies.
   Add <script src="acacia-whatsnew.js" defer></script>, then after login call:
   AcaciaWhatsNew.init({ loginId:'user@email', companyId:'COMPANY_ID', userName:'Jane', mount:'#topbar' }) */
(function(w){
  var CFG = {}, A = [], W = [], N = {}, tab = 'new', popped = false, warned = {};
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var safe = function(u){ return /^https?:\/\//i.test(u || '') ? u : ''; };
  var $ = function(s){ return document.querySelector(s); };
  var K = function(p){ return 'awn_' + p + '_' + String(CFG.loginId).toLowerCase(); };
  var jg = function(k){ try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch(e){ return []; } };
  var js = function(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };
  var hd = function(x){ return Object.assign({ apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' }, x || {}); };
  var get = function(p){ return fetch(CFG.url + '/rest/v1/' + p, { headers: hd() }).then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; }); };
  var mine = function(r){ return !r.company_ids || !r.company_ids.length || r.company_ids.indexOf(String(CFG.companyId)) > -1; };
  var dt = function(d){ return new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
  var end = function(x){ return new Date(x.starts_at).getTime() + (x.duration_min || 60) * 60000; };

  function css(){
    if ($('#awnCss')) return;
    var s = document.createElement('style'); s.id = 'awnCss';
    s.textContent = '#awnBell{position:relative;border:0;background:transparent;cursor:pointer;font-size:20px;padding:6px 10px}#awnBell.awn-fixed{position:fixed;top:10px;right:70px;z-index:9990;background:#fff;border:1px solid #e5e7eb;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.12)}#awnDot{position:absolute;top:0;right:2px;min-width:18px;height:18px;border-radius:9px;background:#dc2626;color:#fff;font:700 11px/18px sans-serif;text-align:center;display:none}' +
      '#awnPanel{--b:#fff;--t:#1f2937;--m:#6b7280;--l:#e5e7eb;position:fixed;top:0;right:0;height:100%;width:min(420px,100vw);z-index:9991;background:var(--b);color:var(--t);box-shadow:-4px 0 24px rgba(0,0,0,.2);display:none;flex-direction:column;font:14px/1.45 system-ui,sans-serif}#awnPanel.open{display:flex}' +
      'html.dark #awnPanel,body.dark #awnPanel,[data-theme=dark] #awnPanel{--b:#111827;--t:#f3f4f6;--m:#9ca3af;--l:#374151}' +
      '.awn-h{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--l);font-weight:700}.awn-h button{background:none;border:0;font-size:20px;cursor:pointer;color:var(--t)}' +
      '.awn-tabs{display:flex;border-bottom:1px solid var(--l)}.awn-tabs button{flex:1;padding:10px;background:none;border:0;border-bottom:2px solid transparent;cursor:pointer;color:var(--m);font-weight:600}.awn-tabs button.on{color:#22615D;border-color:#22615D}' +
      '.awn-body{padding:12px;overflow-y:auto;flex:1}.awn-card{border:1px solid var(--l);border-radius:10px;padding:12px;margin-bottom:10px}.awn-new{border-color:#22615D;box-shadow:0 0 0 2px rgba(34,97,93,.15)}.awn-meta{display:flex;gap:8px;align-items:center;color:var(--m);font-size:12px}.awn-tag{background:#e6f2f1;color:#22615D;border-radius:999px;padding:1px 8px;font-weight:600}' +
      '.awn-card h4{margin:6px 0 4px;font-size:15px}.awn-card p{margin:0 0 6px;color:var(--m);white-space:pre-wrap}.awn-card summary{cursor:pointer;color:#22615D;font-weight:600}.awn-card ol{margin:6px 0 6px 18px;padding:0}.awn-card a,.awn-btn{display:inline-block;margin:4px 6px 0 0;padding:6px 12px;border-radius:8px;border:1px solid #22615D;color:#22615D;background:transparent;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none}.awn-btn.p{background:#22615D;color:#fff}.awn-btn[disabled]{opacity:.5;cursor:default}' +
      '#awnToast{position:fixed;bottom:20px;right:20px;z-index:9999;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;max-width:320px;display:none;font:14px system-ui,sans-serif}';
    document.head.appendChild(s);
  }
  function build(){
    if ($('#awnBell')) return;
    var b = document.createElement('button'); b.id = 'awnBell'; b.title = "What's new & training"; b.innerHTML = '🔔<span id="awnDot"></span>'; b.onclick = function(){ toggle(); };
    var m = CFG.mount && $(CFG.mount); if (m) m.appendChild(b); else { b.className = 'awn-fixed'; document.body.appendChild(b); }
    var p = document.createElement('div'); p.id = 'awnPanel';
    p.innerHTML = '<div class="awn-h"><span>What\'s new</span><button data-c>✕</button></div><div class="awn-tabs"><button data-t="new">New modules</button><button data-t="train">Training</button></div><div class="awn-body" id="awnBody"></div>';
    document.body.appendChild(p);
    var t = document.createElement('div'); t.id = 'awnToast'; document.body.appendChild(t);
    p.addEventListener('click', function(e){
      var x = e.target;
      if (x.hasAttribute('data-c')) toggle(false);
      if (x.dataset.t) { tab = x.dataset.t; draw(); }
      if (x.dataset.reg) register(x.dataset.reg);
      if (x.dataset.ics) ics(x.dataset.ics);
    });
  }
  function toast(m){ var t = $('#awnToast'); t.textContent = m; t.style.display = 'block'; setTimeout(function(){ t.style.display = 'none'; }, 5000); }
  function unseen(){
    var sa = jg(K('a')), sw = jg(K('w'));
    return { a: A.filter(function(x){ return sa.indexOf(x.id) < 0; }), w: W.filter(function(x){ return x.status === 'scheduled' && end(x) > Date.now() && sw.indexOf(x.id) < 0; }) };
  }
  function dot(){ var u = unseen(), n = u.a.length + u.w.length, d = $('#awnDot'); if (d) { d.textContent = n; d.style.display = n ? 'block' : 'none'; } }
  function toggle(on){
    var p = $('#awnPanel'); on = on == null ? !p.classList.contains('open') : on;
    p.classList.toggle('open', on);
    if (on) draw();
  }
  function draw(){
    if (!$('#awnPanel').classList.contains('open')) return;
    document.querySelectorAll('.awn-tabs button').forEach(function(b){ b.classList.toggle('on', b.dataset.t === tab); });
    var reg = jg(K('r')), u = unseen(), h = '';
    if (tab === 'new') {
      h = A.length ? A.map(function(a){
        var st = (a.steps || []).map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('');
        return '<div class="awn-card' + (u.a.indexOf(a) > -1 ? ' awn-new' : '') + '"><div class="awn-meta">' + (a.module ? '<span class="awn-tag">' + esc(a.module) + '</span>' : '') + '<span>' + dt(a.published_at) + '</span></div><h4>' + esc(a.title) + '</h4>' + (a.summary ? '<p>' + esc(a.summary) + '</p>' : '') + (st ? '<details' + (u.a.indexOf(a) > -1 ? ' open' : '') + '><summary>How to use it</summary><ol>' + st + '</ol></details>' : '') + (safe(a.video_url) ? '<a href="' + esc(a.video_url) + '" target="_blank" rel="noopener">▶ Watch video</a>' : '') + (safe(a.link) ? '<a href="' + esc(a.link) + '" target="_blank" rel="noopener">Read guide</a>' : '') + '</div>';
      }).join('') : '<p style="color:var(--m)">Nothing new yet.</p>';
      js(K('a'), A.map(function(x){ return x.id; }));
    } else {
      h = W.length ? W.map(function(x){
        var done = x.status === 'completed' || end(x) < Date.now(), r = reg.indexOf(x.id) > -1, n = N[x.id] || 0, full = x.capacity && n >= x.capacity;
        var open = Date.now() >= new Date(x.starts_at).getTime() - 15 * 60000 && !done, b = '';
        if (done) b = safe(x.recording_url) ? '<a href="' + esc(x.recording_url) + '" target="_blank" rel="noopener">▶ Watch recording</a>' : '<span class="awn-meta">Session ended</span>';
        else if (!r) b = '<button class="awn-btn p" data-reg="' + x.id + '"' + (full ? ' disabled' : '') + '>' + (full ? 'Full' : 'Register') + '</button>';
        else b = (open && safe(x.join_url) ? '<a class="awn-btn p" href="' + esc(x.join_url) + '" target="_blank" rel="noopener">Join now</a>' : '<span class="awn-tag">✓ Registered</span> <span class="awn-meta">Join link opens 15 min before</span>') + ' <button class="awn-btn" data-ics="' + x.id + '">Add to calendar</button>';
        return '<div class="awn-card' + (u.w.indexOf(x) > -1 ? ' awn-new' : '') + '"><div class="awn-meta">' + (x.module ? '<span class="awn-tag">' + esc(x.module) + '</span>' : '') + '<span>' + dt(x.starts_at) + ' · ' + (x.duration_min || 60) + ' min</span></div><h4>' + esc(x.title) + '</h4>' + (x.host ? '<div class="awn-meta">Host: ' + esc(x.host) + (x.capacity && !done ? ' · ' + Math.max(0, x.capacity - n) + ' seats left' : '') + '</div>' : '') + (x.description ? '<p>' + esc(x.description) + '</p>' : '') + b + '</div>';
      }).join('') : '<p style="color:var(--m)">No trainings scheduled yet.</p>';
      js(K('w'), W.map(function(x){ return x.id; }));
    }
    $('#awnBody').innerHTML = h; dot();
  }
  async function register(id){
    var r = await fetch(CFG.url + '/rest/v1/acacia_webinar_registrations?on_conflict=webinar_id,login_id', { method: 'POST', headers: hd({ Prefer: 'resolution=ignore-duplicates,return=minimal' }), body: JSON.stringify({ webinar_id: id, login_id: String(CFG.loginId).toLowerCase(), user_name: CFG.userName || '', company_id: String(CFG.companyId || '') }) }).catch(function(){ return null; });
    if (r && r.ok) { var l = jg(K('r')); if (l.indexOf(id) < 0) l.push(id); js(K('r'), l); N[id] = (N[id] || 0) + 1; toast("You're registered. The join link opens 15 minutes before the start."); }
    else {
      var t = ''; try { t = r ? await r.text() : ''; } catch(e){}
      var why = ''; try { var j = JSON.parse(t); why = j.message || j.hint || ''; } catch(e){ why = t; }
      console.error('[AcaciaWhatsNew] register failed', r ? r.status : 'network error', t);
      toast(/full/i.test(t) ? 'Sorry, this session is full.' : !r ? 'Could not reach the server. Check your internet and try again.' : 'Could not register (' + r.status + '): ' + String(why || 'unknown error').slice(0, 140));
    }
    draw();
  }
  function ics(id){
    var x = W.find(function(v){ return v.id === id; }), f = function(d){ return new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, ''); };
    var c = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:' + x.id + '@acacia\r\nDTSTAMP:' + f(Date.now()) + '\r\nDTSTART:' + f(x.starts_at) + '\r\nDTEND:' + f(end(x)) + '\r\nSUMMARY:' + String(x.title).replace(/[,;\n]/g, ' ') + '\r\nDESCRIPTION:Join: ' + (safe(x.join_url) || '') + '\r\nEND:VEVENT\r\nEND:VCALENDAR';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c], { type: 'text/calendar' })); a.download = 'training.ics'; a.click();
  }
  async function load(){
    var r = await Promise.all([
      get('acacia_announcements?status=eq.published&order=pinned.desc,published_at.desc&limit=50'),
      get('acacia_webinars?status=in.(scheduled,completed)&order=starts_at.asc&limit=50'),
      fetch(CFG.url + '/rest/v1/rpc/acx_webinar_counts', { method: 'POST', headers: hd(), body: '{}' }).then(function(x){ return x.ok ? x.json() : []; }).catch(function(){ return []; })
    ]);
    A = r[0].filter(mine);
    W = r[1].filter(mine).sort(function(a, b){ var da = end(a) < Date.now(), db = end(b) < Date.now(); return da === db ? (da ? new Date(b.starts_at) - new Date(a.starts_at) : new Date(a.starts_at) - new Date(b.starts_at)) : da - db; });
    N = {}; (r[2] || []).forEach(function(c){ N[c.webinar_id] = Number(c.n); });
    dot(); draw();
    if (!popped && unseen().a.length) { popped = true; tab = 'new'; setTimeout(function(){ toggle(true); }, 1200); }
    var reg = jg(K('r'));
    W.forEach(function(x){
      var d = new Date(x.starts_at) - Date.now(); if (reg.indexOf(x.id) < 0 || d <= 0) return;
      if (d < 30 * 60000) { if (!warned[x.id]) { warned[x.id] = 1; toast('Training "' + x.title + '" starts soon. Open the bell to join.'); } }
      else if (d < 24 * 3600000) { var k24 = K('d') + '_' + x.id; if (!warned[k24] && !localStorage.getItem(k24)) { warned[k24] = 1; try { localStorage.setItem(k24, '1'); } catch(e){} toast('Reminder: training "' + x.title + '" is on ' + dt(x.starts_at) + '. Open the bell for details.'); } }
    });
  }
  /* Change tracking: once every 6 hours per browser, tell Support which Books files have a new version (cheap HEAD requests, no file downloads) */
  setTimeout(async function(){ try {
    var TK = 'awn_track_t'; if (Date.now() - Number(localStorage.getItem(TK) || 0) < 6 * 3600000) return;
    var base = (w.__SUPA_URL__ || 'https://xglsampckermarjpczdf.supabase.co'), key = (w.__SUPA_KEY__ || 'sb_publishable_x-dPR7pzhvJgag9soW0I8w_yfKTmi6A');
    var urls = [location.href.split('#')[0].split('?')[0]].concat(Array.prototype.map.call(document.querySelectorAll('script[src],link[rel=stylesheet][href]'), function(e){ return e.src || e.href; }));
    var seen = {}, files = [];
    for (var i = 0; i < urls.length; i++) {
      var u; try { u = new URL(urls[i], location.href); } catch(e){ continue; }
      if (u.origin !== location.origin) continue;
      var name = u.pathname.replace(/^\//, '') || 'index.html'; if (/\/$/.test(u.pathname)) name = (name + 'index.html').replace(/^\//, ''); if (seen[name]) continue; seen[name] = 1;
      var r = await fetch(u.href.split('?')[0], { method: 'HEAD', cache: 'no-cache' }).catch(function(){ return null; });
      if (!r || !r.ok) continue;
      var len = r.headers.get('content-length') || '', lm = r.headers.get('last-modified') || '', et = (r.headers.get('etag') || '').replace(/^W\//, '');
      var sig = (lm || et) ? (lm || et) + '|' + len : ''; if (!sig) continue;
      files.push({ file: name, sig: sig, size: len });
    }
    if (!files.length) return;
    var rr = await fetch(base + '/rest/v1/rpc/acx_books_report', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ files: files }) }).catch(function(){ return null; });
    if (rr && rr.ok) localStorage.setItem(TK, String(Date.now()));
  } catch(e){} }, 15000);
  w.AcaciaWhatsNew = {
    init: function(o){
      if (!o || !o.loginId) return console.warn('[AcaciaWhatsNew] loginId is required');
      CFG = Object.assign({ url: 'https://xglsampckermarjpczdf.supabase.co', key: 'sb_publishable_x-dPR7pzhvJgag9soW0I8w_yfKTmi6A' }, o);
      css(); build(); load();
      if (!w.__awnTimer) { w.__awnTimer = setInterval(function(){ load(); }, 300000); document.addEventListener('visibilitychange', function(){ if (!document.hidden) load(); }); }
    },
    refresh: function(){ return load(); }, open: function(t){ if (t) tab = t; toggle(true); }
  };
  /* Books auto-start: follows the logged-in user and company (also after a company switch) */
  if (!w.__awnNoAuto) {
    var last = '';
    setInterval(function(){
      var u = null; try { u = JSON.parse(localStorage.getItem('loggedInUser') || 'null'); } catch(e){}
      var key = u && u.email && u.companyId ? String(u.email).toLowerCase() + '|' + u.companyId : '';
      var lay = document.getElementById('layout'); if (lay && lay.classList.contains('hidden')) key = '';
      if (key === last) return; last = key;
      var b = $('#awnBell'), p = $('#awnPanel');
      if (!key) { if (b) b.style.display = 'none'; if (p) p.classList.remove('open'); return; }
      if (b) b.style.display = '';
      A = []; W = []; popped = false;
      w.AcaciaWhatsNew.init({ loginId: u.email, companyId: u.companyId, userName: u.fullName || u.name || '', mount: '#awnMount' });
    }, 2000);
  }
})(window);
