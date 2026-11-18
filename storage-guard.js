/* app-3.js calls these helpers while it loads (renderNonCurrentAssets), but merges.js is deferred and runs after it, so they were undefined and app-3.js stopped part-way. They live here, in the first script, so they exist in time. merges.js keeps its copy. */
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

/* Session header installer. It lives here (loaded first, not deferred) so window.fetch is wrapped BEFORE supabase-js
   creates its client in app-3.js; supabase-js keeps the fetch it sees at creation time. merges.js has the same block,
   guarded by "if (w.AcxSession) return", so it does nothing when this ran first. */
/* ===== merged from acacia-session.js ===== */
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
    var inBase = false;
    try {
      var a = list();
      var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      inBase = url.indexOf(BASE) === 0;
      if (a.length && inBase) {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          var h = new Headers(input.headers); h.set('x-acx-session', a.join(',')); input = new Request(input, { headers: h });
        } else {
          init = Object.assign({}, init); var hh = new Headers(init.headers || {}); hh.set('x-acx-session', a.join(',')); init.headers = hh;
        }
      }
    } catch (e) {}
    var pr = rawFetch.call(this, input, init);
    if (inBase) pr = pr.then(function (res) {
      /* the database refused the request because this browser has no valid session token: ask for the password once */
      try { if (res && (res.status === 401 || res.status === 403)) res.clone().text().then(function (t) { if (/42501|Not signed in for this company/.test(t)) askLogin(); }).catch(function () {}); } catch (e) {}
      return res;
    });
    return pr;
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

  /* Someone who signed in before sessions existed (or whose 30-day session ended) has no token. Ask for the password once, get one. */
  var asking = false, lastAsk = 0;
  function who() {
    var ks = ['loggedInUser', 'acacia_session', 'pos_session'];
    for (var i = 0; i < ks.length; i++) {
      try { var u = JSON.parse(localStorage.getItem(ks[i]) || 'null'); var em = u && (u.email || u.login_id || u.username); var co = u && (u.companyId || u.company_id);
        if (em && co) return { email: String(em), company: String(co) }; } catch (e) {}
    }
    return null;
  }
  function askLogin() {
    var u = who();
    if (asking || !u || !w.document || !w.document.body || Date.now() - lastAsk < 60000) return;
    asking = true; lastAsk = Date.now();
    var d = w.document, o = d.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:grid;place-items:center;font-family:inherit';
    o.innerHTML = '<div style="background:#fff;color:#111;border-radius:12px;padding:20px;width:min(380px,92vw);box-shadow:0 12px 40px #0006"><b style="font-size:16px">Confirm your password</b>' +
      '<p style="font-size:13px;margin:8px 0">To keep your data syncing securely, enter the password for <b class="acxWho"></b>.</p>' +
      '<input type="password" class="acxPw" autocomplete="current-password" style="width:100%;height:40px;padding:0 10px;border:1px solid #888;border-radius:8px;font:inherit;box-sizing:border-box;color:#111;background:#fff">' +
      '<p class="acxErr" style="color:#c00;font-size:12px;min-height:16px;margin:6px 0"></p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="acxLater" style="padding:8px 14px;border-radius:8px;border:1px solid #888;background:#fff;color:#111;cursor:pointer">Later</button>' +
      '<button type="button" class="acxGo" style="padding:8px 14px;border-radius:8px;border:0;background:#1e3a8a;color:#fff;cursor:pointer">Continue</button></div></div>';
    d.body.appendChild(o);
    o.querySelector('.acxWho').textContent = u.email;
    var pw = o.querySelector('.acxPw'), er = o.querySelector('.acxErr');
    function close(later) { try { o.remove(); } catch (e) {} asking = false; if (later) lastAsk = Date.now() + 540000; }
    async function go() {
      if (!pw.value) return; er.textContent = 'Checking...';
      var res = await login(u.email, pw.value, u.company);
      if (res.status === 'ok') { res.rows.forEach(function (x) { if (x && x.session) add(x.session); }); close(false); }
      else er.textContent = res.status === 'denied' ? 'That password is not correct.' : 'Could not reach the server. Try again.';
    }
    o.querySelector('.acxGo').onclick = go;
    o.querySelector('.acxLater').onclick = function () { close(true); };
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(function () { try { pw.focus(); } catch (e) {} }, 50);
  }

  w.AcxSession = { add: add, list: list, clear: clear, start: start, login: login, accountFirst: accountFirst, ask: askLogin };
})(window);

(function(){"use strict";if(window.__acxSpillGuard)return;var REAL,SP;try{REAL=window.localStorage;SP=Storage.prototype}catch(e){return}if(!REAL||!window.indexedDB)return;var lenDesc=Object.getOwnPropertyDescriptor(SP,"length");var oLen=lenDesc&&lenDesc.get;if(!oLen)return;window.__acxSpillGuard=true;var oGet=SP.getItem,oSet=SP.setItem,oRem=SP.removeItem,oKey=SP.key,oClr=SP.clear;var IDX="__acxSpillIdx",RES="__acxReserve";var S=Object.create(null);var idxKeys=Object.create(null);var delEarly=Object.create(null);var loaded=false,dbp=null;var q=Object.create(null),qn=0,qt=null;var extraCache=null,extraAt=0,extraVer=-1,ver=0;var bc=null,toasted=false;var BIG=100*1024;function bigOn(){return nget("acxBigSpill")!=="0"}function nget(k){try{return oGet.call(REAL,k)}catch(e){return null}}function hasS(){for(var k in S)return true;return false}function isQuota(e){return!!e&&(e.name==="QuotaExceededError"||e.name==="NS_ERROR_DOM_QUOTA_REACHED"||e.code===22||e.code===1014||/quota|storage/i.test(String(e.message||"")))}try{JSON.parse(nget(IDX)||"[]").forEach(function(k){idxKeys[k]=1})}catch(e){}var hadIdx=hasKeys(idxKeys);function hasKeys(o){for(var k in o)return true;return false}function writeIdx(){var ks=Object.keys(idxKeys);try{if(!ks.length){oRem.call(REAL,IDX);return}var v=JSON.stringify(ks);try{oSet.call(REAL,IDX,v)}catch(e){oRem.call(REAL,RES);oSet.call(REAL,IDX,v)}}catch(e2){try{console.warn("[storage-guard] could not store spill index",e2)}catch(x){}}setTimeout(ensureReserve,3e3)}function ensureReserve(){if(nget(RES)!==null)return;try{oSet.call(REAL,RES,new Array(8193).join("x"))}catch(e){}}function open(){if(dbp)return dbp;dbp=new Promise(function(res,rej){var r;try{r=indexedDB.open("acx_spill",1)}catch(e){return rej(e)}r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains("kv"))r.result.createObjectStore("kv")};r.onsuccess=function(){var d=r.result;var myp=dbp;d.onversionchange=function(){try{d.close()}catch(e){}dbp=null};d.onclose=function(){if(dbp&&dbp===myp)dbp=null};res(d)};r.onerror=function(){rej(r.error||new Error("IndexedDB open failed"))};r.onblocked=function(){rej(new Error("IndexedDB blocked"))}});dbp.catch(function(){dbp=null});return dbp}function loadAll(){return open().then(function(db){return new Promise(function(res,rej){var out=Object.create(null),tx=db.transaction("kv","readonly"),rq=tx.objectStore("kv").openCursor();rq.onsuccess=function(){var c=rq.result;if(c){out[c.key]=c.value;c.continue()}};tx.oncomplete=function(){res(out)};tx.onerror=tx.onabort=function(){rej(tx.error||new Error("spill read failed"))}})})}function toast(msg){if(toasted)return;toasted=true;try{var d=document.createElement("div");d.textContent=msg;d.style.cssText="position:fixed;left:16px;bottom:16px;max-width:380px;background:#b91c1c;color:#fff;padding:10px 14px;border-radius:8px;z-index:2147483647;font:13px/1.4 sans-serif";(document.body||document.documentElement).appendChild(d);setTimeout(function(){if(d.parentNode)d.parentNode.removeChild(d);toasted=false},12e3)}catch(e){toasted=false}}function sched(){if(!qt)qt=setTimeout(flush,20)}function qPut(k,v){if(!(k in q))qn++;q[k]={v:v};sched()}function qDel(k){if(!(k in q))qn++;q[k]={d:1};sched()}function flush(){if(qt){clearTimeout(qt);qt=null}if(!qn)return;var batch=q;q=Object.create(null);qn=0;open().then(function(db){return new Promise(function(res,rej){var tx=db.transaction("kv","readwrite"),os=tx.objectStore("kv");for(var k in batch){if(batch[k].d)os.delete(k);else os.put(batch[k].v,k)}tx.oncomplete=function(){res()};tx.onerror=tx.onabort=function(){rej(tx.error||new Error("spill write failed"))}})}).then(function(){flush.rt=0;var keys=[];for(var k in batch){keys.push(k);if(!batch[k].d&&k in S&&S[k]===batch[k].v){try{oRem.call(REAL,k)}catch(e){}}}ver++;extraCache=null;if(bc){try{bc.postMessage({keys:keys})}catch(e){}}},function(err){if((flush.rt||0)<3&&err&&/InvalidState|closing|closed/i.test(String(err.name)+" "+String(err.message))){flush.rt=(flush.rt||0)+1;dbp=null;for(var k2 in batch)if(!(k2 in q)){q[k2]=batch[k2];qn++}setTimeout(sched,200*flush.rt);return}try{console.error("[storage-guard] database write failed",err)}catch(e){}var lost=false;for(var k in batch){if(batch[k].d)continue;try{oSet.call(REAL,k,batch[k].v)}catch(e){lost=true}}if(lost)toast("Browser storage is full and the backup database is unavailable. Your latest changes may not be saved. Please export a backup.")})}window.addEventListener("pagehide",flush);document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")flush()});function spillPut(k,v){S[k]=v;delete delEarly[k];ver++;extraCache=null;qPut(k,v);if(!idxKeys[k]){idxKeys[k]=1;writeIdx()}}function spillDel(k){delete S[k];if(!loaded)delEarly[k]=1;qDel(k);if(idxKeys[k]){delete idxKeys[k];writeIdx()}ver++;extraCache=null}SP.getItem=function(k){if(this===REAL){k=String(k);if(k in S)return S[k]}return oGet.apply(this,arguments)};SP.setItem=function(k,v){if(this!==REAL)return oSet.apply(this,arguments);k=String(k);v=String(v);if(k in S||!loaded&&idxKeys[k]){spillPut(k,v);return}if(v.length>BIG&&k.indexOf("__acx")!==0&&bigOn()){spillPut(k,v);return}try{oSet.call(this,k,v)}catch(e){if(!isQuota(e))throw e;spillPut(k,v);try{console.info('[storage-guard] localStorage full, kept "'+k+'" in the database')}catch(x){}}};SP.removeItem=function(k){if(this===REAL){k=String(k);if(k in S||idxKeys[k])spillDel(k)}return oRem.apply(this,arguments)};SP.clear=function(){if(this===REAL){Object.keys(S).forEach(function(k){qDel(k);delete S[k]});idxKeys=Object.create(null);ver++;extraCache=null}return oClr.apply(this,arguments)};function extra(){var now=Date.now();if(extraCache&&extraVer===ver&&now-extraAt<100)return extraCache;var out=[];for(var k in S)if(nget(k)===null)out.push(k);extraCache=out;extraAt=now;extraVer=ver;return out}Object.defineProperty(SP,"length",{configurable:true,enumerable:lenDesc.enumerable,get:function(){var n=oLen.call(this);return this===REAL&&hasS()?n+extra().length:n}});SP.key=function(i){if(this!==REAL||!hasS())return oKey.apply(this,arguments);var n=oLen.call(this);i=Number(i)||0;if(i<n)return oKey.call(this,i);var x=extra();return x[i-n]!==undefined?x[i-n]:null};function fireChanged(keys){ver++;extraCache=null;window.__acxDataVersion=(window.__acxDataVersion||0)+1;keys.forEach(function(k){try{window.dispatchEvent(new StorageEvent("storage",{key:k}))}catch(e){}})}function migrateBig(){if(!bigOn())return;var n=oLen.call(REAL),ks=[],i,k,v;for(i=0;i<n;i++){k=oKey.call(REAL,i);if(k&&k.indexOf("__acx")!==0&&!(k in S))ks.push(k)}var moved=0;ks.forEach(function(key){v=nget(key);if(typeof v==="string"&&v.length>BIG){spillPut(key,v);moved++}});if(moved){try{console.info("[storage-guard] moved "+moved+" big value(s) out of localStorage")}catch(e){}}}var ready=loadAll().then(function(all){var changed=[];for(var k in all){if(typeof all[k]!=="string"||k in S||delEarly[k])continue;S[k]=all[k];changed.push(k);if(!idxKeys[k])idxKeys[k]=1}loaded=true;if(changed.length)fireChanged(changed);if(hasKeys(idxKeys))writeIdx();setTimeout(ensureReserve,1500);var go=function(){try{migrateBig()}catch(e){try{console.warn("[storage-guard] migrate",e)}catch(x){}}};if(window.requestIdleCallback)requestIdleCallback(go,{timeout:8e3});else setTimeout(go,4e3)},function(e){loaded=true;try{console.error("[storage-guard] could not read the spill database",e)}catch(x){}});if(hadIdx&&window.EventTarget&&EventTarget.prototype){var EP=EventTarget.prototype,orig=EP.addEventListener,held=[],released=false,dcl=false,ld=false;orig.call(document,"DOMContentLoaded",function(){dcl=true});orig.call(window,"load",function(){ld=true});EP.addEventListener=function(type,fn,opts){if(!released&&(type==="DOMContentLoaded"||type==="load")&&(this===window||this===document)&&fn){held.push({t:this,type:type,fn:fn,opts:opts,firedAtReg:type==="load"?ld:dcl});return}return orig.apply(this,arguments)};var release=function(){if(released)return;released=true;held.forEach(function(h){if(h.firedAtReg)return;var fired=h.type==="load"?ld:dcl;if(!fired){try{orig.call(h.t,h.type,h.fn,h.opts)}catch(e){}return}try{var ev=new Event(h.type);if(typeof h.fn==="function")h.fn.call(h.t,ev);else if(h.fn&&h.fn.handleEvent)h.fn.handleEvent(ev)}catch(e){console.error(e)}});held=[]};ready.then(release,release);setTimeout(release,5e3)}try{bc=new BroadcastChannel("acx_spill");bc.onmessage=function(ev){var keys=ev&&ev.data&&ev.data.keys;if(!keys||!keys.length||!loaded)return;open().then(function(db){var tx=db.transaction("kv","readonly"),os=tx.objectStore("kv"),got={};keys.forEach(function(k){var rq=os.get(k);rq.onsuccess=function(){got[k]=rq.result}});tx.oncomplete=function(){var changed=[];keys.forEach(function(k){if(k in q)return;if(got[k]===undefined){if(k in S){delete S[k];delete idxKeys[k];changed.push(k)}}else if(S[k]!==got[k]){S[k]=got[k];idxKeys[k]=1;changed.push(k)}});if(changed.length)fireChanged(changed)}},function(){})}}catch(e){bc=null}window.acxSpillStatus=function(){var rows=Object.keys(S).map(function(k){return{key:k,chars:String(S[k]).length}}).sort(function(a,b){return b.chars-a.chars});try{console.table(rows)}catch(e){}return rows}})();