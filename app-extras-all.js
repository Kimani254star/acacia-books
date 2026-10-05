/* app-extras-all.js = account-guard + plan-expiry + app-extras (notifications etc.) + recurring-bills.
   Replaces: app-extras-guard.js, app-extras.js, recurring-bills.js */
/* ======================= app-extras-guard.js (includes app-extras.js) ======================= */
/* ===== account-guard (deleted company/user lockout; needs acacia_deleted_accounts.sql) ===== */
try{
/* account-guard.js
 * Blocks companies / users that were deleted in Support from using Books.
 * Needs acacia_deleted_accounts.sql (acx_account_state RPC) to be run in Supabase.
 * Until the SQL is run it does nothing (fails open), so it is safe to deploy first.
 *
 * What it does
 *  - Before every login: asks Supabase if the company/user is deleted; if so, wipes
 *    the cached copy from this browser and refuses the login (also offline, once
 *    this browser has learned the account is deleted).
 *  - While signed in: re-checks every 60 s, on tab focus and when the app opens.
 *    A deleted account is locked out, its cached users removed, and it is signed out.
 */
(function () {
  "use strict";
  if (window.__acxAccountGuard) return;
  window.__acxAccountGuard = true;

  var TOMB = "acx_tomb_";               // local memory of "deleted" answers
  var low = function (v) { return String(v == null ? "" : v).trim().toLowerCase(); };
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function tombKey(cid, login) { return TOMB + low(cid) + (login ? "|" + low(login) : ""); }
  function isTombed(cid, login) {
    return !!(localStorage.getItem(tombKey(cid)) || (login && localStorage.getItem(tombKey(cid, login))));
  }

  /* 'deleted' | 'ok' | null (unknown: offline, RPC missing, error) */
  async function remoteState(cid, login) {
    var URL_ = window.__SUPA_URL__, KEY_ = window.__SUPA_KEY__;
    if (!URL_ || !KEY_ || !cid || !navigator.onLine) return null;
    try {
      var ctl = window.AbortController ? new AbortController() : null;
      var t = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
      var r = await fetch(URL_ + "/rest/v1/rpc/acx_account_state", {
        method: "POST",
        headers: { apikey: KEY_, Authorization: "Bearer " + KEY_, "Content-Type": "application/json" },
        body: JSON.stringify({ p_company: low(cid), p_login: low(login) }),
        signal: ctl ? ctl.signal : undefined
      });
      if (t) clearTimeout(t);
      if (!r.ok) return null;                       // RPC not installed yet -> fail open
      var v = await r.json();
      return v === "deleted" ? "deleted" : v === "ok" ? "ok" : null;
    } catch (e) { return null; }
  }

  /* Server answer wins; the local tombstone only applies while offline/unknown.
     If the admin re-creates the account the server says 'ok' and the tombstone is cleared. */
  async function effectiveState(cid, login) {
    var r = await remoteState(cid, login);
    if (r === "ok") {
      try { localStorage.removeItem(tombKey(cid)); localStorage.removeItem(tombKey(cid, login)); } catch (e) {}
      return "ok";
    }
    if (r === "deleted") return "deleted";
    return isTombed(cid, login) ? "deleted" : null;
  }

  /* Remove the deleted company/user from this browser. Business data is left alone. */
  function purge(cid, login, whole) {
    try {
      var users = jget("users", []);
      if (Array.isArray(users)) {
        var keep = users.filter(function (u) {
          if (!u || low(u.companyId) !== low(cid)) return true;
          return whole ? false : low(u.email || u.username) !== low(login);
        });
        if (keep.length !== users.length) localStorage.setItem("users", JSON.stringify(keep));
      }
      var me = jget("loggedInUser", null);
      if (me && low(me.companyId) === low(cid) && (whole || low(me.email || me.username) === low(login)))
        localStorage.removeItem("loggedInUser");
      localStorage.removeItem("acx_gate_" + cid);
      localStorage.setItem(tombKey(cid, whole ? "" : login), String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  function lockOut(whole) {
    var o = document.getElementById("acxDeletedLock");
    if (!o) {
      o = document.createElement("div");
      o.id = "acxDeletedLock";
      o.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0b1220;color:#e2e8f0;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif";
      (document.body || document.documentElement).appendChild(o);
    }
    o.innerHTML = '<div style="max-width:440px;text-align:center"><div style="font-size:42px;margin-bottom:8px">\uD83D\uDD12</div>' +
      '<h2 style="font-size:22px;margin:0 0 10px">' + (whole ? "Company removed" : "Access removed") + "</h2>" +
      '<p style="color:#94a3b8;line-height:1.6;margin:0 0 22px">' +
      (whole ? "This company account has been deleted and can no longer be used."
             : "Your access to this company has been removed.") +
      " Please contact your administrator or support if you think this is a mistake.</p>" +
      '<button id="acxDeletedOk" style="background:#1e3a8a;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-weight:600;cursor:pointer">OK</button></div>';
    document.getElementById("acxDeletedOk").onclick = function () {
      try { localStorage.removeItem("loggedInUser"); } catch (e) {}
      location.reload();
    };
  }

  /* ---- 1. Gate every login --------------------------------------------- */
  function resolveCompanyId(email, companyInput) {
    var users = jget("users", []);
    var match = (Array.isArray(users) ? users : []).filter(function (u) {
      if (!u || low(u.email || u.username) !== low(email)) return false;
      return typeof window.acxCompanyMatches === "function" ? window.acxCompanyMatches(u, companyInput) : true;
    })[0];
    if (match && match.companyId) return match.companyId;
    var guess = low(companyInput);
    return /^comp_/.test(guess) ? guess : null;
  }

  function wrapLogin() {
    var orig = window.handleLogin;
    if (typeof orig !== "function" || orig.__acxGuarded) return;
    var wrapped = async function () {
      try {
        var email = low((document.getElementById("loginEmail") || {}).value);
        var co = (document.getElementById("loginCompanyId") || {}).value || "";
        var cid = email && co ? resolveCompanyId(email, co) : null;
        if (cid) {
          var st = await effectiveState(cid, email);
          if (st === "deleted") {
            var whole = (await effectiveState(cid, "")) === "deleted";
            purge(cid, email, whole);
            try { if (typeof hideAppLoader === "function") hideAppLoader(); } catch (e) {}
            alert(whole ? "\u274C This company account has been deleted."
                        : "\u274C Your access to this company has been removed.");
            return false;
          }
        }
      } catch (e) { console.warn("[accountGuard] login check failed", e); }
      return orig.apply(this, arguments);
    };
    wrapped.__acxGuarded = true;
    window.handleLogin = wrapped;
  }

  /* ---- 2. Keep checking while signed in -------------------------------- */
  var busy = false;
  async function check() {
    if (busy) return;
    var me = jget("loggedInUser", null);
    if (!me || !me.companyId || me.demo) return;
    var login = low(me.email || me.username);
    busy = true;
    try {
      var st = await effectiveState(me.companyId, login);
      if (st === "deleted") {
        var whole = (await effectiveState(me.companyId, "")) === "deleted";
        purge(me.companyId, login, whole);
        lockOut(whole);
      }
    } finally { busy = false; }
  }
  window.acxCheckDeleted = check;

  function start() {
    wrapLogin();
    // login wrappers elsewhere may re-wrap later; re-apply shortly after load
    setTimeout(wrapLogin, 1500);
    var origShow = window.showApp;
    if (typeof origShow === "function" && !origShow.__acxGuarded) {
      var ws = function () { var r = origShow.apply(this, arguments); setTimeout(check, 100); return r; };
      ws.__acxGuarded = true;
      window.showApp = ws;
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    setInterval(check, 60000);
    setTimeout(check, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
}catch(e){console.error('[account-guard]',e)}
/* ===== end account-guard ===== */
/* ===== plan-expiry (paid plan ends -> Free plan; needs acacia_plan_expiry.sql) ===== */
try{
(function () {
  "use strict";
  if (window.__acxPlanExpiry) return;
  window.__acxPlanExpiry = true;
  var low = function (v) { return String(v == null ? "" : v).trim().toLowerCase(); };
  var key = function (v) { return String(v || "free").toLowerCase().replace(/[^a-z]/g, ""); };
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function hdr() { var K = window.__SUPA_KEY__; return { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }; }

  async function downgradeRemote(cid) {
    try {
      var r = await fetch(window.__SUPA_URL__ + "/rest/v1/rpc/acx_downgrade_expired", {
        method: "POST", headers: hdr(), body: JSON.stringify({ p_company: String(cid) }) });
      return r.ok;                                   // false when the SQL has not been run yet
    } catch (e) { return false; }
  }
  async function fetchRow(cid) {
    try {
      var r = await fetch(window.__SUPA_URL__ + "/rest/v1/acacia_company_status?select=*&company_id=eq." + encodeURIComponent(cid), { headers: hdr() });
      if (!r.ok) return null; var a = await r.json(); return a[0] || null;
    } catch (e) { return null; }
  }

  function banner(row) {
    var k = "acx_free_note_" + (row.downgraded_at || "");
    if (localStorage.getItem(k) === "1") return;
    var el = document.getElementById("acxFreeBanner");
    if (!el) {
      el = document.createElement("div"); el.id = "acxFreeBanner";
      el.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#1e3a8a;color:#fff;padding:10px 16px;font:600 13px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap";
      document.body.appendChild(el);
    }
    el.innerHTML = "<span>Your " + (row.previous_plan ? row.previous_plan + " " : "") + "plan has ended, so this company is now on the Free plan. Your data is safe - upgrade to get paid features back.</span>" +
      '<button id="acxFreeOk" style="background:transparent;border:1px solid rgba(255,255,255,.6);color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer">Dismiss</button>';
    document.getElementById("acxFreeOk").onclick = function () { localStorage.setItem(k, "1"); el.remove(); };
  }

  /* Mirror of what Books does for an approved upgrade, but downwards. */
  function applyFreeLocally(row) {
    var me = jget("loggedInUser", null); if (!me) return;
    me.plan = "Free"; me.price = 0;
    try { localStorage.setItem("loggedInUser", JSON.stringify(me)); } catch (e) {}
    ["users", "companies"].forEach(function (k) {
      try {
        var arr = jget(k, []);
        if (!Array.isArray(arr)) return;
        arr.forEach(function (a) { if (a && String(a.companyId) === String(me.companyId)) { a.plan = "Free"; a.price = 0; } });
        localStorage.setItem(k, JSON.stringify(arr));
      } catch (e) {}
    });
    try { localStorage.setItem("selectedPlan", "Free"); localStorage.setItem("selectedPrice", "0"); } catch (e) {}
    try { window.AcaciaPlans && window.AcaciaPlans.applyPlanGating(); } catch (e) {}
    try { banner(row); } catch (e) {}
  }

  var busy = false;
  async function onRow() {
    if (busy) return;
    var row = window.__acxCompanyRow, me = jget("loggedInUser", null);
    if (!row || !me || !me.companyId || me.demo) return;
    busy = true;
    try {
      if (row.status === "active" && row.paid_until && new Date(row.paid_until) < new Date()) {
        if (await downgradeRemote(me.companyId)) {
          var nr = await fetchRow(me.companyId);
          if (nr) { row = window.__acxCompanyRow = nr;
            try { window.dispatchEvent(new CustomEvent("acx-company-row")); } catch (e) {} }
        }
      }
      if (row && row.status === "active" && row.downgraded_at && key(row.plan) === "free" && key(me.plan) !== "free")
        applyFreeLocally(row);
    } finally { busy = false; }
  }
  window.addEventListener("acx-company-row", function () { setTimeout(onRow, 0); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(onRow, 0); });
  setInterval(onRow, 5 * 60 * 1000);
  setTimeout(onRow, 3000);
})();
}catch(e){console.error('[plan-expiry]',e)}
/* ===== end plan-expiry ===== */
(function(){"use strict";if(window.__acxNotifPlus)return;window.__acxNotifPlus=true;var KEY="notifications",MAX=200,LOW_QTY=5,DUE_SOON_DAYS=7,EXPIRY_DAYS=30,MAX_LINES=4;var $=function(id){return document.getElementById(id)};var esc=function(x){return String(x==null?"":x).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};var num=function(v){var x=parseFloat(String(v==null?"":v).replace(/,/g,""));return isNaN(x)?0:x};var arr=function(k){try{var a=JSON.parse(localStorage.getItem(k)||"[]");return Array.isArray(a)?a:[]}catch(e){return[]}};var jget=function(k,d){try{var v=JSON.parse(localStorage.getItem(k)||"null");return v==null?d:v}catch(e){return d}};var jset=function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};var cid=function(){var u=jget("loggedInUser",null);return u&&u.companyId?String(u.companyId):""};var fmt=function(cur,v){return(cur||"KES")+" "+v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})};var uid=function(){return"n"+Date.now().toString(36)+Math.random().toString(36).slice(2,7)};var NOISE=/Opened[: ]|Quick Create panel|Data refreshed successfully|Welcome! No new updates/i;function load(){var l=arr(KEY),changed=false;l.forEach(function(n){if(!n.id){n.id=uid();changed=true}if(!n.ts){var t=Date.parse(n.time);n.ts=isNaN(t)?Date.now():t;changed=true}if(!n.title){n.title=n.message||"";changed=true}});if(changed)jset(KEY,l);return l}function save(l){jset(KEY,l.slice(0,MAX))}window.addNotification=function(msg,opts){opts=opts||{};var title=String(msg==null?"":msg);if(!opts.force&&NOISE.test(title))return;var l=load();l.unshift({id:uid(),message:title,title:title,lines:opts.lines||[],tab:opts.tab||"",type:opts.type||"info",key:opts.key||"",ts:Date.now(),time:(new Date).toLocaleString(),read:false});save(l);render()};function today0(){var d=new Date;d.setHours(0,0,0,0);return d}function pd(s){if(!s)return null;s=String(s).trim();var m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);var d=new Date(s);return isNaN(d.getTime())?null:d}var DAY=864e5;function outstanding(d){if(d.balance!=null&&d.balance!=="")return num(d.balance);return num(d.total)-num(d.amountPaid!=null?d.amountPaid:d.paidAmount)}function isOpen(d){if(!d||d.paid===true)return false;return!/^\s*(paid|void|cancel|reject|draft|pending)/i.test(String(d.status||""))}function more(lines,n){if(lines.length>n){var r=lines.length-n;lines=lines.slice(0,n);lines.push("+"+r+" more")}return lines}function buildAlerts(){var out={},t0=today0().getTime();var over=[];arr("invoices").forEach(function(i){if(!isOpen(i))return;var due=pd(i.dueDate);if(!due)return;var days=Math.floor((t0-due.getTime())/DAY),o=outstanding(i);if(days>0&&o>.005)over.push({days:days,line:(i.invoiceNumber||"Invoice")+" · "+(i.customer||"-")+" · "+fmt(i.currency,o)+" · "+days+"d overdue"})});if(over.length){over.sort(function(a,b){return b.days-a.days});out["inv-overdue"]={type:"overdue",tab:"invoicesTab",title:over.length+" overdue invoice"+(over.length>1?"s":""),full:over.map(function(x){return x.line}).slice(0,60),lines:more(over.map(function(x){return x.line}),MAX_LINES)}}var bo=[],bs=[];arr("bills").forEach(function(b){if(!isOpen(b))return;var due=pd(b.dueDate);if(!due)return;var diff=Math.round((due.getTime()-t0)/DAY),o=outstanding(b);if(o<=.005)return;var base=(b.billNumber||"Bill")+" · "+(b.supplier||"-")+" · "+fmt(b.currency,o);if(diff<0)bo.push({k:diff,line:base+" · "+-diff+"d overdue"});else if(diff<=DUE_SOON_DAYS)bs.push({k:diff,line:base+" · "+(diff===0?"due today":"due in "+diff+"d")})});if(bo.length){bo.sort(function(a,b){return a.k-b.k});out["bill-overdue"]={type:"bill",tab:"supplierBillsTab",title:bo.length+" overdue bill"+(bo.length>1?"s":"")+" to pay",full:bo.map(function(x){return x.line}).slice(0,60),lines:more(bo.map(function(x){return x.line}),MAX_LINES)}}if(bs.length){bs.sort(function(a,b){return a.k-b.k});out["bill-soon"]={type:"bill",tab:"supplierBillsTab",title:bs.length+" bill"+(bs.length>1?"s":"")+" due within "+DUE_SOON_DAYS+" days",full:bs.map(function(x){return x.line}).slice(0,60),lines:more(bs.map(function(x){return x.line}),MAX_LINES)}}var low=[],outc=0,exp=[],soon=[];var whs=[];try{if(typeof window.__invWarehouseNames==="function")whs=window.__invWarehouseNames()||[]}catch(e){}whs.forEach(function(w){var items=[];try{items=typeof window.getInventory==="function"?window.getInventory(w):[]}catch(e){}(items||[]).forEach(function(it){if(!it||it.active===false)return;var q=num(it.qty),nm=it.name||it.sku||"-";if(q<LOW_QTY){if(q<=0)outc++;low.push({q:q,line:nm+" — "+(q<=0?"out of stock":q+" left")+" ("+w+")"})}(it.batches||[]).forEach(function(b){var e=pd(b.expiryDate);if(!e||num(b.qty)<=0)return;var d=Math.round((e.getTime()-t0)/DAY);var ln=nm+(b.batchNo?" · batch "+b.batchNo:"")+" · "+num(b.qty)+" units";if(d<0)exp.push({k:d,line:ln+" · expired "+-d+"d ago"});else if(d<=EXPIRY_DAYS)soon.push({k:d,line:ln+" · expires in "+d+"d"})})})});if(low.length){low.sort(function(a,b){return a.q-b.q});out["stock"]={type:"stock",tab:"inventoryTab",title:low.length+" item"+(low.length>1?"s":"")+" low on stock"+(outc?" ("+outc+" out)":""),full:low.map(function(x){return x.line}).slice(0,60),lines:more(low.map(function(x){return x.line}),MAX_LINES)}}if(exp.length){exp.sort(function(a,b){return a.k-b.k});out["batch-expired"]={type:"expiry",tab:"inventoryTab",title:exp.length+" expired batch"+(exp.length>1?"es":"")+" still in stock",full:exp.map(function(x){return x.line}).slice(0,60),lines:more(exp.map(function(x){return x.line}),MAX_LINES)}}if(soon.length){soon.sort(function(a,b){return a.k-b.k});out["batch-soon"]={type:"expiry",tab:"inventoryTab",title:soon.length+" batch"+(soon.length>1?"es":"")+" expiring within "+EXPIRY_DAYS+" days",full:soon.map(function(x){return x.line}).slice(0,60),lines:more(soon.map(function(x){return x.line}),MAX_LINES)}}return out}function sync(alerts){var l=load(),c=cid(),dkey="__notifDismiss_"+c,dismissed=jget(dkey,{}),changed=false;var seen={};Object.keys(alerts).forEach(function(k){var a=alerts[k],sig=JSON.stringify([a.title,a.full||a.lines]);if(dismissed[k]===sig){seen[k]=1;return}var ex=null;for(var i=0;i<l.length;i++)if(l[i].key===k){ex=l[i];break}seen[k]=1;if(!ex){l.unshift({id:uid(),message:a.title,title:a.title,lines:a.lines,full:a.full,tab:a.tab,type:a.type,key:k,sig:sig,ts:Date.now(),time:(new Date).toLocaleString(),read:false});changed=true}else if(ex.sig!==sig){ex.title=ex.message=a.title;ex.lines=a.lines;ex.full=a.full;ex.sig=sig;ex.ts=Date.now();ex.time=(new Date).toLocaleString();ex.read=false;changed=true}});var keep=l.filter(function(n){return!n.key||n.type==="new"||seen[n.key]});if(keep.length!==l.length){l=keep;changed=true}Object.keys(dismissed).forEach(function(k){if(!alerts[k]){delete dismissed[k]}});jset(dkey,dismissed);if(changed)save(l)}function activity(){var c=cid();if(!c)return;var sk="__notifSeen_"+c,seen=jget(sk,null),first=!seen;seen=seen||{inv:[],bill:[]};var sets={inv:{},bill:{}};seen.inv.forEach(function(x){sets.inv[x]=1});seen.bill.forEach(function(x){sets.bill[x]=1});var defs=[{k:"inv",rows:arr("invoices"),noun:"invoice",tab:"invoicesTab",num:"invoiceNumber",who:"customer"},{k:"bill",rows:arr("bills"),noun:"bill",tab:"supplierBillsTab",num:"billNumber",who:"supplier"}];var made=[];defs.forEach(function(d){var fresh=[];d.rows.forEach(function(r){var id=String(r.id!=null?r.id:r[d.num]);if(!id||id==="undefined")return;if(!sets[d.k][id]){sets[d.k][id]=1;if(!first&&!/^\s*draft/i.test(String(r.status||"")))fresh.push(r)}});if(fresh.length===1||fresh.length&&fresh.length<=3){fresh.forEach(function(r){var due=pd(r.dueDate);made.push({title:"New "+d.noun+" "+(r[d.num]||""),type:"new",tab:d.tab,lines:[(r[d.who]||"-")+" · "+fmt(r.currency,num(r.total)),due?"Due "+due.toLocaleDateString():""].filter(Boolean)})})}else if(fresh.length>3){made.push({title:fresh.length+" new "+d.noun+"s",type:"new",tab:d.tab,full:fresh.map(function(r){return(r[d.num]||"")+" · "+(r[d.who]||"-")+" · "+fmt(r.currency,num(r.total))}).slice(0,60),lines:more(fresh.map(function(r){return(r[d.num]||"")+" · "+(r[d.who]||"-")+" · "+fmt(r.currency,num(r.total))}),MAX_LINES)})}});jset(sk,{inv:Object.keys(sets.inv),bill:Object.keys(sets.bill)});if(made.length){var l=load();made.reverse().forEach(function(m){l.unshift({id:uid(),message:m.title,title:m.title,lines:m.lines,tab:m.tab,type:m.type,key:"",ts:Date.now(),time:(new Date).toLocaleString(),read:false})});save(l)}}var WATCH=[{k:"invoices",noun:"Invoice",tab:"invoicesTab",nums:["invoiceNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"bills",noun:"Bill",tab:"supplierBillsTab",nums:["billNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"quotes",noun:"Quote",tab:"quotesTab",nums:["quoteNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"orders",noun:"Sales order",tab:"ordersTab",nums:["orderNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"receipts",noun:"Receipt",tab:"receiptsTab",nums:["receiptNumber","number","id"],who:["customer","customerName"],amt:["amount","total"]},{k:"billPayments",noun:"Bill payment",tab:"supplierPaymentsTab",nums:["reference","id"],who:["supplier","supplierName"],amt:["amount","total"]},{k:"creditNotes",noun:"Credit note",tab:"creditNoteTab",nums:["number","creditNoteNumber","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"supplierDebitNotes",noun:"Debit note",tab:"supplierDebitNotesTab",nums:["number","debitNoteNumber","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"purchaseOrders",noun:"Purchase order",tab:"supplierPurchaseOrdersTab",nums:["poNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"grns",noun:"GRN",tab:"grnTab",nums:["grnNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"salesReturns",noun:"Sales return",tab:"salesReturnTab",nums:["returnNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"purchaseReturns",noun:"Purchase return",tab:"purchaseReturnsTab",nums:["returnNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"deliveries",noun:"Delivery",tab:"deliveryTab",nums:["deliveryNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"manualJournals",noun:"Journal",tab:"manualJournalsTab",nums:["journalNo","journalNumber","number","reference","id"],who:["description","narration","notes"],amt:["total","amount","debit"]},{k:"customers",noun:"Customer",tab:"customersTab",nums:["name","id"],who:[],amt:[],lite:true},{k:"suppliers",noun:"Supplier",tab:"supplierTab",nums:["name","id"],who:[],amt:[],lite:true},{k:"users",noun:"User",tab:"userManagementTab",nums:["username","name","id"],who:["role"],amt:[],lite:true}];var ACTOR=["updatedBy","modifiedBy","editedBy","createdBy","user","username","preparedBy","salesperson"];var pick=function(r,fs){for(var i=0;i<fs.length;i++){var v=r[fs[i]];if(v!=null&&v!==""&&typeof v!=="object")return v}return""};var isDraft=function(s){return/^\s*draft/i.test(String(s||""))};var isPaid=function(s){return/^\s*paid/i.test(String(s||""))};function idOf(r,w){var v=r.id!=null&&r.id!==""?r.id:pick(r,w.nums);return v===""?null:String(v)}function sigOf(r,w){var st=pick(r,["status","packageStatus"]);if(!st&&r.paid===true)st="Paid";var bal=r.balance!=null&&r.balance!==""?num(r.balance):null;return[String(pick(r,w.nums)),String(pick(r,w.who)),num(pick(r,w.amt)),String(st),bal,String(r.dueDate||""),String(pick(r,ACTOR)),String(r.currency||"")]}var head=function(w,s){return w.noun+(s[0]?" "+s[0]:"")};var low=function(w){return w.noun.charAt(0).toLowerCase()+w.noun.slice(1)};function body(w,s){var l=[],who=s[1],a=s[2]?fmt(s[7],s[2]):"";if(who||a)l.push((who||"-")+(a?" · "+a:""));var d=pd(s[5]);if(d)l.push("Due "+d.toLocaleDateString());if(s[3])l.push("Status: "+s[3]);if(s[6])l.push("By "+s[6]);return l}function delta(w,o,n){var L=[],h=head(w,n);if(o[2]!==n[2])L.push("Amount: "+fmt(n[7],o[2])+" → "+fmt(n[7],n[2]));if(o[3]!==n[3])L.push("Status: "+(o[3]||"-")+" → "+(n[3]||"-"));if(o[4]!=null&&n[4]!=null&&o[4]!==n[4])L.push("Balance: "+fmt(n[7],o[4])+" → "+fmt(n[7],n[4]));if(o[1]!==n[1]&&!w.lite)L.push("Name/Details: "+(o[1]||"-")+" → "+(n[1]||"-"));if(o[5]!==n[5])L.push("Due date: "+(o[5]||"-")+" → "+(n[5]||"-"));if(o[0]!==n[0]&&o[0])L.push("Number: "+o[0]+" → "+n[0]);if(!L.length)return null;var r={tab:w.tab,type:"edit"},who=n[1]?[n[1]+(n[2]?" · "+fmt(n[7],n[2]):"")]:[];if(isDraft(o[3])&&!isDraft(n[3])){r.title="New "+low(w)+" "+n[0];r.type="new";r.lines=body(w,n);return r}var cleared=o[4]!=null&&n[4]!=null&&o[4]>.005&&n[4]<=.005;if(isPaid(n[3])&&!isPaid(o[3])||cleared){r.title=h+" paid in full";r.type="paid"}else if(o[4]!=null&&n[4]!=null&&n[4]<o[4]){r.title="Payment of "+fmt(n[7],o[4]-n[4])+" on "+h;r.type="paid"}else if(o[3]!==n[3]&&n[3])r.title=h+" → "+n[3];else r.title=h+" updated";if(n[6])L.push("By "+n[6]);r.lines=who.concat(L);return r}var fps={},snap=null,snapCid="";function fpOf(s){var h=5381;for(var i=0;i<s.length;i++)h=(h<<5)+h+s.charCodeAt(i)|0;return s.length+":"+h}function changes(){var c=cid();if(!c)return 0;var sk="__notifSnap_"+c;if(snapCid!==c){snap=jget(sk,null);snapCid=c;fps={}}var first=!snap;if(first)snap={};var made=[],dirty=false;WATCH.forEach(function(w){var raw=null;try{raw=localStorage.getItem(w.k)}catch(e){}if(raw==null)return;var f=fpOf(raw);if(fps[w.k]===f)return;fps[w.k]=f;var data;try{data=JSON.parse(raw)}catch(e){return}if(!Array.isArray(data))return;var old=snap[w.k],nm={};data.forEach(function(r){if(!r||typeof r!=="object")return;var id=idOf(r,w);if(id!=null)nm[id]=sigOf(r,w)});snap[w.k]=nm;dirty=true;if(first||!old)return;var add=[],del=[],chg=[];Object.keys(nm).forEach(function(id){if(!old[id]){if(!isDraft(nm[id][3]))add.push(nm[id])}else if(!w.lite){var d=delta(w,old[id],nm[id]);if(d)chg.push(d)}});Object.keys(old).forEach(function(id){if(!nm[id]&&!isDraft(old[id][3]))del.push(old[id])});var one=function(s){return head(w,s)+(s[1]?" · "+s[1]:"")+(s[2]?" · "+fmt(s[7],s[2]):"")};if(add.length>3){var fl=add.map(one);made.push({title:add.length+" new "+low(w)+"s",type:"new",tab:w.tab,lines:more(fl.slice(),MAX_LINES),full:fl.slice(0,60)})}else add.forEach(function(s){made.push({title:"New "+low(w)+" "+s[0],type:"new",tab:w.tab,lines:body(w,s)})});if(chg.length>3){var cl=chg.map(function(x){return x.title+(x.lines[1]?" — "+x.lines[1]:"")});made.push({title:chg.length+" "+low(w)+"s updated",type:"edit",tab:w.tab,lines:more(cl.slice(),MAX_LINES),full:cl.slice(0,60)})}else chg.forEach(function(x){made.push(x)});if(del.length>3){var dl=del.map(one);made.push({title:del.length+" "+low(w)+"s deleted",type:"del",tab:w.tab,lines:more(dl.slice(),MAX_LINES),full:dl.slice(0,60)})}else del.forEach(function(s){made.push({title:head(w,s)+" deleted",type:"del",tab:w.tab,lines:body(w,s)})})});if(dirty)jset(sk,snap);if(made.length){var l=load();made.reverse().forEach(function(m){l.unshift({id:uid(),message:m.title,title:m.title,lines:m.lines,full:m.full,tab:m.tab,type:m.type,key:"",ts:Date.now(),time:(new Date).toLocaleString(),read:false})});save(l);render()}return made.length}var lastScan=0;function scan(force){try{if(!cid())return;if(!force&&Date.now()-lastScan<6e4)return;lastScan=Date.now();sync(buildAlerts());changes();render()}catch(e){console.warn("[notifications-plus]",e)}}var ICON={overdue:["⏰","#fee2e2","#b91c1c"],bill:["💳","#ffedd5","#c2410c"],stock:["📦","#fef3c7","#b45309"],expiry:["⌛","#ede9fe","#6d28d9"],new:["🧾","#dbeafe","#1d4ed8"],paid:["✅","#dcfce7","#15803d"],edit:["✏️","#e0f2fe","#0369a1"],del:["🗑️","#fee2e2","#b91c1c"],info:["🔔","#f3f4f6","#4b5563"]};var filter="all",fresh={},opened={};function rel(ts){var s=Math.max(0,Math.round((Date.now()-ts)/1e3));if(s<60)return"just now";var m=Math.round(s/60);if(m<60)return m+"m ago";var h=Math.round(m/60);if(h<24)return h+"h ago";var d=Math.round(h/24);if(d<7)return d+"d ago";return new Date(ts).toLocaleDateString()}function chrome(){var p=$("notifPopup");if(!p||p.__plus)return;p.__plus=true;p.style.width="390px";p.style.maxWidth="94vw";p.style.height="72vh";var head=p.firstElementChild;if(!head)return;var h3=head.querySelector("h3");if(h3)h3.textContent="🔔 Notifications";var bar=document.createElement("div");bar.style.cssText="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #f1f1f1;font-size:12px;flex:none";bar.innerHTML='<button data-f="all" class="acx-np-pill">All</button><button data-f="unread" class="acx-np-pill">Unread</button><span style="flex:1"></span>'+'<button data-a="read" class="acx-np-link">Mark all read</button><button data-a="clear" class="acx-np-link" style="color:#dc2626">Clear all</button>';head.insertAdjacentElement("afterend",bar);var st=document.createElement("style");st.textContent=".acx-np-pill{border:1px solid #d1d5db;border-radius:999px;padding:1px 10px;background:#fff;color:#374151;cursor:pointer}.acx-np-pill.on{background:#1e3a8a;color:#fff;border-color:#1e3a8a}.acx-np-link{background:none;border:0;color:#2563eb;cursor:pointer;padding:0 2px}.acx-np-link:hover{text-decoration:underline}"+".acx-np-item{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid #f1f1f1;cursor:pointer;position:relative}.acx-np-item:hover{background:#f8fafc}.acx-np-item.fresh{background:#eff6ff;box-shadow:inset 3px 0 0 #2563eb}"+".acx-np-ic{width:34px;height:34px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;font-size:16px}.acx-np-x{position:absolute;right:8px;top:6px;border:0;background:none;color:#9ca3af;cursor:pointer;display:none;font-size:12px}.acx-np-item:hover .acx-np-x{display:block}";document.head.appendChild(st);bar.addEventListener("click",function(e){var f=e.target.closest("[data-f]"),a=e.target.closest("[data-a]");if(f){filter=f.getAttribute("data-f");render()}if(a&&a.getAttribute("data-a")==="read"){markAllRead();fresh={};render()}if(a&&a.getAttribute("data-a")==="clear"){if(confirm("Clear all notifications?"))clearAll()}});var ul=$("notifList");if(ul)ul.addEventListener("click",function(e){var li=e.target.closest(".acx-np-item");if(!li)return;var id=li.getAttribute("data-id");if(e.target.closest(".acx-np-x")){dismiss(id);return}var n=load().filter(function(x){return x.id===id})[0];if(!n)return;if(e.target.closest("[data-go]")){if(n.tab&&typeof window.showTab==="function"){p.classList.add("hidden");try{window.showTab(n.tab)}catch(x){}}return}opened[id]=!opened[id];render()})}function render(){var ul=$("notifList"),cnt=$("notifCount");if(!ul||!cnt)return;chrome();var list=load(),unread=list.filter(function(n){return!n.read}).length;cnt.textContent=unread>99?"99+":unread;cnt.classList.toggle("hidden",unread===0);document.querySelectorAll(".acx-np-pill").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-f")===filter)});var shown=list.filter(function(n){return filter==="all"||!n.read||fresh[n.id]});if(!shown.length){ul.innerHTML='<li style="padding:40px 16px;text-align:center;color:#6b7280;font-size:13px"><div style="font-size:30px">✅</div>'+(filter==="unread"?"No unread notifications":"You're all caught up")+'<div style="font-size:12px;margin-top:4px">Overdue invoices, bills due, low stock and expiring items will show here.</div></li>';return}ul.innerHTML=shown.map(function(n){var ic=ICON[n.type]||ICON.info;var shownLines=opened[n.id]&&n.full&&n.full.length?n.full:n.lines||[];var lines=shownLines.map(function(x){return'<div style="font-size:12px;color:#4b5563;margin-top:2px;line-height:1.35">'+esc(x)+"</div>"}).join("");return'<li class="acx-np-item'+(fresh[n.id]||!n.read?" fresh":"")+'" data-id="'+esc(n.id)+'" title="'+esc(n.time||"")+'">'+'<div class="acx-np-ic" style="background:'+ic[1]+";color:"+ic[2]+'">'+ic[0]+"</div>"+'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#111827;padding-right:16px">'+esc(n.title||n.message)+"</div>"+lines+'<div style="font-size:11px;color:#9ca3af;margin-top:4px">'+rel(n.ts)+(n.full&&n.full.length>(n.lines||[]).length?' · <span style="color:#6b7280">'+(opened[n.id]?"Show less ▴":"Show all ▾")+"</span>":"")+(n.tab?' · <span data-go="1" style="color:#2563eb">View ›</span>':"")+"</div></div>"+'<button class="acx-np-x" title="Dismiss">✕</button></li>'}).join("")}window.renderNotifications=function(){render()};window.__acxNotifChanges=changes;function markAllRead(){var l=load();l.forEach(function(n){n.read=true});save(l)}function dismiss(id){var l=load(),n=l.filter(function(x){return x.id===id})[0];if(!n)return;if(n.key){var k="__notifDismiss_"+cid(),d=jget(k,{});d[n.key]=n.sig||JSON.stringify([n.title,n.lines]);jset(k,d)}save(l.filter(function(x){return x.id!==id}));render()}function clearAll(){var l=load(),k="__notifDismiss_"+cid(),d=jget(k,{});l.forEach(function(n){if(n.key)d[n.key]=n.sig||JSON.stringify([n.title,n.lines])});jset(k,d);save([]);fresh={};render()}window.toggleNotifications=function(){var p=$("notifPopup");if(!p)return;p.classList.toggle("hidden");if(!p.classList.contains("hidden")){scan(false);changes();fresh={};load().forEach(function(n){if(!n.read)fresh[n.id]=1});markAllRead();render()}};if(typeof window.toggleNotifPopup!=="function")window.toggleNotifPopup=function(){var p=$("notifPopup");if(p)p.classList.add("hidden")};function purge(){var l=load(),k=l.filter(function(n){return!NOISE.test(String(n.title||n.message||""))});if(k.length!==l.length)save(k)}function boot(){purge();render();setTimeout(function(){scan(true)},2500);setInterval(function(){scan(true)},10*60*1e3);setTimeout(function(){changes()},3e3);setInterval(function(){if(!document.hidden){try{changes()}catch(e){}}},6e4);document.addEventListener("visibilitychange",function(){if(!document.hidden){try{changes()}catch(e){}}})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(boot,0)});else boot()})();(function(){"use strict";if(window.__acxWhatsNew)return;window.__acxWhatsNew=true;var KEY="acaciaWhatsNew",SEEN="acaciaWhatsNewSeen";var BUILT_IN=[{id:"b-notif-log",type:"Improvement",date:"2026-10-02",title:"Smarter Notifications",text:"The bell now shows what actually happened: new, paid, edited and deleted invoices, bills and more, with before → after values.",tab:""},{id:"b-merge",type:"New Module",date:"2026-10-01",title:"Merge Duplicates",text:"Merge duplicate Customers, Suppliers and Inventory items in one click. Balances, stock and linked invoices/bills are combined safely.",tab:"customersTab"},{id:"b-orgs",type:"Improvement",date:"2026-09-30",title:"Organizations Panel",text:"Switch companies from a full panel showing logo, Organization ID (copyable) and plan, with a tick on the active company.",tab:"orgProfileTab"},{id:"b-mail",type:"New App",date:"2026-09-30",title:"Mail Hub",text:"Send and manage company email in a dedicated app. Mail sent from Books lands in the Mail Hub as a draft.",link:"https://kimani254star.github.io/acacia-mail/"},{id:"b-crm",type:"New App",date:"2026-09-28",title:"CRM Hub",text:"Track leads, customers and follow-ups in the CRM app, opened straight from Books.",link:"https://kimani254star.github.io/acacia-crm/?from=books"}];var BADGE={"New Module":["#fee2e2","#b91c1c"],"New App":["#dbeafe","#1d4ed8"],Improvement:["#dcfce7","#15803d"]};var $=function(id){return document.getElementById(id)};var esc=function(x){return String(x==null?"":x).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};var jget=function(k,d){try{var v=JSON.parse(localStorage.getItem(k)||"null");return v==null?d:v}catch(e){return d}};var jset=function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};var isAdmin=function(){var u=jget("loggedInUser",null);return!!(u&&/admin/i.test(String(u.role||"")))};var safeUrl=function(u){u=String(u||"").trim();return/^https?:\/\//i.test(u)?u:""};function items(){var custom=jget(KEY,[]);if(!Array.isArray(custom))custom=[];var all=custom.concat(BUILT_IN);all.sort(function(a,b){return String(b.date||"").localeCompare(String(a.date||""))});return all}function unseen(){var s=jget(SEEN,[]);return items().filter(function(i){return s.indexOf(i.id)<0})}function markSeen(){jset(SEEN,items().map(function(i){return i.id}));dot()}function dot(){var b=$("webinarToggle");if(!b)return;var d=b.querySelector(".acx-wn-dot"),n=unseen().length;if(n&&!d){d=document.createElement("span");d.className="acx-wn-dot";d.style.cssText="display:inline-block;min-width:16px;height:16px;line-height:16px;border-radius:9px;background:#dc2626;color:#fff;font-size:10px;text-align:center;margin-left:6px;padding:0 4px;vertical-align:middle";b.appendChild(d)}if(d){if(n)d.textContent=n;else d.remove()}}function host(){var h=$("acxWhatsNew");if(h)return h;var panel=$("webinarPanel");if(!panel)return null;var old=null;panel.querySelectorAll("div").forEach(function(d){if(!old&&/Interactive Q&A Session Hub/.test(d.textContent)&&d.className.indexOf("border-red-100")>-1)old=d});h=document.createElement("div");h.id="acxWhatsNew";if(old)old.replaceWith(h);else{var body=panel.querySelector(".custom-scrollbar")||panel;body.insertBefore(h,body.firstChild)}h.addEventListener("click",onClick);return h}var showAll=false,adding=false;function card(i,fresh){var c=BADGE[i.type]||BADGE["Improvement"],link=safeUrl(i.link);var act=link?'<a href="'+esc(link)+'" target="_blank" rel="noopener" style="color:#2563eb;font-weight:700;font-size:13px">Open app →</a>':i.tab?'<button data-go="'+esc(i.tab)+'" style="color:#2563eb;font-weight:700;font-size:13px;background:none;border:0;cursor:pointer;padding:0">Open module →</button>':"";return'<div style="border:1px solid #e5e7eb;border-radius:14px;padding:10px 12px;margin-bottom:8px;background:'+(fresh?"#fff7ed":"#fff")+';position:relative">'+'<div style="display:flex;align-items:center;gap:8px"><span style="background:'+c[0]+";color:"+c[1]+';font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px">'+esc(i.type)+"</span>"+(fresh?'<span style="color:#dc2626;font-size:11px;font-weight:700">NEW</span>':"")+'<span style="flex:1"></span><span style="color:#9ca3af;font-size:11px">'+esc(i.date||"")+"</span>"+(i.custom&&isAdmin()?'<button data-del="'+esc(i.id)+'" title="Remove" style="color:#9ca3af;background:none;border:0;cursor:pointer;margin-left:4px">✕</button>':"")+"</div>"+'<div style="font-weight:700;font-size:14px;color:#111827;margin-top:4px">'+esc(i.title)+"</div>"+'<div style="font-size:13px;color:#4b5563;margin-top:2px;line-height:1.4">'+esc(i.text)+"</div>"+(act?'<div style="margin-top:6px">'+act+"</div>":"")+"</div>"}var seenBefore=[];function render(){var h=host();if(!h)return;var all=items(),shown=showAll?all:all.slice(0,3);var html='<div style="display:flex;align-items:center;margin-bottom:6px"><span style="font-weight:700;font-size:14px;color:#111827">📢 What’s New</span><span style="flex:1"></span>'+(isAdmin()?'<button data-add="1" style="color:#2563eb;font-size:13px;background:none;border:0;cursor:pointer">'+(adding?"Cancel":"＋ Announce")+"</button>":"")+"</div>";if(adding){var f="width:100%;border:1px solid #d1d5db;border-radius:10px;padding:5px 8px;font-size:13px;margin-bottom:6px;box-sizing:border-box";html+='<div style="border:1px dashed #9ca3af;border-radius:14px;padding:10px;margin-bottom:8px;background:#f9fafb">'+'<select id="wnType" style="'+f+'"><option>New Module</option><option>New App</option><option>Improvement</option></select>'+'<input id="wnTitle" placeholder="Name (e.g. Payroll Hub)" style="'+f+'">'+'<textarea id="wnText" rows="2" placeholder="Brief explanation of what it does" style="'+f+'"></textarea>'+'<input id="wnLink" placeholder="App link https://… (optional)" style="'+f+'">'+'<input id="wnTab" placeholder="Or module tab id e.g. quotesTab (optional)" style="'+f+'">'+'<button data-save="1" style="background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:5px 14px;font-size:13px;cursor:pointer">Publish</button></div>'}html+=shown.map(function(i){return card(i,seenBefore.indexOf(i.id)<0)}).join("");if(all.length>3)html+='<button data-more="1" style="color:#2563eb;font-size:13px;background:none;border:0;cursor:pointer">'+(showAll?"Show less":"Show all ("+all.length+")")+"</button>";h.innerHTML=html}function onClick(e){var t=e.target,b;if(b=t.closest("[data-go]")){var tab=b.getAttribute("data-go"),p=$("webinarPanel");if(p)p.classList.add("hidden");if(typeof window.showTab==="function"){try{window.showTab(tab)}catch(x){}}return}if(t.closest("[data-add]")){adding=!adding;render();return}if(t.closest("[data-more]")){showAll=!showAll;render();return}if(b=t.closest("[data-del]")){var id=b.getAttribute("data-del");if(confirm("Remove this announcement?")){jset(KEY,jget(KEY,[]).filter(function(x){return x.id!==id}));render();dot()}return}if(t.closest("[data-save]")){var title=($("wnTitle").value||"").trim(),text=($("wnText").value||"").trim();if(!title||!text)return alert("Please enter a name and a brief explanation.");var link=($("wnLink").value||"").trim(),tabId=($("wnTab").value||"").trim();if(link&&!safeUrl(link))return alert("Link must start with http:// or https://");var list=jget(KEY,[]);list.unshift({id:"c"+Date.now().toString(36),custom:true,type:$("wnType").value,title:title,text:text,link:link,tab:tabId,date:(new Date).toISOString().slice(0,10)});jset(KEY,list);adding=false;seenBefore=jget(SEEN,[]);render();dot();if(typeof window.addNotification==="function"){try{window.addNotification("🆕 "+$("wnType").value+": "+title,{force:true,type:"new",lines:[text]})}catch(x){}}}}function boot(){var orig=window.toggleWebinarPanel;if(typeof orig!=="function"||!$("webinarPanel"))return setTimeout(boot,400);if(orig.__wn)return;var wrapped=function(){var r=orig.apply(this,arguments);var p=$("webinarPanel");if(p&&!p.classList.contains("hidden")){seenBefore=jget(SEEN,[]);adding=false;render();markSeen()}return r};wrapped.__wn=true;window.toggleWebinarPanel=wrapped;dot()}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot()})();(function(){"use strict";var TABLE="app_user_avatars",SIZE=256,MAX_FILE=10*1024*1024,EVERY=6e4;var COLORS=["#1e3a8a","#047857","#b45309","#7c3aed","#be123c","#0e7490","#4d7c0f","#a21caf"];function $(id){return document.getElementById(id)}function J(k,d){try{var v=JSON.parse(localStorage.getItem(k)||"null");return v==null?d:v}catch(e){return d}}function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}function who(){var u=J("loggedInUser",null);if(!u)return null;var id=u.username||u.email||u.id;if(!id)return null;return{id:String(id),key:String(id).trim().toLowerCase(),company:String(u.companyId||""),name:String(u.username||u.fullName||u.email||id)}}function keys(u){return{img:"__userAvatar_"+u.id,at:"__userAvatarAt_"+u.id,dirty:"__userAvatarDirty_"+u.id}}function colorFor(s){var h=0;s=String(s);for(var i=0;i<s.length;i++)h=h*31+s.charCodeAt(i)>>>0;return COLORS[h%COLORS.length]}function initials(n){var w=String(n||"?").trim().split(/\s+/);return((w[0]||"?").charAt(0)+(w[1]?w[1].charAt(0):"")).toUpperCase()}function badge(u){var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="'+colorFor(u?u.key:"?")+'"/><text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fff">'+esc(initials(u?u.name:"?"))+"</text></svg>";return"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)}function show(src,u){var el=$("userAvatar");if(!el)return;var want=src||badge(u);if(el.getAttribute("src")!==want)el.src=want;el.style.objectFit="cover";el.title="Click to change your photo";el.onerror=function(){el.onerror=null;el.src=badge(u)}}var sb=null;function client(){if(sb)return sb;if(!window.supabase||!window.__SUPA_URL__||!window.__SUPA_KEY__)return null;try{sb=window.supabase.createClient(window.__SUPA_URL__,window.__SUPA_KEY__,{auth:{storageKey:"acx-avatar-sync",persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}catch(e){sb=null}return sb}function push(u,dataUrl,at){var c=client(),k=keys(u);if(!c){try{localStorage.setItem(k.dirty,"1")}catch(e){}return Promise.resolve(false)}return Promise.resolve(c.from(TABLE).upsert({company_id:u.company,user_key:u.key,avatar:dataUrl,updated_at:at},{onConflict:"company_id,user_key"})).then(function(r){if(r&&r.error)throw r.error;try{localStorage.removeItem(k.dirty)}catch(e){}return true}).catch(function(e){console.warn("[avatarSync] upload failed, will retry",e&&e.message);try{localStorage.setItem(k.dirty,"1")}catch(x){}return false})}var busy=false;function sync(force){var u=who();if(!u)return Promise.resolve();var k=keys(u),localImg=localStorage.getItem(k.img)||"",localAt=localStorage.getItem(k.at)||"";show(localImg,u);var c=client();if(!c||busy)return Promise.resolve();busy=true;return Promise.resolve(c.from(TABLE).select("avatar,updated_at").eq("company_id",u.company).eq("user_key",u.key).maybeSingle()).then(function(res){if(res&&res.error)throw res.error;var row=res&&res.data,cloudAt=row?String(row.updated_at||""):"";var cloudNewer=row&&row.avatar&&(!localImg||!localAt||new Date(cloudAt)>new Date(localAt));if(cloudNewer){try{localStorage.setItem(k.img,row.avatar);localStorage.setItem(k.at,cloudAt);localStorage.removeItem(k.dirty)}catch(e){}if(who()&&who().key===u.key)show(row.avatar,u)}else if(localImg&&(!row||localStorage.getItem(k.dirty)||new Date(localAt)>new Date(cloudAt))){var at=localAt||(new Date).toISOString();try{localStorage.setItem(k.at,at)}catch(e){}return push(u,localImg,at)}}).catch(function(e){console.warn("[avatarSync] sync failed",e&&e.message)}).then(function(){busy=false})}function shrink(file){return new Promise(function(ok,bad){var fr=new FileReader;fr.onerror=function(){bad(new Error("Could not read the file"))};fr.onload=function(){var img=new Image;img.onerror=function(){bad(new Error("That file is not a valid image"))};img.onload=function(){var s=Math.min(img.width,img.height),sx=(img.width-s)/2,sy=(img.height-s)/2;var cv=document.createElement("canvas");cv.width=cv.height=SIZE;var cx=cv.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,SIZE,SIZE);cx.drawImage(img,sx,sy,s,s,0,0,SIZE,SIZE);ok(cv.toDataURL("image/jpeg",.85))};img.src=fr.result};fr.readAsDataURL(file)})}window.previewImage=function(e){var f=e&&e.target&&e.target.files&&e.target.files[0];if(!f)return;var input=e.target,u=who();if(!u){alert("User not logged in — cannot save avatar.");input.value="";return}if(!/^image\//.test(f.type)){alert("Please choose an image file.");input.value="";return}if(f.size>MAX_FILE){alert("That image is too large. Choose one under 10 MB.");input.value="";return}shrink(f).then(function(data){var k=keys(u),at=(new Date).toISOString();try{localStorage.setItem(k.img,data);localStorage.setItem(k.at,at)}catch(x){alert("Browser storage is full — could not save the photo.");return}show(data,u);return push(u,data,at)}).catch(function(err){alert(err.message||"Could not use that image.")}).then(function(){input.value=""})};var last="";function tick(){var u=who(),id=u?u.company+"|"+u.key:"";if(id!==last){last=id;if(u)sync(true);else show("",null)}}window.acxSyncAvatar=function(){return sync(true)};function boot(){tick();setInterval(function(){if(!document.hidden)tick()},5e3);setInterval(function(){if(!document.hidden)sync()},EVERY);document.addEventListener("visibilitychange",function(){if(!document.hidden)sync()});window.addEventListener("focus",function(){sync()});window.addEventListener("online",function(){sync(true)})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot()})();(function(){"use strict";var B=document.body;function close(){document.body.classList.remove("acx-dock-open")}function build(){if(document.getElementById("acxDockToggle"))return true;var rs=document.getElementById("rightSidebar");if(!rs||!document.body)return false;var t=document.createElement("button");t.id="acxDockToggle";t.type="button";t.title="Tools";t.setAttribute("aria-label","Open tools");t.textContent="🧰";t.onclick=function(e){e.stopPropagation();document.body.classList.remove("acx-nav-open");document.body.classList.add("acx-dock-open")};document.body.appendChild(t);var x=document.createElement("button");x.id="acxDockClose";x.type="button";x.setAttribute("aria-label","Close tools");x.textContent="✕";x.onclick=function(e){e.stopPropagation();close()};rs.appendChild(x);return true}document.addEventListener("click",function(e){if(!document.body.classList.contains("acx-dock-open"))return;var t=e.target;if(t&&(t.id==="acxNavBackdrop"||t.closest&&t.closest("#rightSidebar button:not(#acxDockClose)")))close()},true);document.addEventListener("keydown",function(e){if(e.key==="Escape")close()});document.addEventListener("click",function(e){if(e.target&&e.target.closest&&e.target.closest("#acxNavToggle"))close()},true);window.addEventListener("resize",function(){if(window.innerWidth>1100)close()});var tries=0;(function wait(){if(!build()&&tries++<60)setTimeout(wait,500)})()})();
;
/* ======================= recurring-bills.js ======================= */
/* Acacia Books - Recurring Bills (Purchase Hub > Recurring Bills)
 * Works like Recurring Invoices: templates live in localStorage "recurringBills";
 * every run creates a REAL bill in "bills" and posts it through the same ledger
 * code Bulk Bills use (supplier balance, payables, journal, stock for item type
 * "product" only).
 */
(function () {
  "use strict";
  if (window.__acxRecurringBills) return;
  window.__acxRecurringBills = true;

  var KEY = "recurringBills";
  var MAX_CATCHUP = 24;
  var items = [];
  var editId = null;
  var editItemIdx = null;
  var page = 1, perPage = 25, query = "", sortKey = "", sortDir = 1;
  var running = false;

  function $(id) { return document.getElementById(id); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function list() { var a = jget(KEY, []); return Array.isArray(a) ? a : []; }
  function saveList(a) { jset(KEY, a); }
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function dp() { try { return window.__getDecimalPlaces ? window.__getDecimalPlaces() : 2; } catch (e) { return 2; } }
  function num(x) { var n = parseFloat(x); return isNaN(n) ? 0 : n; }
  function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: dp(), maximumFractionDigits: dp() }); }
  function money(n, cur) { return (cur ? cur + " " : "") + fmt(n); }
  function uuid() { try { return crypto.randomUUID(); } catch (e) { return "rb-" + Date.now() + "-" + Math.random().toString(16).slice(2); } }
  function pad(n, w) { return String(n).padStart(w, "0"); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2); }
  function today() { return iso(new Date()); }
  function can(action, what) {
    if (typeof window.requirePermission === "function") return window.requirePermission("supplierBillsTab", action, what);
    return true;
  }
  function call(name) { try { if (typeof window[name] === "function") return window[name].apply(window, Array.prototype.slice.call(arguments, 1)); } catch (e) { console.warn("[recurringBills]", name, e); } }

  /* ---------- dates ---------- */
  function addMonths(y, m, anchor, n) {
    var t = m + n, ny = y + Math.floor(t / 12), nm = ((t % 12) + 12) % 12;
    var last = new Date(ny, nm + 1, 0).getDate();
    return iso(new Date(ny, nm, Math.min(anchor, last)));
  }
  function advance(ds, type, days, anchor) {
    var p = String(ds).split("-"), y = +p[0], m = +p[1] - 1, d = +p[2];
    switch (type) {
      case "daily": return iso(new Date(y, m, d + 1));
      case "weekly": return iso(new Date(y, m, d + 7));
      case "monthly": return addMonths(y, m, anchor || d, 1);
      case "quarterly": return addMonths(y, m, anchor || d, 3);
      case "yearly": return addMonths(y, m, anchor || d, 12);
      case "custom": var n = parseInt(days, 10); return n > 0 ? iso(new Date(y, m, d + n)) : null;
      default: return null;
    }
  }
  function addDays(ds, n) { var p = String(ds).split("-"); return iso(new Date(+p[0], +p[1] - 1, +p[2] + (parseInt(n, 10) || 0))); }

  /* ---------- item maths ---------- */
  function calc(it) {
    var gross = num(it.qty) * num(it.price);
    var sub = gross * (1 - num(it.discount) / 100);
    var pct = parseFloat(it.taxRate);
    var vat = isNaN(pct) ? 0 : sub * pct / 100;
    return { subtotal: sub, vat: vat };
  }
  function totals(arr) {
    var s = 0, v = 0;
    (arr || []).forEach(function (it) { s += num(it.subtotal); v += num(it.vat); });
    return { subtotal: s, vat: v, total: s + v };
  }

  /* ---------- dropdowns ---------- */
  function loadSuppliers() {
    var sel = $("rbSupplier"); if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">Select Supplier</option>';
    jget("suppliers", []).forEach(function (s) { var o = document.createElement("option"); o.value = s.name; o.textContent = s.name; sel.appendChild(o); });
    sel.value = cur;
  }
  function loadAccounts() {
    var sel = $("rbAccount"); if (!sel) return;
    var cur = sel.value;
    var ok = ["Expense", "Cost of Goods Sold", "Other Expense", "Depreciation", "Personnel Costs", "Marketing Expense", "Finance Costs", "Repairs & Maintenance", "Insurance Costs", "Liability", "Other Current Liability", "Accounts Payable", "Non Current Liability", "Other Liability", "Credit Card"];
    var rows = jget("chartOfAccounts", []).filter(function (a) { return ok.indexOf(a.type) > -1; });
    rows.sort(function (a, b) { return String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true, sensitivity: "base" }); });
    sel.innerHTML = '<option value="">Select Account</option>';
    rows.forEach(function (a) { var o = document.createElement("option"); o.value = a.name; o.textContent = a.name + " (" + (a.code || "-") + ")"; sel.appendChild(o); });
    sel.value = cur;
  }
  function loadProducts() {
    var sel = $("rbProduct"); if (!sel) return;
    var cur = sel.value;
    var base = localStorage.getItem("baseCurrency") || "KES";
    var rates = jget("exchangeRates", {});
    sel.innerHTML = '<option value="">Select Product</option>';
    var inv = []; try { inv = typeof getAllInventories === "function" ? getAllInventories() : []; } catch (e) { inv = []; }
    inv.forEach(function (r) {
      var k = (window.acxKesPer ? window.acxKesPer(r.currency) : rates[r.currency]) || 1;
      var price = num(r.buyPrice) * k;
      var o = document.createElement("option");
      o.value = JSON.stringify({ name: r.name, sku: r.sku || "", warehouse: r.warehouse, priceInBase: price });
      o.textContent = r.name + " \u2014 " + r.warehouse + " (Qty: " + r.qty + ", Price: " + base + " " + price.toFixed(dp()) + ")";
      sel.appendChild(o);
    });
    sel.value = cur;
    if (!sel.__rb) {
      sel.__rb = 1;
      sel.addEventListener("change", function () {
        if (!this.value) return;
        try { var p = JSON.parse(this.value); $("rbItemPrice").value = Number(p.priceInBase || 0).toFixed(dp()); } catch (e) {}
      });
    }
  }
  function loadCustomOptions() {
    try {
      if (typeof addCustomOptionsToSelect === "function") {
        addCustomOptionsToSelect($("rbItemType"), "customItemTypes");
        addCustomOptionsToSelect($("rbTermDays"), "customTermDays");
      }
    } catch (e) {}
  }
  function refreshDropdowns() { loadSuppliers(); loadAccounts(); loadProducts(); loadCustomOptions(); }

  /* ---------- numbering ---------- */
  function nextNumber() {
    var max = 0;
    list().forEach(function (r) { var m = /(\d+)$/.exec(String(r.number || "")); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return "RBIL-" + pad(max + 1, 5);
  }

  /* ---------- form ---------- */
  function toggleRecurrence() {
    var t = $("rbRecurrenceType").value;
    var box = $("rbRecurrenceDaysBox"); if (box) box.classList.toggle("hidden", t !== "custom");
  }
  function addItem() {
    var v = $("rbProduct").value;
    if (!v) return alert("Select a product");
    var p; try { p = JSON.parse(v); } catch (e) { return alert("Invalid product selection. Please re-select."); }
    var type = ($("rbItemType").value || "").toLowerCase();
    if (!type) return alert("Select an item type");
    var qty = parseFloat($("rbItemQty").value), price = parseFloat($("rbItemPrice").value);
    var disc = parseFloat($("rbItemDiscount").value) || 0;
    if (isNaN(qty) || qty <= 0) return alert("Enter a valid quantity");
    if (isNaN(price) || price < 0) return alert("Enter a valid price");
    var it = { desc: p.name || "", sku: p.sku || "", warehouse: p.warehouse || "", qty: qty, price: price, discount: disc, taxRate: $("rbItemTax").value, type: type };
    var c = calc(it); it.subtotal = c.subtotal; it.vat = c.vat;
    if (editItemIdx !== null) { items[editItemIdx] = it; editItemIdx = null; } else items.push(it);
    renderItems();
    $("rbProduct").value = ""; $("rbItemQty").value = ""; $("rbItemPrice").value = ""; $("rbItemDiscount").value = "";
  }
  function editItem(i) {
    var it = items[i]; if (!it) return;
    editItemIdx = i;
    $("rbItemType").value = it.type || "";
    var sel = $("rbProduct"), found = false;
    for (var k = 0; k < sel.options.length; k++) {
      try { var p = JSON.parse(sel.options[k].value || "null"); if (p && p.sku === it.sku && p.name === it.desc && p.warehouse === it.warehouse) { sel.selectedIndex = k; found = true; break; } } catch (e) {}
    }
    if (!found) alert("Original product not found in inventory - please re-select it.");
    $("rbItemQty").value = it.qty; $("rbItemPrice").value = it.price; $("rbItemDiscount").value = it.discount || 0; $("rbItemTax").value = it.taxRate;
  }
  function removeItem(i) { if (editItemIdx === i) editItemIdx = null; items.splice(i, 1); renderItems(); }
  function renderItems() {
    var tb = $("rbItemTableBody"); if (!tb) return;
    tb.innerHTML = items.length ? "" : '<tr><td colspan="7" class="p-3 text-center text-gray-500">No items added</td></tr>';
    items.forEach(function (it, i) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + esc(it.desc) + ' <span class="text-sm text-gray-500">[' + esc(it.sku) + "]</span></td><td>" + esc(it.type) + "</td><td>" + esc(it.qty) + "</td><td>" + fmt(it.price) + "</td><td>" + fmt(it.vat) + "</td><td>" + fmt(it.subtotal + it.vat) + "</td>" +
        '<td><button onclick="rbEditItem(' + i + ')" class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800">Edit</button> <button onclick="rbRemoveItem(' + i + ')" class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800">Delete</button></td>';
      tb.appendChild(tr);
    });
    var t = totals(items), cur = $("rbCurrency").value, rate = num($("rbRate").value) || 1;
    var box = $("rbSummary");
    if (box) box.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Subtotal</span><b>' + money(t.subtotal, cur) + '</b></div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>VAT</span><b>' + money(t.vat, cur) + '</b></div><div style="display:flex;justify-content:space-between;border-top:1px solid #cbd5e1;padding-top:6px"><span>Total per bill</span><b>' + money(t.total, cur) + "</b></div>" +
      (rate !== 1 ? '<div style="display:flex;justify-content:space-between;margin-top:4px;color:#64748b"><span>Base currency</span><span>' + fmt(t.total * rate) + "</span></div>" : "");
  }
  function resetForm() {
    editId = null; editItemIdx = null; items = [];
    ["rbDate", "rbNextDate", "rbEndDate", "rbRecurrenceDays", "rbItemQty", "rbItemPrice", "rbItemDiscount"].forEach(function (id) { var e = $(id); if (e) e.value = ""; });
    ["rbSupplier", "rbTermDays", "rbAccount", "rbProduct", "rbItemType"].forEach(function (id) { var e = $(id); if (e) e.value = ""; });
    $("rbRecurrenceType").value = "monthly"; $("rbCurrency").value = "KES"; $("rbRate").value = "1";
    $("rbNumber").value = nextNumber();
    var h = $("rbFormTitle"); if (h) h.textContent = "Add Recurring Bill";
    var n = $("rbEditNote"); if (n) n.classList.add("hidden");
    toggleRecurrence(); renderItems();
  }

  /* ---------- bill creation ---------- */
  function refreshAfterBills() {
    ["loadSupplierBills", "renderSuppliers", "renderAccountsPayable", "renderInventorySummary", "renderInventoryTable", "updateDashboardTotals", "loadDashboard", "renderManualJournals"].forEach(function (n) { call(n); });
  }
  function makeBill(rb, runDate) {
    var bills = jget("bills", []);
    var used = {}; bills.forEach(function (b) { used[b.billNumber] = 1; });
    var no = ""; try { no = typeof generateBillNumber === "function" ? generateBillNumber() : ""; } catch (e) { no = ""; }
    var g = 0; while (!no || used[no]) { g++; no = "BIL-" + pad(bills.length + g, 4); if (g > 5000) break; }
    var rate = num(rb.currencyRate) || 1;
    var its = (rb.items || []).map(function (it) { var c = calc(it); return Object.assign({}, it, { subtotal: c.subtotal, vat: c.vat }); });
    var t = totals(its);
    var pg = 0, po = 0, pz = 0, pe = 0;
    its.forEach(function (it) {
      var r = String(it.taxRate || "").trim().toLowerCase();
      if (r === "16" || r === "16%") pg += it.subtotal; else if (r === "8" || r === "8%") po += it.subtotal; else if (r === "0" || r === "0%" || r === "zero") pz += it.subtotal; else if (r === "exempt") pe += it.subtotal;
    });
    var term = parseInt(rb.termDays, 10) || 0;
    var bill = {
      id: uuid(), billNumber: no, date: runDate, supplier: rb.supplier, chartOfAccount: rb.chartOfAccount, termDays: term, lpo: "",
      due: addDays(runDate, term), items: its, subtotal: t.subtotal, vat: t.vat, total: t.total * rate, currency: rb.currency || "KES", currencyRate: rate,
      paidAmount: 0, purchasesGeneral: pg, purchasesOther: po, purchasesZero: pz, purchasesExempt: pe,
      source: "recurring", recurringId: rb.id, recurringNumber: rb.number, recurringRun: runDate
    };
    bills.push(bill); jset("bills", bills);
    if (typeof applyBillToLedger === "function") applyBillToLedger(bill);
    else { call("updateSupplierBalance", bill.supplier, bill.total); call("postBillJournal", bill); call("updateAccountsPayable"); }
    return bill;
  }
  function plan(rb, upto) {
    var dates = [], nd = rb.nextDate, guard = 0, anchor = parseInt(String(rb.date || "").split("-")[2], 10) || undefined;
    while (nd && nd <= upto && (!rb.endDate || nd <= rb.endDate) && guard < MAX_CATCHUP) {
      dates.push(nd); guard++;
      if (!rb.recurrenceType || rb.recurrenceType === "none") { nd = null; break; }
      nd = advance(nd, rb.recurrenceType, rb.recurrenceDays, anchor);
    }
    return { dates: dates, next: nd };
  }
  function finish(rb, nd) {
    var one = !rb.recurrenceType || rb.recurrenceType === "none";
    if (!nd || (rb.endDate && nd > rb.endDate) || (one && rb.generated > 0)) { rb.nextDate = ""; rb.status = "Completed"; }
    else rb.nextDate = nd;
  }
  /* generate every bill that is due for one template; returns the bills made */
  function generateDue(rb, upto) {
    var made = [];
    if (!rb || rb.status !== "Active") return made;
    var p = plan(rb, upto || today());
    var existing = jget("bills", []);
    var stop = false, nd = rb.nextDate;
    p.dates.forEach(function (d) {
      if (stop) return;
      var dup = existing.some(function (b) { return b.recurringId === rb.id && b.recurringRun === d; });
      try {
        if (!dup) { var b = makeBill(rb, d); made.push(b); rb.generated = (rb.generated || 0) + 1; rb.lastGenerated = d; rb.lastBill = b.billNumber; }
        var anchor = parseInt(String(rb.date || "").split("-")[2], 10) || undefined;
        nd = (!rb.recurrenceType || rb.recurrenceType === "none") ? null : advance(d, rb.recurrenceType, rb.recurrenceDays, anchor);
      } catch (e) { console.error("[recurringBills] bill failed", e); stop = true; nd = d; }
    });
    if (p.dates.length) finish(rb, nd);
    return made;
  }
  function runAllDue(silent) {
    if (running) return 0;
    if (!localStorage.getItem("loggedInUser")) return 0;
    running = true;
    var total = 0;
    try {
      var all = list(), changed = false;
      all.forEach(function (rb) {
        if (rb.status === "Active" && rb.nextDate && rb.nextDate <= today()) {
          var made = generateDue(rb); if (made.length) { total += made.length; changed = true; }
        }
      });
      if (changed) { saveList(all); refreshAfterBills(); render(); }
    } catch (e) { console.error("[recurringBills] run failed", e); }
    running = false;
    if (total && silent) toast("Recurring Bills: " + total + " bill" + (total > 1 ? "s" : "") + " generated automatically.");
    return total;
  }
  function toast(msg) {
    try {
      var d = document.createElement("div"); d.textContent = msg;
      d.style.cssText = "position:fixed;right:16px;bottom:16px;max-width:340px;background:#1e3a8a;color:#fff;padding:10px 14px;border-radius:8px;z-index:2147483000;font:13px/1.4 sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3)";
      document.body.appendChild(d); setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 7000);
    } catch (e) {}
  }

  /* ---------- save / edit / delete ---------- */
  function save(status) {
    var isEdit = editId !== null;
    if (!can(isEdit ? "edit" : "add", isEdit ? "edit recurring bills" : "add recurring bills")) return;
    var date = $("rbDate").value, supplier = $("rbSupplier").value, account = $("rbAccount").value;
    var type = $("rbRecurrenceType").value, days = $("rbRecurrenceDays").value;
    var next = $("rbNextDate").value || date, end = $("rbEndDate").value;
    if (!date || !supplier || !account || !items.length) return alert("Fill the start date, supplier, account and add at least one item.");
    if (type === "custom" && !(parseInt(days, 10) > 0)) return alert("Enter the number of days between bills.");
    if (next < date) return alert("Next run date cannot be before the start date.");
    if (end && end < next) return alert("End date cannot be before the next run date.");
    var all = list(), prev = isEdit ? all.filter(function (r) { return r.id === editId; })[0] : null;
    var rate = num($("rbRate").value) || 1, t = totals(items);
    var st = status === "draft" ? "Draft" : (prev && prev.status === "Paused" ? "Paused" : "Active");
    var rb = {
      id: prev ? prev.id : uuid(), number: $("rbNumber").value || nextNumber(), date: date, nextDate: next, endDate: end,
      recurrenceType: type, recurrenceDays: days, supplier: supplier, chartOfAccount: account, termDays: $("rbTermDays").value || "0",
      currency: $("rbCurrency").value, currencyRate: rate, items: JSON.parse(JSON.stringify(items)),
      subtotal: t.subtotal, vat: t.vat, total: t.total, totalBase: t.total * rate, status: st,
      generated: prev ? prev.generated || 0 : 0, lastGenerated: prev ? prev.lastGenerated || "" : "", lastBill: prev ? prev.lastBill || "" : "",
      created: prev ? prev.created : new Date().toISOString(), updated: new Date().toISOString()
    };
    if (prev) all[all.indexOf(prev)] = rb; else all.push(rb);
    saveList(all);
    var made = [];
    if (st === "Active") {
      var due = plan(rb, today()).dates;
      if (due.length > 1 && !confirm(due.length + " bills are already due (" + due[0] + " to " + due[due.length - 1] + "). Generate them all now?")) {
        /* user declined catch-up: skip to the next future occurrence */
        var anchor = parseInt(date.split("-")[2], 10) || undefined, nd = rb.nextDate, g = 0;
        while (nd && nd <= today() && g++ < 5000) nd = advance(nd, rb.recurrenceType, rb.recurrenceDays, anchor);
        rb.nextDate = nd || ""; if (!nd) rb.status = "Completed";
      } else {
        made = generateDue(rb);
      }
      saveList(all);
    }
    if (made.length) refreshAfterBills();
    resetForm(); render();
    alert(st === "Draft" ? "Recurring bill saved as draft." : "Recurring bill saved." + (made.length ? " " + made.length + " bill" + (made.length > 1 ? "s" : "") + " generated: " + made.map(function (b) { return b.billNumber; }).join(", ") + "." : rb.nextDate ? " Next bill: " + rb.nextDate + "." : ""));
  }
  function edit(id) {
    if (!can("edit", "edit recurring bills")) return;
    var rb = list().filter(function (r) { return r.id === id; })[0]; if (!rb) return;
    refreshDropdowns();
    editId = id; editItemIdx = null;
    $("rbDate").value = rb.date || ""; $("rbNextDate").value = rb.nextDate || ""; $("rbEndDate").value = rb.endDate || "";
    $("rbRecurrenceType").value = rb.recurrenceType || "none"; $("rbRecurrenceDays").value = rb.recurrenceDays || "";
    $("rbSupplier").value = rb.supplier || ""; $("rbAccount").value = rb.chartOfAccount || ""; $("rbTermDays").value = rb.termDays || "";
    $("rbCurrency").value = rb.currency || "KES"; $("rbRate").value = rb.currencyRate || 1; $("rbNumber").value = rb.number;
    items = JSON.parse(JSON.stringify(rb.items || []));
    var h = $("rbFormTitle"); if (h) h.textContent = "Edit Recurring Bill " + rb.number;
    var n = $("rbEditNote"); if (n) n.classList.remove("hidden");
    toggleRecurrence(); renderItems();
    var tab = $("recurringBillsTab"); if (tab) tab.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function del(id) {
    if (!can("delete", "delete recurring bills")) return;
    var all = list(), rb = all.filter(function (r) { return r.id === id; })[0]; if (!rb) return;
    if (!confirm("Delete recurring bill " + rb.number + "?\n\nBills it already generated stay in Bills (delete them there if needed). No more bills will be created.")) return;
    saveList(all.filter(function (r) { return r.id !== id; }));
    if (editId === id) resetForm();
    render();
  }
  function bulkDelete() {
    if (!can("delete", "delete recurring bills")) return;
    var ids = checked(); if (!ids.length) return alert("Select at least one recurring bill.");
    if (!confirm("Delete " + ids.length + " recurring bill(s)? Bills already generated stay in Bills.")) return;
    saveList(list().filter(function (r) { return ids.indexOf(r.id) < 0; }));
    if (ids.indexOf(editId) > -1) resetForm();
    render();
  }
  function checked() { return Array.prototype.map.call(document.querySelectorAll("#rbTable .rbCheck:checked"), function (c) { return c.getAttribute("data-id"); }); }
  function toggleAll(box) { Array.prototype.forEach.call(document.querySelectorAll("#rbTable .rbCheck"), function (c) { c.checked = box.checked; }); }
  function clone() {
    if (!can("add", "add recurring bills")) return;
    var ids = checked(); if (!ids.length) return alert("Select at least one recurring bill to clone.");
    var all = list();
    ids.forEach(function (id) {
      var src = all.filter(function (r) { return r.id === id; })[0]; if (!src) return;
      var c = JSON.parse(JSON.stringify(src));
      var max = 0; all.forEach(function (r) { var m = /(\d+)$/.exec(String(r.number || "")); if (m) max = Math.max(max, parseInt(m[1], 10)); });
      c.id = uuid(); c.number = "RBIL-" + pad(max + 1, 5); c.status = "Draft"; c.generated = 0; c.lastGenerated = ""; c.lastBill = "";
      c.nextDate = c.date; c.created = new Date().toISOString(); c.updated = c.created;
      all.push(c);
    });
    saveList(all); render(); alert("Cloned as draft(s). Edit and save them to start the schedule.");
  }
  function toggleStatus(id) {
    if (!can("edit", "edit recurring bills")) return;
    var all = list(), rb = all.filter(function (r) { return r.id === id; })[0]; if (!rb) return;
    if (rb.status === "Active") rb.status = "Paused";
    else if (rb.status === "Paused" || rb.status === "Draft") {
      if (rb.status === "Draft" && !confirm("Activate this draft? Any bills already due will be generated.")) return;
      rb.status = "Active";
    } else return alert("This recurring bill is completed. Edit it and set a new next run date / end date to run it again.");
    saveList(all);
    if (rb.status === "Active") { var m = generateDue(rb); saveList(all); if (m.length) refreshAfterBills(); }
    render();
  }
  function generateNow(id) {
    if (!can("add", "add bills")) return;
    var all = list(), rb = all.filter(function (r) { return r.id === id; })[0]; if (!rb) return;
    if (rb.status === "Draft") return alert("Activate the draft first.");
    if (!confirm("Generate a bill from " + rb.number + " dated today?")) return;
    var b;
    try { b = makeBill(rb, today()); } catch (e) { console.error(e); return alert("Could not generate the bill: " + e.message); }
    rb.generated = (rb.generated || 0) + 1; rb.lastGenerated = today(); rb.lastBill = b.billNumber;
    if (rb.status === "Active" && rb.nextDate && rb.nextDate <= today()) {
      var anchor = parseInt(String(rb.date).split("-")[2], 10) || undefined;
      finish(rb, !rb.recurrenceType || rb.recurrenceType === "none" ? null : advance(rb.nextDate, rb.recurrenceType, rb.recurrenceDays, anchor));
    }
    saveList(all); refreshAfterBills(); render();
    alert("Bill " + b.billNumber + " generated.");
  }

  /* ---------- list ---------- */
  function filtered() {
    var q = query.toLowerCase(), a = list().filter(function (r) {
      return !q || [r.number, r.supplier, r.status, r.recurrenceType, r.nextDate, r.date].join(" ").toLowerCase().indexOf(q) > -1;
    });
    if (sortKey) a.sort(function (x, y) {
      var u = sortKey === "amount" ? num(x.total) : String(x[sortKey] || "").toLowerCase(), v = sortKey === "amount" ? num(y.total) : String(y[sortKey] || "").toLowerCase();
      return (u > v ? 1 : u < v ? -1 : 0) * sortDir;
    });
    return a;
  }
  var BTN = 'class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800"';
  function render() {
    var tb = $("rbTable"); if (!tb) return;
    var a = filtered(), n = a.length, pages = Math.max(1, Math.ceil(n / perPage));
    if (page > pages) page = pages; if (page < 1) page = 1;
    var s = (page - 1) * perPage, e = s + perPage;
    tb.innerHTML = "";
    a.slice(s, e).forEach(function (r) {
      var id = esc(r.id), tr = document.createElement("tr");
      tr.innerHTML = '<td><input type="checkbox" class="rbCheck" data-id="' + id + '"></td><td>' + esc(r.number) + "</td><td>" + esc(r.date) + "</td><td>" + esc(r.supplier) + "</td><td>" + esc(r.recurrenceType === "none" ? "once" : r.recurrenceType) + "</td><td>" + esc(r.nextDate || "-") + "</td><td>" + money(r.total, r.currency) + "</td><td>" + esc(r.generated || 0) + "</td><td>" + esc(r.status) + "</td><td>" +
        '<button onclick="rbPreview(\'' + id + '\')" ' + BTN + '>Preview</button> <button onclick="rbEdit(\'' + id + '\')" ' + BTN + '>Edit</button> <button onclick="rbDelete(\'' + id + '\')" ' + BTN + '>Delete</button> <button onclick="rbGenerateNow(\'' + id + '\')" ' + BTN + '>Generate Now</button> <button onclick="rbToggle(\'' + id + '\')" ' + BTN + ">" + (r.status === "Active" ? "Pause" : "Resume") + '</button> <button onclick="rbShowBills(\'' + id + '\')" ' + BTN + ">Bills</button></td>";
      tb.appendChild(tr);
    });
    var set = function (id, t) { var el = $(id); if (el) el.textContent = t; };
    set("rbTotalCount", n); set("rbPageInfo", n ? (s + 1) + " - " + Math.min(e, n) + " of " + n : "0 - 0");
    var p = $("rbPrevBtn"), nx = $("rbNextBtn"); if (p) p.disabled = page <= 1; if (nx) nx.disabled = page >= pages;
  }
  function sortBy(k) { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; } render(); }
  function exportCsv() {
    var rows = [["Number", "Start Date", "Supplier", "Frequency", "Next Run", "End Date", "Currency", "Total", "Bills Generated", "Status"]];
    filtered().forEach(function (r) { rows.push([r.number, r.date, r.supplier, r.recurrenceType, r.nextDate, r.endDate, r.currency, r.total, r.generated || 0, r.status]); });
    var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "recurring-bills.csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- preview / generated bills ---------- */
  function modal(html) {
    var m = $("rbModal"); if (m) m.remove();
    m = document.createElement("div"); m.id = "rbModal";
    m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:2147482000";
    m.innerHTML = '<div style="background:#fff;border-radius:8px;padding:20px;width:min(760px,94vw);max-height:90vh;overflow:auto;font-size:13px;color:#111">' + html + "</div>";
    m.addEventListener("mousedown", function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
  }
  function preview(id) {
    var rb = list().filter(function (r) { return r.id === id; })[0]; if (!rb) return;
    var org = jget("orgInfo", {}), sup = jget("suppliers", []).filter(function (s) { return s.name === rb.supplier; })[0] || {};
    var rows = (rb.items || []).map(function (it, i) { return "<tr><td>" + (i + 1) + "</td><td>" + esc(it.desc) + "</td><td>" + esc(it.type) + "</td><td>" + esc(it.qty) + "</td><td>" + fmt(it.price) + "</td><td>" + fmt(it.vat) + "</td><td>" + fmt(num(it.subtotal) + num(it.vat)) + "</td></tr>"; }).join("");
    var freq = rb.recurrenceType === "custom" ? "every " + rb.recurrenceDays + " days" : (rb.recurrenceType === "none" ? "once" : rb.recurrenceType);
    modal('<div id="rbPrintArea"><h3 style="font-size:15px;font-weight:bold;text-align:center;margin-bottom:10px">Recurring Bill ' + esc(rb.number) + '</h3>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:10px"><div><b>Supplier</b><br>' + esc(rb.supplier) + "<br>" + esc(sup.address || "") + "<br>PIN: " + esc(sup.krapin || "") + '</div><div style="text-align:right"><b>' + esc(org.name || "My Company") + "</b><br>PIN: " + esc(org.pin || "") + "<br>" + esc(org.address || "") + "</div></div>" +
      "<p>Start: " + esc(rb.date) + " &nbsp;|&nbsp; Repeats: " + esc(freq) + " &nbsp;|&nbsp; Next run: " + esc(rb.nextDate || "-") + (rb.endDate ? " &nbsp;|&nbsp; Ends: " + esc(rb.endDate) : "") + " &nbsp;|&nbsp; Terms: " + esc(rb.termDays || 0) + " days &nbsp;|&nbsp; Account: " + esc(rb.chartOfAccount) + " &nbsp;|&nbsp; Status: " + esc(rb.status) + "</p>" +
      '<table style="width:100%;border-collapse:collapse;margin-top:8px" border="1" cellpadding="5"><thead style="background:#f3f4f6"><tr><th>#</th><th>Item</th><th>Type</th><th>Qty</th><th>Price</th><th>VAT</th><th>Total</th></tr></thead><tbody>' + rows + "</tbody></table>" +
      '<div style="text-align:right;margin-top:8px;font-weight:600"><p>Subtotal: ' + money(rb.subtotal, rb.currency) + "</p><p>VAT: " + money(rb.vat, rb.currency) + "</p><p>Total per bill: " + money(rb.total, rb.currency) + "</p></div></div>" +
      '<div style="text-align:right;margin-top:12px"><button id="rbPrintBtn" ' + BTN + '>Print</button> <button id="rbCloseBtn" ' + BTN + ">Close</button></div>");
    $("rbCloseBtn").onclick = function () { $("rbModal").remove(); };
    $("rbPrintBtn").onclick = function () {
      var w = window.open("", "_blank"); if (!w) return;
      w.document.write("<html><head><title>" + esc(rb.number) + '</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}</style></head><body>' + $("rbPrintArea").innerHTML + "</body></html>");
      w.document.close(); w.print();
    };
  }
  function showBills(id) {
    var rb = list().filter(function (r) { return r.id === id; })[0]; if (!rb) return;
    var bs = jget("bills", []).filter(function (b) { return b.recurringId === id; });
    var rows = bs.map(function (b) {
      var paid = num(b.paidAmount), st = paid >= num(b.total) && num(b.total) > 0 ? "Full Paid" : paid > 0 ? "Partial Paid" : "Unpaid";
      return "<tr><td>" + esc(b.billNumber) + "</td><td>" + esc(b.date) + "</td><td>" + esc(b.due || "") + "</td><td>" + fmt(b.total) + "</td><td>" + fmt(paid) + "</td><td>" + st + "</td></tr>";
    }).join("") || '<tr><td colspan="6" style="text-align:center;color:#6b7280">No bills generated yet</td></tr>';
    modal('<h3 style="font-size:15px;font-weight:bold;margin-bottom:8px">Bills generated by ' + esc(rb.number) + '</h3><table style="width:100%;border-collapse:collapse" border="1" cellpadding="5"><thead style="background:#f3f4f6"><tr><th>Bill #</th><th>Date</th><th>Due</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table><p style="margin-top:8px;color:#6b7280">Pay, edit or delete these in Purchase Hub &gt; Bills.</p><div style="text-align:right;margin-top:10px"><button id="rbOpenBills" ' + BTN + '>Open Bills</button> <button id="rbCloseBtn" ' + BTN + ">Close</button></div>");
    $("rbCloseBtn").onclick = function () { $("rbModal").remove(); };
    $("rbOpenBills").onclick = function () { $("rbModal").remove(); if (typeof showTab === "function") showTab("supplierBillsTab"); };
  }

  /* ---------- wiring ---------- */
  function onOpen() { refreshDropdowns(); if (!editId) $("rbNumber").value = nextNumber(); renderItems(); runAllDue(true); render(); }
  function init() {
    var tab = $("recurringBillsTab"); if (!tab) return;
    if (!$("rbNumber").value) $("rbNumber").value = nextNumber();
    toggleRecurrence(); renderItems(); render();
    var vis = !tab.classList.contains("hidden"); if (vis) onOpen();
    try {
      new MutationObserver(function () { if (!tab.classList.contains("hidden")) onOpen(); }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}
    ["rbCurrency", "rbRate"].forEach(function (id) { var el = $(id); if (el) el.addEventListener("input", renderItems); });
    var sb = $("rbSearch"); if (sb) sb.addEventListener("input", function () { query = this.value; page = 1; render(); });
    document.addEventListener("click", function (e) {
      var menu = $("rbOptionsMenu"), btn = $("rbOptionsBtn");
      if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) menu.classList.add("hidden");
    });
    try { if (typeof acxCanOpenTab === "function" && !acxCanOpenTab("supplierBillsTab")) { var b = document.querySelector('button[onclick*="recurringBillsTab"]'); if (b && b.parentNode) b.parentNode.style.display = "none"; } } catch (e) {}
    setTimeout(function () { runAllDue(true); }, 3500);
    setInterval(function () { runAllDue(true); }, 30 * 60 * 1000);
    window.addEventListener("focus", function () { runAllDue(true); });
    window.addEventListener("storage", function (e) { if (e && e.key === KEY) render(); });
  }

  window.rbToggleRecurrence = toggleRecurrence;
  window.rbAddItem = addItem; window.rbEditItem = editItem; window.rbRemoveItem = removeItem;
  window.rbSave = save; window.rbEdit = edit; window.rbDelete = del; window.rbBulkDelete = bulkDelete;
  window.rbToggleAll = toggleAll; window.rbClone = clone; window.rbToggle = toggleStatus; window.rbGenerateNow = generateNow;
  window.rbPreview = preview; window.rbShowBills = showBills; window.rbSortBy = sortBy; window.rbExport = exportCsv;
  window.rbCancelEdit = resetForm; window.rbRunDue = function () { var n = runAllDue(false); alert(n ? n + " bill(s) generated." : "Nothing is due right now."); };
  window.rbMenu = function () { var m = $("rbOptionsMenu"); if (m) m.classList.toggle("hidden"); };
  window.rbPage = function (d) { page += d; render(); };
  window.rbPerPage = function (v) { perPage = parseInt(v, 10) || 25; page = 1; render(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
