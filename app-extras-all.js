/* app-extras-all.js = account-guard + plan-expiry + app-extras (notifications etc.) + recurring-bills.
   Replaces: app-extras-guard.js, app-extras.js, recurring-bills.js, payroll-months.js */
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
(function(){"use strict";if(window.__acxNotifPlus)return;window.__acxNotifPlus=true;var KEY="notifications",MAX=200,LOW_QTY=5,DUE_SOON_DAYS=7,EXPIRY_DAYS=30,MAX_LINES=4;var $=function(id){return document.getElementById(id)};var esc=function(x){return String(x==null?"":x).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};var num=function(v){var x=parseFloat(String(v==null?"":v).replace(/,/g,""));return isNaN(x)?0:x};var arr=function(k){try{var a=JSON.parse(localStorage.getItem(k)||"[]");return Array.isArray(a)?a:[]}catch(e){return[]}};var jget=function(k,d){try{var v=JSON.parse(localStorage.getItem(k)||"null");return v==null?d:v}catch(e){return d}};var jset=function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};var cid=function(){var u=jget("loggedInUser",null);return u&&u.companyId?String(u.companyId):""};var fmt=function(cur,v){return(cur||"KES")+" "+v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})};var uid=function(){return"n"+Date.now().toString(36)+Math.random().toString(36).slice(2,7)};var NOISE=/Opened[: ]|Quick Create panel|Data refreshed successfully|Welcome! No new updates/i;function load(){var l=arr(KEY),changed=false;l.forEach(function(n){if(!n.id){n.id=uid();changed=true}if(!n.ts){var t=Date.parse(n.time);n.ts=isNaN(t)?Date.now():t;changed=true}if(!n.title){n.title=n.message||"";changed=true}});if(changed)jset(KEY,l);return l}function save(l){jset(KEY,l.slice(0,MAX))}window.addNotification=function(msg,opts){opts=opts||{};var title=String(msg==null?"":msg);if(!opts.force&&NOISE.test(title))return;var l=load();l.unshift({id:uid(),message:title,title:title,lines:opts.lines||[],tab:opts.tab||"",type:opts.type||"info",key:opts.key||"",ts:Date.now(),time:(new Date).toLocaleString(),read:false});save(l);render()};function today0(){var d=new Date;d.setHours(0,0,0,0);return d}function pd(s){if(!s)return null;s=String(s).trim();var m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);var d=new Date(s);return isNaN(d.getTime())?null:d}var DAY=864e5;function outstanding(d){if(d.balance!=null&&d.balance!=="")return num(d.balance);return num(d.total)-num(d.amountPaid!=null?d.amountPaid:d.paidAmount)}function isOpen(d){if(!d||d.paid===true)return false;return!/^\s*(paid|void|cancel|reject|draft|pending)/i.test(String(d.status||""))}function more(lines,n){if(lines.length>n){var r=lines.length-n;lines=lines.slice(0,n);lines.push("+"+r+" more")}return lines}function buildAlerts(){var out={},t0=today0().getTime();var over=[];arr("invoices").forEach(function(i){if(!isOpen(i))return;var due=pd(i.dueDate);if(!due)return;var days=Math.floor((t0-due.getTime())/DAY),o=outstanding(i);if(days>0&&o>.005)over.push({days:days,line:(i.invoiceNumber||"Invoice")+" · "+(i.customer||"-")+" · "+fmt(i.currency,o)+" · "+days+"d overdue"})});if(over.length){over.sort(function(a,b){return b.days-a.days});out["inv-overdue"]={type:"overdue",tab:"invoicesTab",title:over.length+" overdue invoice"+(over.length>1?"s":""),full:over.map(function(x){return x.line}).slice(0,60),lines:more(over.map(function(x){return x.line}),MAX_LINES)}}var bo=[],bs=[];arr("bills").forEach(function(b){if(!isOpen(b))return;var due=pd(b.dueDate);if(!due)return;var diff=Math.round((due.getTime()-t0)/DAY),o=outstanding(b);if(o<=.005)return;var base=(b.billNumber||"Bill")+" · "+(b.supplier||"-")+" · "+fmt(b.currency,o);if(diff<0)bo.push({k:diff,line:base+" · "+-diff+"d overdue"});else if(diff<=DUE_SOON_DAYS)bs.push({k:diff,line:base+" · "+(diff===0?"due today":"due in "+diff+"d")})});if(bo.length){bo.sort(function(a,b){return a.k-b.k});out["bill-overdue"]={type:"bill",tab:"supplierBillsTab",title:bo.length+" overdue bill"+(bo.length>1?"s":"")+" to pay",full:bo.map(function(x){return x.line}).slice(0,60),lines:more(bo.map(function(x){return x.line}),MAX_LINES)}}if(bs.length){bs.sort(function(a,b){return a.k-b.k});out["bill-soon"]={type:"bill",tab:"supplierBillsTab",title:bs.length+" bill"+(bs.length>1?"s":"")+" due within "+DUE_SOON_DAYS+" days",full:bs.map(function(x){return x.line}).slice(0,60),lines:more(bs.map(function(x){return x.line}),MAX_LINES)}}var low=[],outc=0,exp=[],soon=[];var whs=[];try{if(typeof window.__invWarehouseNames==="function")whs=window.__invWarehouseNames()||[]}catch(e){}whs.forEach(function(w){var items=[];try{items=typeof window.getInventory==="function"?window.getInventory(w):[]}catch(e){}(items||[]).forEach(function(it){if(!it||it.active===false)return;var q=num(it.qty),nm=it.name||it.sku||"-";if(q<LOW_QTY){if(q<=0)outc++;low.push({q:q,line:nm+" — "+(q<=0?"out of stock":q+" left")+" ("+w+")"})}(it.batches||[]).forEach(function(b){var e=pd(b.expiryDate);if(!e||num(b.qty)<=0)return;var d=Math.round((e.getTime()-t0)/DAY);var ln=nm+(b.batchNo?" · batch "+b.batchNo:"")+" · "+num(b.qty)+" units";if(d<0)exp.push({k:d,line:ln+" · expired "+-d+"d ago"});else if(d<=EXPIRY_DAYS)soon.push({k:d,line:ln+" · expires in "+d+"d"})})})});if(low.length){low.sort(function(a,b){return a.q-b.q});out["stock"]={type:"stock",tab:"inventoryTab",title:low.length+" item"+(low.length>1?"s":"")+" low on stock"+(outc?" ("+outc+" out)":""),full:low.map(function(x){return x.line}).slice(0,60),lines:more(low.map(function(x){return x.line}),MAX_LINES)}}if(exp.length){exp.sort(function(a,b){return a.k-b.k});out["batch-expired"]={type:"expiry",tab:"inventoryTab",title:exp.length+" expired batch"+(exp.length>1?"es":"")+" still in stock",full:exp.map(function(x){return x.line}).slice(0,60),lines:more(exp.map(function(x){return x.line}),MAX_LINES)}}if(soon.length){soon.sort(function(a,b){return a.k-b.k});out["batch-soon"]={type:"expiry",tab:"inventoryTab",title:soon.length+" batch"+(soon.length>1?"es":"")+" expiring within "+EXPIRY_DAYS+" days",full:soon.map(function(x){return x.line}).slice(0,60),lines:more(soon.map(function(x){return x.line}),MAX_LINES)}}return out}function sync(alerts){var l=load(),c=cid(),dkey="__notifDismiss_"+c,dismissed=jget(dkey,{}),changed=false;var seen={};Object.keys(alerts).forEach(function(k){var a=alerts[k],sig=JSON.stringify([a.title,a.full||a.lines]);if(dismissed[k]===sig){seen[k]=1;return}var ex=null;for(var i=0;i<l.length;i++)if(l[i].key===k){ex=l[i];break}seen[k]=1;if(!ex){l.unshift({id:uid(),message:a.title,title:a.title,lines:a.lines,full:a.full,tab:a.tab,type:a.type,key:k,sig:sig,ts:Date.now(),time:(new Date).toLocaleString(),read:false});changed=true}else if(ex.sig!==sig){ex.title=ex.message=a.title;ex.lines=a.lines;ex.full=a.full;ex.sig=sig;ex.ts=Date.now();ex.time=(new Date).toLocaleString();ex.read=false;changed=true}});var keep=l.filter(function(n){return!n.key||n.type==="new"||seen[n.key]});if(keep.length!==l.length){l=keep;changed=true}Object.keys(dismissed).forEach(function(k){if(!alerts[k]){delete dismissed[k]}});jset(dkey,dismissed);if(changed)save(l)}function activity(){var c=cid();if(!c)return;var sk="__notifSeen_"+c,seen=jget(sk,null),first=!seen;seen=seen||{inv:[],bill:[]};var sets={inv:{},bill:{}};seen.inv.forEach(function(x){sets.inv[x]=1});seen.bill.forEach(function(x){sets.bill[x]=1});var defs=[{k:"inv",rows:arr("invoices"),noun:"invoice",tab:"invoicesTab",num:"invoiceNumber",who:"customer"},{k:"bill",rows:arr("bills"),noun:"bill",tab:"supplierBillsTab",num:"billNumber",who:"supplier"}];var made=[];defs.forEach(function(d){var fresh=[];d.rows.forEach(function(r){var id=String(r.id!=null?r.id:r[d.num]);if(!id||id==="undefined")return;if(!sets[d.k][id]){sets[d.k][id]=1;if(!first&&!/^\s*draft/i.test(String(r.status||"")))fresh.push(r)}});if(fresh.length===1||fresh.length&&fresh.length<=3){fresh.forEach(function(r){var due=pd(r.dueDate);made.push({title:"New "+d.noun+" "+(r[d.num]||""),type:"new",tab:d.tab,lines:[(r[d.who]||"-")+" · "+fmt(r.currency,num(r.total)),due?"Due "+due.toLocaleDateString():""].filter(Boolean)})})}else if(fresh.length>3){made.push({title:fresh.length+" new "+d.noun+"s",type:"new",tab:d.tab,full:fresh.map(function(r){return(r[d.num]||"")+" · "+(r[d.who]||"-")+" · "+fmt(r.currency,num(r.total))}).slice(0,60),lines:more(fresh.map(function(r){return(r[d.num]||"")+" · "+(r[d.who]||"-")+" · "+fmt(r.currency,num(r.total))}),MAX_LINES)})}});jset(sk,{inv:Object.keys(sets.inv),bill:Object.keys(sets.bill)});if(made.length){var l=load();made.reverse().forEach(function(m){l.unshift({id:uid(),message:m.title,title:m.title,lines:m.lines,tab:m.tab,type:m.type,key:"",ts:Date.now(),time:(new Date).toLocaleString(),read:false})});save(l)}}var WATCH=[{k:"invoices",noun:"Invoice",tab:"invoicesTab",nums:["invoiceNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"bills",noun:"Bill",tab:"supplierBillsTab",nums:["billNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"quotes",noun:"Quote",tab:"quotesTab",nums:["quoteNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"orders",noun:"Sales order",tab:"ordersTab",nums:["orderNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"receipts",noun:"Receipt",tab:"receiptsTab",nums:["receiptNumber","number","id"],who:["customer","customerName"],amt:["amount","total"]},{k:"billPayments",noun:"Bill payment",tab:"supplierPaymentsTab",nums:["reference","id"],who:["supplier","supplierName"],amt:["amount","total"]},{k:"creditNotes",noun:"Credit note",tab:"creditNoteTab",nums:["number","creditNoteNumber","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"supplierDebitNotes",noun:"Debit note",tab:"supplierDebitNotesTab",nums:["number","debitNoteNumber","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"purchaseOrders",noun:"Purchase order",tab:"supplierPurchaseOrdersTab",nums:["poNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"grns",noun:"GRN",tab:"grnTab",nums:["grnNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"salesReturns",noun:"Sales return",tab:"salesReturnTab",nums:["returnNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"purchaseReturns",noun:"Purchase return",tab:"purchaseReturnsTab",nums:["returnNumber","number","id"],who:["supplier","supplierName"],amt:["total","amount"]},{k:"deliveries",noun:"Delivery",tab:"deliveryTab",nums:["deliveryNumber","number","id"],who:["customer","customerName"],amt:["total","amount"]},{k:"manualJournals",noun:"Journal",tab:"manualJournalsTab",nums:["journalNo","journalNumber","number","reference","id"],who:["description","narration","notes"],amt:["total","amount","debit"]},{k:"customers",noun:"Customer",tab:"customersTab",nums:["name","id"],who:[],amt:[],lite:true},{k:"suppliers",noun:"Supplier",tab:"supplierTab",nums:["name","id"],who:[],amt:[],lite:true},{k:"users",noun:"User",tab:"userManagementTab",nums:["username","name","id"],who:["role"],amt:[],lite:true}];var ACTOR=["updatedBy","modifiedBy","editedBy","createdBy","user","username","preparedBy","salesperson"];var pick=function(r,fs){for(var i=0;i<fs.length;i++){var v=r[fs[i]];if(v!=null&&v!==""&&typeof v!=="object")return v}return""};var isDraft=function(s){return/^\s*draft/i.test(String(s||""))};var isPaid=function(s){return/^\s*paid/i.test(String(s||""))};function idOf(r,w){var v=r.id!=null&&r.id!==""?r.id:pick(r,w.nums);return v===""?null:String(v)}function sigOf(r,w){var st=pick(r,["status","packageStatus"]);if(!st&&r.paid===true)st="Paid";var bal=r.balance!=null&&r.balance!==""?num(r.balance):null;return[String(pick(r,w.nums)),String(pick(r,w.who)),num(pick(r,w.amt)),String(st),bal,String(r.dueDate||""),String(pick(r,ACTOR)),String(r.currency||"")]}var head=function(w,s){return w.noun+(s[0]?" "+s[0]:"")};var low=function(w){return w.noun.charAt(0).toLowerCase()+w.noun.slice(1)};function body(w,s){var l=[],who=s[1],a=s[2]?fmt(s[7],s[2]):"";if(who||a)l.push((who||"-")+(a?" · "+a:""));var d=pd(s[5]);if(d)l.push("Due "+d.toLocaleDateString());if(s[3])l.push("Status: "+s[3]);if(s[6])l.push("By "+s[6]);return l}function delta(w,o,n){var L=[],h=head(w,n);if(o[2]!==n[2])L.push("Amount: "+fmt(n[7],o[2])+" → "+fmt(n[7],n[2]));if(o[3]!==n[3])L.push("Status: "+(o[3]||"-")+" → "+(n[3]||"-"));if(o[4]!=null&&n[4]!=null&&o[4]!==n[4])L.push("Balance: "+fmt(n[7],o[4])+" → "+fmt(n[7],n[4]));if(o[1]!==n[1]&&!w.lite)L.push("Name/Details: "+(o[1]||"-")+" → "+(n[1]||"-"));if(o[5]!==n[5])L.push("Due date: "+(o[5]||"-")+" → "+(n[5]||"-"));if(o[0]!==n[0]&&o[0])L.push("Number: "+o[0]+" → "+n[0]);if(!L.length)return null;var r={tab:w.tab,type:"edit"},who=n[1]?[n[1]+(n[2]?" · "+fmt(n[7],n[2]):"")]:[];if(isDraft(o[3])&&!isDraft(n[3])){r.title="New "+low(w)+" "+n[0];r.type="new";r.lines=body(w,n);return r}var cleared=o[4]!=null&&n[4]!=null&&o[4]>.005&&n[4]<=.005;if(isPaid(n[3])&&!isPaid(o[3])||cleared){r.title=h+" paid in full";r.type="paid"}else if(o[4]!=null&&n[4]!=null&&n[4]<o[4]){r.title="Payment of "+fmt(n[7],o[4]-n[4])+" on "+h;r.type="paid"}else if(o[3]!==n[3]&&n[3])r.title=h+" → "+n[3];else r.title=h+" updated";if(n[6])L.push("By "+n[6]);r.lines=who.concat(L);return r}var fps={},snap=null,snapCid="";function fpOf(s){var h=5381;for(var i=0;i<s.length;i++)h=(h<<5)+h+s.charCodeAt(i)|0;return s.length+":"+h}function changes(){var c=cid();if(!c)return 0;var sk="__notifSnap_"+c;if(snapCid!==c){snap=jget(sk,null);snapCid=c;fps={}}var first=!snap;if(first)snap={};var made=[],dirty=false;WATCH.forEach(function(w){var raw=null;try{raw=localStorage.getItem(w.k)}catch(e){}if(raw==null)return;var f=fpOf(raw);if(fps[w.k]===f)return;fps[w.k]=f;var data;try{data=JSON.parse(raw)}catch(e){return}if(!Array.isArray(data))return;var old=snap[w.k],nm={};data.forEach(function(r){if(!r||typeof r!=="object")return;var id=idOf(r,w);if(id!=null)nm[id]=sigOf(r,w)});snap[w.k]=nm;dirty=true;if(first||!old)return;var add=[],del=[],chg=[];Object.keys(nm).forEach(function(id){if(!old[id]){if(!isDraft(nm[id][3]))add.push(nm[id])}else if(!w.lite){var d=delta(w,old[id],nm[id]);if(d)chg.push(d)}});Object.keys(old).forEach(function(id){if(!nm[id]&&!isDraft(old[id][3]))del.push(old[id])});var one=function(s){return head(w,s)+(s[1]?" · "+s[1]:"")+(s[2]?" · "+fmt(s[7],s[2]):"")};if(add.length>3){var fl=add.map(one);made.push({title:add.length+" new "+low(w)+"s",type:"new",tab:w.tab,lines:more(fl.slice(),MAX_LINES),full:fl.slice(0,60)})}else add.forEach(function(s){made.push({title:"New "+low(w)+" "+s[0],type:"new",tab:w.tab,lines:body(w,s)})});if(chg.length>3){var cl=chg.map(function(x){return x.title+(x.lines[1]?" — "+x.lines[1]:"")});made.push({title:chg.length+" "+low(w)+"s updated",type:"edit",tab:w.tab,lines:more(cl.slice(),MAX_LINES),full:cl.slice(0,60)})}else chg.forEach(function(x){made.push(x)});if(del.length>3){var dl=del.map(one);made.push({title:del.length+" "+low(w)+"s deleted",type:"del",tab:w.tab,lines:more(dl.slice(),MAX_LINES),full:dl.slice(0,60)})}else del.forEach(function(s){made.push({title:head(w,s)+" deleted",type:"del",tab:w.tab,lines:body(w,s)})})});if(dirty)jset(sk,snap);if(made.length){var l=load();made.reverse().forEach(function(m){l.unshift({id:uid(),message:m.title,title:m.title,lines:m.lines,full:m.full,tab:m.tab,type:m.type,key:"",ts:Date.now(),time:(new Date).toLocaleString(),read:false})});save(l);render()}return made.length}var lastScan=0;function scan(force){try{if(!cid())return;if(!force&&Date.now()-lastScan<6e4)return;lastScan=Date.now();sync(buildAlerts());changes();render()}catch(e){console.warn("[notifications-plus]",e)}}var ICON={overdue:["⏰","#fee2e2","#b91c1c"],bill:["💳","#ffedd5","#c2410c"],stock:["📦","#fef3c7","#b45309"],expiry:["⌛","#ede9fe","#6d28d9"],new:["🧾","#dbeafe","#1d4ed8"],paid:["✅","#dcfce7","#15803d"],edit:["✏️","#e0f2fe","#0369a1"],del:["🗑️","#fee2e2","#b91c1c"],info:["🔔","#f3f4f6","#4b5563"]};var filter="all",fresh={},opened={};function rel(ts){var s=Math.max(0,Math.round((Date.now()-ts)/1e3));if(s<60)return"just now";var m=Math.round(s/60);if(m<60)return m+"m ago";var h=Math.round(m/60);if(h<24)return h+"h ago";var d=Math.round(h/24);if(d<7)return d+"d ago";return new Date(ts).toLocaleDateString()}function chrome(){var p=$("notifPopup");if(!p||p.__plus)return;p.__plus=true;p.style.width="390px";p.style.maxWidth="94vw";p.style.height="72vh";var head=p.firstElementChild;if(!head)return;var h3=head.querySelector("h3");if(h3)h3.textContent="🔔 Notifications";var bar=document.createElement("div");bar.style.cssText="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #f1f1f1;font-size:12px;flex:none";bar.innerHTML='<button data-f="all" class="acx-np-pill">All</button><button data-f="unread" class="acx-np-pill">Unread</button><span style="flex:1"></span>'+'<button data-a="read" class="acx-np-link">Mark all read</button><button data-a="clear" class="acx-np-link" style="color:#dc2626">Clear all</button>';head.insertAdjacentElement("afterend",bar);var st=document.createElement("style");st.textContent=".acx-np-pill{border:1px solid #d1d5db;border-radius:999px;padding:1px 10px;background:#fff;color:#374151;cursor:pointer}.acx-np-pill.on{background:#1e3a8a;color:#fff;border-color:#1e3a8a}.acx-np-link{background:none;border:0;color:#2563eb;cursor:pointer;padding:0 2px}.acx-np-link:hover{text-decoration:underline}"+".acx-np-item{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid #f1f1f1;cursor:pointer;position:relative}.acx-np-item:hover{background:#f8fafc}.acx-np-item.fresh{background:#eff6ff;box-shadow:inset 3px 0 0 #2563eb}"+".acx-np-ic{width:34px;height:34px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;font-size:16px}.acx-np-x{position:absolute;right:8px;top:6px;border:0;background:none;color:#9ca3af;cursor:pointer;display:none;font-size:12px}.acx-np-item:hover .acx-np-x{display:block}";document.head.appendChild(st);bar.addEventListener("click",function(e){var f=e.target.closest("[data-f]"),a=e.target.closest("[data-a]");if(f){filter=f.getAttribute("data-f");render()}if(a&&a.getAttribute("data-a")==="read"){markAllRead();fresh={};render()}if(a&&a.getAttribute("data-a")==="clear"){if(confirm("Clear all notifications?"))clearAll()}});var ul=$("notifList");if(ul)ul.addEventListener("click",function(e){var li=e.target.closest(".acx-np-item");if(!li)return;var id=li.getAttribute("data-id");if(e.target.closest(".acx-np-x")){dismiss(id);return}var n=load().filter(function(x){return x.id===id})[0];if(!n)return;if(e.target.closest("[data-go]")){if(n.tab&&typeof window.showTab==="function"){p.classList.add("hidden");try{window.showTab(n.tab)}catch(x){}}return}opened[id]=!opened[id];render()})}function render(){var ul=$("notifList"),cnt=$("notifCount");if(!ul||!cnt)return;chrome();var list=load(),unread=list.filter(function(n){return!n.read}).length;cnt.textContent=unread>99?"99+":unread;cnt.classList.toggle("hidden",unread===0);document.querySelectorAll(".acx-np-pill").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-f")===filter)});var shown=list.filter(function(n){return filter==="all"||!n.read||fresh[n.id]});if(!shown.length){ul.innerHTML='<li style="padding:40px 16px;text-align:center;color:#6b7280;font-size:13px"><div style="font-size:30px">✅</div>'+(filter==="unread"?"No unread notifications":"You're all caught up")+'<div style="font-size:12px;margin-top:4px">Overdue invoices, bills due, low stock and expiring items will show here.</div></li>';return}ul.innerHTML=shown.map(function(n){var ic=ICON[n.type]||ICON.info;var shownLines=opened[n.id]&&n.full&&n.full.length?n.full:n.lines||[];var lines=shownLines.map(function(x){return'<div style="font-size:12px;color:#4b5563;margin-top:2px;line-height:1.35">'+esc(x)+"</div>"}).join("");return'<li class="acx-np-item'+(fresh[n.id]||!n.read?" fresh":"")+'" data-id="'+esc(n.id)+'" title="'+esc(n.time||"")+'">'+'<div class="acx-np-ic" style="background:'+ic[1]+";color:"+ic[2]+'">'+ic[0]+"</div>"+'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#111827;padding-right:16px">'+esc(n.title||n.message)+"</div>"+lines+'<div style="font-size:11px;color:#9ca3af;margin-top:4px">'+rel(n.ts)+(n.full&&n.full.length>(n.lines||[]).length?' · <span style="color:#6b7280">'+(opened[n.id]?"Show less ▴":"Show all ▾")+"</span>":"")+(n.tab?' · <span data-go="1" style="color:#2563eb">View ›</span>':"")+"</div></div>"+'<button class="acx-np-x" title="Dismiss">✕</button></li>'}).join("")}window.renderNotifications=function(){render()};window.__acxNotifChanges=changes;function markAllRead(){var l=load();l.forEach(function(n){n.read=true});save(l)}function dismiss(id){var l=load(),n=l.filter(function(x){return x.id===id})[0];if(!n)return;if(n.key){var k="__notifDismiss_"+cid(),d=jget(k,{});d[n.key]=n.sig||JSON.stringify([n.title,n.lines]);jset(k,d)}save(l.filter(function(x){return x.id!==id}));render()}function clearAll(){var l=load(),k="__notifDismiss_"+cid(),d=jget(k,{});l.forEach(function(n){if(n.key)d[n.key]=n.sig||JSON.stringify([n.title,n.lines])});jset(k,d);save([]);fresh={};render()}window.toggleNotifications=function(){var p=$("notifPopup");if(!p)return;p.classList.toggle("hidden");if(!p.classList.contains("hidden")){scan(false);changes();fresh={};load().forEach(function(n){if(!n.read)fresh[n.id]=1});markAllRead();render()}};if(typeof window.toggleNotifPopup!=="function")window.toggleNotifPopup=function(){var p=$("notifPopup");if(p)p.classList.add("hidden")};function purge(){var l=load(),k=l.filter(function(n){return!NOISE.test(String(n.title||n.message||""))});if(k.length!==l.length)save(k)}function boot(){purge();render();setTimeout(function(){scan(true)},2500);setInterval(function(){scan(true)},10*60*1e3);setTimeout(function(){changes()},3e3);setInterval(function(){if(!document.hidden){try{changes()}catch(e){}}},6e4);document.addEventListener("visibilitychange",function(){if(!document.hidden){try{changes()}catch(e){}}})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(boot,0)});else boot()})();(function(){"use strict";if(window.__acxWhatsNew)return;window.__acxWhatsNew=true;var KEY="acaciaWhatsNew",SEEN="acaciaWhatsNewSeen";var BUILT_IN=[{id:"b-notif-log",type:"Improvement",date:"2026-10-02",title:"Smarter Notifications",text:"The bell now shows what actually happened: new, paid, edited and deleted invoices, bills and more, with before → after values.",tab:""},{id:"b-merge",type:"New Module",date:"2026-10-01",title:"Merge Duplicates",text:"Merge duplicate Customers, Suppliers and Inventory items in one click. Balances, stock and linked invoices/bills are combined safely.",tab:"customersTab"},{id:"b-orgs",type:"Improvement",date:"2026-09-30",title:"Organizations Panel",text:"Switch companies from a full panel showing logo, Organization ID (copyable) and plan, with a tick on the active company.",tab:"orgProfileTab"},{id:"b-mail",type:"New App",date:"2026-09-30",title:"Mail Hub",text:"Send and manage company email in a dedicated app. Mail sent from Books lands in the Mail Hub as a draft.",link:"https://acacia-mail.vercel.app/"},{id:"b-crm",type:"New App",date:"2026-09-28",title:"CRM Hub",text:"Track leads, customers and follow-ups in the CRM app, opened straight from Books.",link:"https://acacia-crm.vercel.app/?from=books"}];var BADGE={"New Module":["#fee2e2","#b91c1c"],"New App":["#dbeafe","#1d4ed8"],Improvement:["#dcfce7","#15803d"]};var $=function(id){return document.getElementById(id)};var esc=function(x){return String(x==null?"":x).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};var jget=function(k,d){try{var v=JSON.parse(localStorage.getItem(k)||"null");return v==null?d:v}catch(e){return d}};var jset=function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};var isAdmin=function(){var u=jget("loggedInUser",null);return!!(u&&/admin/i.test(String(u.role||"")))};var safeUrl=function(u){u=String(u||"").trim();return/^https?:\/\//i.test(u)?u:""};function items(){var custom=jget(KEY,[]);if(!Array.isArray(custom))custom=[];var all=custom.concat(BUILT_IN);all.sort(function(a,b){return String(b.date||"").localeCompare(String(a.date||""))});return all}function unseen(){var s=jget(SEEN,[]);return items().filter(function(i){return s.indexOf(i.id)<0})}function markSeen(){jset(SEEN,items().map(function(i){return i.id}));dot()}function dot(){var b=$("webinarToggle");if(!b)return;var d=b.querySelector(".acx-wn-dot"),n=unseen().length;if(n&&!d){d=document.createElement("span");d.className="acx-wn-dot";d.style.cssText="display:inline-block;min-width:16px;height:16px;line-height:16px;border-radius:9px;background:#dc2626;color:#fff;font-size:10px;text-align:center;margin-left:6px;padding:0 4px;vertical-align:middle";b.appendChild(d)}if(d){if(n)d.textContent=n;else d.remove()}}function host(){var h=$("acxWhatsNew");if(h)return h;var panel=$("webinarPanel");if(!panel)return null;var old=null;panel.querySelectorAll("div").forEach(function(d){if(!old&&/Interactive Q&A Session Hub/.test(d.textContent)&&d.className.indexOf("border-red-100")>-1)old=d});h=document.createElement("div");h.id="acxWhatsNew";if(old)old.replaceWith(h);else{var body=panel.querySelector(".custom-scrollbar")||panel;body.insertBefore(h,body.firstChild)}h.addEventListener("click",onClick);return h}var showAll=false,adding=false;function card(i,fresh){var c=BADGE[i.type]||BADGE["Improvement"],link=safeUrl(i.link);var act=link?'<a href="'+esc(link)+'" target="_blank" rel="noopener" style="color:#2563eb;font-weight:700;font-size:13px">Open app →</a>':i.tab?'<button data-go="'+esc(i.tab)+'" style="color:#2563eb;font-weight:700;font-size:13px;background:none;border:0;cursor:pointer;padding:0">Open module →</button>':"";return'<div style="border:1px solid #e5e7eb;border-radius:14px;padding:10px 12px;margin-bottom:8px;background:'+(fresh?"#fff7ed":"#fff")+';position:relative">'+'<div style="display:flex;align-items:center;gap:8px"><span style="background:'+c[0]+";color:"+c[1]+';font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px">'+esc(i.type)+"</span>"+(fresh?'<span style="color:#dc2626;font-size:11px;font-weight:700">NEW</span>':"")+'<span style="flex:1"></span><span style="color:#9ca3af;font-size:11px">'+esc(i.date||"")+"</span>"+(i.custom&&isAdmin()?'<button data-del="'+esc(i.id)+'" title="Remove" style="color:#9ca3af;background:none;border:0;cursor:pointer;margin-left:4px">✕</button>':"")+"</div>"+'<div style="font-weight:700;font-size:14px;color:#111827;margin-top:4px">'+esc(i.title)+"</div>"+'<div style="font-size:13px;color:#4b5563;margin-top:2px;line-height:1.4">'+esc(i.text)+"</div>"+(act?'<div style="margin-top:6px">'+act+"</div>":"")+"</div>"}var seenBefore=[];function render(){var h=host();if(!h)return;var all=items(),shown=showAll?all:all.slice(0,3);var html='<div style="display:flex;align-items:center;margin-bottom:6px"><span style="font-weight:700;font-size:14px;color:#111827">📢 What’s New</span><span style="flex:1"></span>'+(isAdmin()?'<button data-add="1" style="color:#2563eb;font-size:13px;background:none;border:0;cursor:pointer">'+(adding?"Cancel":"＋ Announce")+"</button>":"")+"</div>";if(adding){var f="width:100%;border:1px solid #d1d5db;border-radius:10px;padding:5px 8px;font-size:13px;margin-bottom:6px;box-sizing:border-box";html+='<div style="border:1px dashed #9ca3af;border-radius:14px;padding:10px;margin-bottom:8px;background:#f9fafb">'+'<select id="wnType" style="'+f+'"><option>New Module</option><option>New App</option><option>Improvement</option></select>'+'<input id="wnTitle" placeholder="Name (e.g. Payroll Hub)" style="'+f+'">'+'<textarea id="wnText" rows="2" placeholder="Brief explanation of what it does" style="'+f+'"></textarea>'+'<input id="wnLink" placeholder="App link https://… (optional)" style="'+f+'">'+'<input id="wnTab" placeholder="Or module tab id e.g. quotesTab (optional)" style="'+f+'">'+'<button data-save="1" style="background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:5px 14px;font-size:13px;cursor:pointer">Publish</button></div>'}html+=shown.map(function(i){return card(i,seenBefore.indexOf(i.id)<0)}).join("");if(all.length>3)html+='<button data-more="1" style="color:#2563eb;font-size:13px;background:none;border:0;cursor:pointer">'+(showAll?"Show less":"Show all ("+all.length+")")+"</button>";h.innerHTML=html}function onClick(e){var t=e.target,b;if(b=t.closest("[data-go]")){var tab=b.getAttribute("data-go"),p=$("webinarPanel");if(p)p.classList.add("hidden");if(typeof window.showTab==="function"){try{window.showTab(tab)}catch(x){}}return}if(t.closest("[data-add]")){adding=!adding;render();return}if(t.closest("[data-more]")){showAll=!showAll;render();return}if(b=t.closest("[data-del]")){var id=b.getAttribute("data-del");if(confirm("Remove this announcement?")){jset(KEY,jget(KEY,[]).filter(function(x){return x.id!==id}));render();dot()}return}if(t.closest("[data-save]")){var title=($("wnTitle").value||"").trim(),text=($("wnText").value||"").trim();if(!title||!text)return alert("Please enter a name and a brief explanation.");var link=($("wnLink").value||"").trim(),tabId=($("wnTab").value||"").trim();if(link&&!safeUrl(link))return alert("Link must start with http:// or https://");var list=jget(KEY,[]);list.unshift({id:"c"+Date.now().toString(36),custom:true,type:$("wnType").value,title:title,text:text,link:link,tab:tabId,date:(new Date).toISOString().slice(0,10)});jset(KEY,list);adding=false;seenBefore=jget(SEEN,[]);render();dot();if(typeof window.addNotification==="function"){try{window.addNotification("🆕 "+$("wnType").value+": "+title,{force:true,type:"new",lines:[text]})}catch(x){}}}}function boot(){var orig=window.toggleWebinarPanel;if(typeof orig!=="function"||!$("webinarPanel"))return setTimeout(boot,400);if(orig.__wn)return;var wrapped=function(){var r=orig.apply(this,arguments);var p=$("webinarPanel");if(p&&!p.classList.contains("hidden")){seenBefore=jget(SEEN,[]);adding=false;render();markSeen()}return r};wrapped.__wn=true;window.toggleWebinarPanel=wrapped;dot()}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot()})();(function(){"use strict";var TABLE="app_user_avatars",SIZE=256,MAX_FILE=10*1024*1024,EVERY=6e4;var COLORS=["#1e3a8a","#047857","#b45309","#7c3aed","#be123c","#0e7490","#4d7c0f","#a21caf"];function $(id){return document.getElementById(id)}function J(k,d){try{var v=JSON.parse(localStorage.getItem(k)||"null");return v==null?d:v}catch(e){return d}}function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}function who(){var u=J("loggedInUser",null);if(!u)return null;var id=u.username||u.email||u.id;if(!id)return null;return{id:String(id),key:String(id).trim().toLowerCase(),company:String(u.companyId||""),name:String(u.username||u.fullName||u.email||id)}}function keys(u){return{img:"__userAvatar_"+u.id,at:"__userAvatarAt_"+u.id,dirty:"__userAvatarDirty_"+u.id}}function colorFor(s){var h=0;s=String(s);for(var i=0;i<s.length;i++)h=h*31+s.charCodeAt(i)>>>0;return COLORS[h%COLORS.length]}function initials(n){var w=String(n||"?").trim().split(/\s+/);return((w[0]||"?").charAt(0)+(w[1]?w[1].charAt(0):"")).toUpperCase()}function badge(u){var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="'+colorFor(u?u.key:"?")+'"/><text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fff">'+esc(initials(u?u.name:"?"))+"</text></svg>";return"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)}function show(src,u){var el=$("userAvatar");if(!el)return;var want=src||badge(u);if(el.getAttribute("src")!==want)el.src=want;el.style.objectFit="cover";el.title="Click to change your photo";el.onerror=function(){el.onerror=null;el.src=badge(u)}}var sb=null;function client(){if(sb)return sb;if(!window.supabase||!window.__SUPA_URL__||!window.__SUPA_KEY__)return null;try{sb=window.supabase.createClient(window.__SUPA_URL__,window.__SUPA_KEY__,{auth:{storageKey:"acx-avatar-sync",persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}catch(e){sb=null}return sb}function push(u,dataUrl,at){var c=client(),k=keys(u);if(!c){try{localStorage.setItem(k.dirty,"1")}catch(e){}return Promise.resolve(false)}return Promise.resolve(c.from(TABLE).upsert({company_id:u.company,user_key:u.key,avatar:dataUrl,updated_at:at},{onConflict:"company_id,user_key"})).then(function(r){if(r&&r.error)throw r.error;try{localStorage.removeItem(k.dirty)}catch(e){}return true}).catch(function(e){console.warn("[avatarSync] upload failed, will retry",e&&e.message);try{localStorage.setItem(k.dirty,"1")}catch(x){}return false})}var busy=false;function sync(force){var u=who();if(!u)return Promise.resolve();var k=keys(u),localImg=localStorage.getItem(k.img)||"",localAt=localStorage.getItem(k.at)||"";show(localImg,u);var c=client();if(!c||busy)return Promise.resolve();busy=true;return Promise.resolve(c.from(TABLE).select("avatar,updated_at").eq("company_id",u.company).eq("user_key",u.key).maybeSingle()).then(function(res){if(res&&res.error)throw res.error;var row=res&&res.data,cloudAt=row?String(row.updated_at||""):"";var cloudNewer=row&&row.avatar&&(!localImg||!localAt||new Date(cloudAt)>new Date(localAt));if(cloudNewer){try{localStorage.setItem(k.img,row.avatar);localStorage.setItem(k.at,cloudAt);localStorage.removeItem(k.dirty)}catch(e){}if(who()&&who().key===u.key)show(row.avatar,u)}else if(localImg&&(!row||localStorage.getItem(k.dirty)||new Date(localAt)>new Date(cloudAt))){var at=localAt||(new Date).toISOString();try{localStorage.setItem(k.at,at)}catch(e){}return push(u,localImg,at)}}).catch(function(e){console.warn("[avatarSync] sync failed",e&&e.message)}).then(function(){busy=false})}function shrink(file){return new Promise(function(ok,bad){var fr=new FileReader;fr.onerror=function(){bad(new Error("Could not read the file"))};fr.onload=function(){var img=new Image;img.onerror=function(){bad(new Error("That file is not a valid image"))};img.onload=function(){var s=Math.min(img.width,img.height),sx=(img.width-s)/2,sy=(img.height-s)/2;var cv=document.createElement("canvas");cv.width=cv.height=SIZE;var cx=cv.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,SIZE,SIZE);cx.drawImage(img,sx,sy,s,s,0,0,SIZE,SIZE);ok(cv.toDataURL("image/jpeg",.85))};img.src=fr.result};fr.readAsDataURL(file)})}window.previewImage=function(e){var f=e&&e.target&&e.target.files&&e.target.files[0];if(!f)return;var input=e.target,u=who();if(!u){alert("User not logged in — cannot save avatar.");input.value="";return}if(!/^image\//.test(f.type)){alert("Please choose an image file.");input.value="";return}if(f.size>MAX_FILE){alert("That image is too large. Choose one under 10 MB.");input.value="";return}shrink(f).then(function(data){var k=keys(u),at=(new Date).toISOString();try{localStorage.setItem(k.img,data);localStorage.setItem(k.at,at)}catch(x){alert("Browser storage is full — could not save the photo.");return}show(data,u);return push(u,data,at)}).catch(function(err){alert(err.message||"Could not use that image.")}).then(function(){input.value=""})};var last="";function tick(){var u=who(),id=u?u.company+"|"+u.key:"";if(id!==last){last=id;if(u)sync(true);else show("",null)}}window.acxSyncAvatar=function(){return sync(true)};function boot(){tick();setInterval(function(){if(!document.hidden)tick()},5e3);setInterval(function(){if(!document.hidden)sync()},EVERY);document.addEventListener("visibilitychange",function(){if(!document.hidden)sync()});window.addEventListener("focus",function(){sync()});window.addEventListener("online",function(){sync(true)})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot()})();(function(){"use strict";var B=document.body;function close(){document.body.classList.remove("acx-dock-open")}function build(){if(document.getElementById("acxDockToggle"))return true;var rs=document.getElementById("rightSidebar");if(!rs||!document.body)return false;var t=document.createElement("button");t.id="acxDockToggle";t.type="button";t.title="Tools";t.setAttribute("aria-label","Open tools");t.textContent="🧰";t.onclick=function(e){e.stopPropagation();document.body.classList.remove("acx-nav-open");document.body.classList.add("acx-dock-open")};document.body.appendChild(t);var x=document.createElement("button");x.id="acxDockClose";x.type="button";x.setAttribute("aria-label","Close tools");x.textContent="✕";x.onclick=function(e){e.stopPropagation();close()};rs.appendChild(x);return true}document.addEventListener("click",function(e){if(!document.body.classList.contains("acx-dock-open"))return;var t=e.target;if(t&&(t.id==="acxNavBackdrop"||t.closest&&t.closest("#rightSidebar button:not(#acxDockClose)")))close()},true);document.addEventListener("keydown",function(e){if(e.key==="Escape")close()});document.addEventListener("click",function(e){if(e.target&&e.target.closest&&e.target.closest("#acxNavToggle"))close()},true);window.addEventListener("resize",function(){if(window.innerWidth>1100)close()});var tries=0;(function wait(){if(!build()&&tries++<60)setTimeout(wait,500)})()})();
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

  /* A generated bill is hidden from Bills only while its recurring template still exists.
   * If the template is gone (deleted, or lost by a sync/restore) the bill is an orphan:
   * it must be visible in Bills so it can be deleted, otherwise it still counts in
   * supplier balances / payables / dashboard but can never be seen or removed. */
  window.__acxRbHasTemplate = function (b) {
    try {
      var id = b && b.recurringId; if (!id) return false;
      return list().some(function (r) { return r && r.id === id; });
    } catch (e) { return true; }
  };
  function orphanBills() {
    return jget("bills", []).filter(function (b) { return b && b.source === "recurring" && !window.__acxRbHasTemplate(b); });
  }
  setTimeout(function () {
    try {
      if (!localStorage.getItem("loggedInUser")) return;
      var n = orphanBills().length; if (!n) return;
      call("loadSupplierBills");
      toast(n + " hidden recurring bill(s) had no recurring template. They now show in Bills - delete them there to correct supplier balances and the dashboard.");
    } catch (e) { console.warn("[recurringBills] orphan check", e); }
  }, 4000);

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
    /* generated bills share the RBIL series, so a new template never reuses a generated bill's number */
    jget("bills", []).forEach(function (b) { var m = /^RBIL-(?:[A-Za-z]+\d*-)?(\d+)$/.exec(String((b && b.billNumber) || "")); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    try { var cn = window.acxDocNo && window.acxDocNo("recurringBills"); if (cn) return cn; } catch (e) {}
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
  function showForm(show) {
    var b = $("rbFormBox"); if (b) b.classList.toggle("hidden", !show);
    var n = $("rbNewBtn"); if (n) n.textContent = show ? "Close" : "New";
  }
  function toggleForm() {
    var b = $("rbFormBox"); if (!b) return;
    if (b.classList.contains("hidden")) { resetForm(); refreshDropdowns(); $("rbNumber").value = nextNumber(); showForm(true); }
    else resetForm();
  }
  function resetForm() {
    showForm(false);
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
    ["loadSupplierBills", "renderSuppliers", "renderAccountsPayable", "renderInventorySummary", "renderInventoryTable", "updateDashboardTotals", "loadDashboard", "renderManualJournals", "updateAccountsPayable", "renderCreditcontrolAnalysis", "renderTrialBalance", "renderGeneralLedger"].forEach(function (n) { call(n); });
  }
  function makeBill(rb, runDate) {
    var bills = jget("bills", []);
    var used = {}; bills.forEach(function (b) { used[b.billNumber] = 1; });
    /* recurring bills use their own RBIL- series so they never mix with the normal BIL- / bulk BBIL- numbers */
    var rbMax = 0; bills.forEach(function (b) { var m = /^RBIL-(?:[A-Za-z]+\d*-)?(\d+)$/.exec(String(b.billNumber || "")); if (m) rbMax = Math.max(rbMax, parseInt(m[1], 10)); });
    /* generated bills continue after the template numbers (RBIL-00001 template -> first bill RBIL-00002) */
    list().forEach(function (r) { var m = /^RBIL-(?:[A-Za-z]+\d*-)?(\d+)$/.exec(String((r && r.number) || "")); if (m) rbMax = Math.max(rbMax, parseInt(m[1], 10)); });
    var no = "RBIL-" + pad(rbMax + 1, 5);
    try { var cn2 = window.acxDocNo && window.acxDocNo("recurringBills", { extra: list().concat(bills) }); if (cn2) no = cn2; } catch (e) {}
    while (used[no]) { rbMax++; no = "RBIL-" + pad(rbMax + 1, 5); }
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
    showForm(true);
    var tab = $("recurringBillsTab"); if (tab) tab.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  /* delete generated bills completely: recycle bin, payments, supplier balance, payables/balance sheet, stock and auto journals */
  function purge(targets) {
    if (!targets.length) return 0;
    var snap = jget("bills", []), done = {};
    targets.forEach(function (t) {
      var b = snap.filter(function (x) { return x && x.billNumber === t.billNumber && x.recurringId === t.recurringId; })[0] || t, r = 0;
      try { if (!b.id) b.id = uuid(); call("moveToRecycle", b, "File", "Bills"); } catch (e) {}
      try { if (typeof window.__acxUnwindBillPayments === "function") r = window.__acxUnwindBillPayments(b) || 0; } catch (e) { console.warn("[recurringBills] unwind", e); }
      if (r) call("updateSupplierBalance", b.supplier, r);
      call("reverseBillFromLedger", b);
      done[b.billNumber] = 1;
    });
    var js = jget("manualJournals", []);
    var kept = js.filter(function (j) { return !(j && j.billNumber && done[j.billNumber] && String(j.source || "") === "Auto"); });
    if (kept.length !== js.length) jset("manualJournals", kept);
    jset("bills", jget("bills", []).filter(function (x) { return !(x && done[x.billNumber] && x.recurringId); }));
    return targets.length;
  }
  function detach(ids) {
    var all = jget("bills", []);
    all.forEach(function (b) { if (b && ids.indexOf(b.recurringId) > -1) { b.source = "recurring-removed"; delete b.recurringId; } });
    jset("bills", all);
  }
  function removeTemplates(ids) {
    var rbs = list().filter(function (r) { return ids.indexOf(r.id) > -1; }); if (!rbs.length) return;
    var mine = jget("bills", []).filter(function (b) { return b && ids.indexOf(b.recurringId) > -1; });
    if (!confirm("Delete recurring bill " + rbs.map(function (r) { return r.number; }).join(", ") + "?\n\nNo more bills will be created from it.")) return;
    var withBills = false;
    if (mine.length) withBills = confirm("It has " + mine.length + " generated bill(s).\n\nOK = delete them too (rolls back supplier balance, payables, stock, payments and journals).\nCancel = keep them as normal bills in Bills.");
    if (withBills) purge(mine); else if (mine.length) detach(ids);
    saveList(list().filter(function (r) { return ids.indexOf(r.id) < 0; }));
    if (ids.indexOf(editId) > -1) resetForm();
    if (mine.length) refreshAfterBills();
    render();
    if (mine.length) toast(withBills ? mine.length + " generated bill(s) deleted and rolled back." : mine.length + " generated bill(s) kept in Bills.");
  }
  function del(id) {
    if (!can("delete", "delete recurring bills")) return;
    removeTemplates([id]);
  }
  function bulkDelete() {
    if (!can("delete", "delete recurring bills")) return;
    var ids = checked(); if (!ids.length) return alert("Select at least one recurring bill.");
    removeTemplates(ids);
  }
  window.rbDelBill = function (idx) {
    if (!can("delete", "delete supplier bills")) return;
    var b = jget("bills", [])[idx]; if (!b) return alert("Bill not found.");
    if (!confirm("Delete bill " + b.billNumber + "?\n\nIt moves to the Recycle Bin and supplier balance, payables, stock, payments and journals are rolled back.")) return;
    purge([b]); refreshAfterBills(); render(); toast("Bill " + b.billNumber + " deleted.");
  };
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
  /* ---------- generated bills: one line each, same actions as the Bills list ---------- */
  var collapsed = {};
  var SB = 'class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800"';
  function billStatus(b) { var p = num(b.paidAmount), t = num(b.total); return b.pendingApproval ? "Pending Approval" : (t > 0 && p >= t ? "Full Paid" : p > 0 ? "Partial Paid" : "Unpaid"); }
  function billBtns(i) {
    var a = function (fn, l) { return '<button onclick="rbBillAct(\'' + fn + "'," + i + ')" ' + SB + ">" + l + "</button>"; };
    var m = function (fn, l) { return '<button onclick="rbBillAct(\'' + fn + "'," + i + ')" class="w-full text-left px-2 py-2 text-sm text-blue-900 hover:bg-blue-900 hover:text-white">' + l + "</button>"; };
    return a("editSupplierBill", "Edit") + " " + '<button onclick="rbDelBill(' + i + ')" ' + SB + ">Delete</button>" + " " + a("previewBill", "Preview") + " " + a("recordBillPayment", "Record Payment") + " " + a("pushBillToEtims", "Push to ETIMS") + " " + a("shareBill", "Share") +
      ' <div class="relative inline-block"><button onclick="rbBillMenu(' + i + ')" class="border border-blue-900 text-white bg-blue-900 font-bold px-2 py-1 rounded hover:bg-blue-800">More \u25BE</button><div id="rb-bill-menu-' + i + '" class="hidden absolute right-0 mt-1 w-40 bg-white border rounded shadow z-50 flex flex-col">' +
      m("emailBill", "Email") + m("reverseBillPayment", "Reverse Payment") + m("cloneBill", "Clone") + m("writeOffBill", "Write Off") + m("undoWriteOffBill", "Undo Write Off") + m("applyDebit", "Apply Debit") + "</div></div>";
  }
  function billsRow(r, bills) {
    /* generated bills show as their own rows right under their template, inside Recurring Bills only */
    var mine = []; bills.forEach(function (b, i) { if (b && b.recurringId === r.id) mine.push({ b: b, i: i }); });
    if (!mine.length || collapsed[r.id]) return null;
    mine.sort(function (x, y) { return String(x.b.billNumber || "").localeCompare(String(y.b.billNumber || ""), undefined, { numeric: true }); });
    var frag = document.createDocumentFragment();
    mine.forEach(function (o) {
      var b = o.b, paid = num(b.paidAmount), tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td>" + esc(b.billNumber) + "</td><td>" + esc(b.date) + "</td><td>" + esc(b.supplier) + "</td><td>Due " + esc(b.due || "-") + "</td><td>Paid " + fmt(paid) + "</td><td>" + fmt(b.total) + "</td><td>Bal " + fmt(num(b.total) - paid) + "</td><td>" + billStatus(b) + '</td><td style="white-space:nowrap">' + billBtns(o.i) + "</td>";
      frag.appendChild(tr);
    });
    return frag;
  }
  window.rbToggleBills = function (id) { collapsed[id] = !collapsed[id]; render(); };
  window.rbBillMenu = function (i) {
    var m = $("rb-bill-menu-" + i);
    document.querySelectorAll('[id^="rb-bill-menu-"]').forEach(function (x) { if (x !== m) x.classList.add("hidden"); });
    if (m) m.classList.toggle("hidden");
  };
  window.rbBillAct = function (fn, idx) {
    var f = window[fn]; if (typeof f !== "function") return alert("This action is not available.");
    document.querySelectorAll('[id^="rb-bill-menu-"]').forEach(function (x) { x.classList.add("hidden"); });
    var all = jget("bills", []), before = all.length;
    window.__acxSupplierBillsView = all;
    if ((fn === "previewBill" || fn === "editSupplierBill") && typeof showTab === "function") { try { showTab("supplierBillsTab"); } catch (e) {} }
    f(idx);
    if (fn === "cloneBill") {
      var a2 = jget("bills", []);
      if (a2.length > before) { for (var k = before; k < a2.length; k++) ["source", "recurringId", "recurringNumber", "recurringRun"].forEach(function (p) { delete a2[k][p]; }); jset("bills", a2); call("loadSupplierBills"); }
    }
    setTimeout(render, 400);
  };
  document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest('[id^="rb-bill-menu-"], [onclick^="rbBillMenu"]')) document.querySelectorAll('[id^="rb-bill-menu-"]').forEach(function (x) { x.classList.add("hidden"); }); });

  var BTN = 'class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800"';
  /* template row: same buttons as Bills. Record Payment / ETIMS / Share act on the latest open bill of the template */
  function tplBtns(r, id) {
    var q = "'" + id + "'", b = function (fn, l) { return '<button onclick="' + fn + "(" + q + ')" ' + BTN + ">" + l + "</button>"; };
    var m = function (fn, l) { return '<button onclick="' + fn + "(" + q + ')" class="w-full text-left px-2 py-2 text-sm text-blue-900 hover:bg-blue-900 hover:text-white">' + l + "</button>"; };
    return b("rbEdit", "Edit") + " " + b("rbDelete", "Delete") + " " + b("rbPreview", "Preview") + " " + b("rbTplPay", "Record Payment") + " " + b("rbTplEtims", "Push to ETIMS") + " " + b("rbTplShare", "Share") +
      ' <div class="relative inline-block"><button onclick="rbBillMenu(\'t' + id + '\')" class="border border-blue-900 text-white bg-blue-900 font-bold px-2 py-1 rounded hover:bg-blue-800">More \u25BE</button><div id="rb-bill-menu-t' + id + '" class="hidden absolute right-0 mt-1 w-40 bg-white border rounded shadow z-50 flex flex-col">' +
      m("rbGenerateNow", "Generate Now") + m("rbToggle", r.status === "Active" ? "Pause" : "Resume") + m("rbToggleBills", collapsed[r.id] ? "Show Bills" : "Hide Bills") + m("rbShowBills", "Bills Summary") + "</div></div>";
  }
  function latestOpen(id) {
    var all = jget("bills", []), best = -1;
    all.forEach(function (b, i) { if (b && b.recurringId === id) { if (best < 0 || num(b.paidAmount) < num(b.total)) best = i; } });
    return best;
  }
  function tplAct(fn) { return function (id) { var i = latestOpen(id); if (i < 0) return alert("No bills generated yet for this recurring bill."); window.rbBillAct(fn, i); }; }
  window.rbTplPay = tplAct("recordBillPayment"); window.rbTplEtims = tplAct("pushBillToEtims"); window.rbTplShare = tplAct("shareBill");
  function render() {
    var tb = $("rbTable"); if (!tb) return;
    var a = filtered(), n = a.length, pages = Math.max(1, Math.ceil(n / perPage));
    if (page > pages) page = pages; if (page < 1) page = 1;
    var s = (page - 1) * perPage, e = s + perPage;
    tb.innerHTML = "";
    var allBills = jget("bills", []);
    a.slice(s, e).forEach(function (r) {
      var id = esc(r.id), tr = document.createElement("tr"), nb = allBills.filter(function (b) { return b && b.recurringId === r.id; }).length;
      tr.innerHTML = '<td><input type="checkbox" class="rbCheck" data-id="' + id + '"></td><td>' + esc(r.number) + "</td><td>" + esc(r.date) + "</td><td>" + esc(r.supplier) + "</td><td>" + esc(r.recurrenceType === "none" ? "once" : r.recurrenceType) + "</td><td>" + esc(r.nextDate || "-") + "</td><td>" + money(r.total, r.currency) + "</td><td>" + String(nb) + "</td><td>" + esc(r.status) + "</td><td>" +
        tplBtns(r, id) + "</td>";
      tb.appendChild(tr);
      var br = billsRow(r, allBills); if (br) tb.appendChild(br);
    });
    /* generated bills are their own RBIL- entries: list everything in number order instead of nesting under the template */
    if (!sortKey) {
      var flat = Array.prototype.slice.call(tb.children).map(function (tr, i) { var m = /(\d+)\s*$/.exec(tr.cells[1] ? tr.cells[1].textContent : ""); return { tr: tr, i: i, n: m ? parseInt(m[1], 10) : 1e12 }; });
      flat.sort(function (x, y) { return x.n - y.n || x.i - y.i; });
      flat.forEach(function (o) { tb.appendChild(o.tr); });
    }
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
    var cur = rb.currency || "KES";
    var rows = (rb.items || []).map(function (it) {
      var r = String(it.taxRate == null ? "" : it.taxRate).trim().toLowerCase(), lab = "";
      if (r === "16") lab = "16%"; else if (r === "8") lab = "8%"; else if (r === "0" || r === "zero") lab = "Zero"; else if (r === "exempt") lab = "Exempt";
      var tot = num(it.subtotal) + num(it.vat);
      return '<tr><td class="p-2">' + esc(it.desc) + '</td><td class="p-2">' + esc(it.qty) + '</td><td class="p-2">' + money(it.price, cur) + '</td><td class="p-2">' + money(it.vat, cur) + (lab ? " (" + lab + ")" : "") + '</td><td class="p-2">' + money(tot, cur) + "</td></tr>";
    }).join("");
    var t = totals(rb.items || []);
    var freq = rb.recurrenceType === "custom" ? "Every " + rb.recurrenceDays + " days" : (rb.recurrenceType === "none" ? "Once" : String(rb.recurrenceType || "").charAt(0).toUpperCase() + String(rb.recurrenceType || "").slice(1));
    modal('<div class="bg-white p-6 rounded-2xl w-full relative">' +
      '<h3 class="text-sm font-bold mb-6 text-center text-slate-800">\uD83D\uDCCB Recurring Bill Preview</h3>' +
      '<div class="flex justify-end gap-3 mb-6">' +
      '<button id="rbPrintBtn" class="px-1 py-1 bg-blue-900 text-white rounded hover:bg-blue-900">Print</button>' +
      '<button id="rbCsvBtn" class="px-1 py-1 bg-blue-900 text-white rounded hover:bg-blue-900">Download</button>' +
      '<button id="rbCloseBtn" class="px-1 py-1 bg-blue-900 text-white rounded hover:bg-blue-900">Close</button></div>' +
      '<div id="rbPrintArea" class="bg-white p-6 rounded-xl border border-gray-100">' +
      '<div class="flex justify-between mb-4"><div><strong>Recurring Bill Number:</strong> <span>' + esc(rb.number) + '</span></div><div><strong>Start Date:</strong> <span>' + esc(rb.date) + "</span></div></div>" +
      '<div class="text-right mb-4"><h4 class="font-semibold">Company</h4><p>' + esc(org.name || "My Company Ltd") + "</p><p>PIN: <span>" + esc(org.pin || "P00000000") + "</span></p><p>Address: <span>" + esc(org.address || "123 Business Rd, Nairobi") + "</span></p></div>" +
      '<div class="text-left mb-4"><h4 class="font-semibold">Supplier</h4><p>' + esc(sup.name || rb.supplier) + "</p><p>PIN: <span>" + esc(sup.krapin || "") + "</span></p><p>Address: <span>" + esc(sup.address || "") + "</span></p></div>" +
      '<div class="mb-4 text-sm"><p><strong>Repeats:</strong> ' + esc(freq) + " &nbsp;|&nbsp; <strong>Next run:</strong> " + esc(rb.nextDate || "-") + (rb.endDate ? " &nbsp;|&nbsp; <strong>Ends:</strong> " + esc(rb.endDate) : "") + " &nbsp;|&nbsp; <strong>Terms:</strong> " + esc(rb.termDays || 0) + " days &nbsp;|&nbsp; <strong>Account:</strong> " + esc(rb.chartOfAccount) + " &nbsp;|&nbsp; <strong>Status:</strong> " + esc(rb.status) + " &nbsp;|&nbsp; <strong>Bills generated:</strong> " + (rb.generated || 0) + "</p></div>" +
      '<table class="w-full text-sm border mt-4"><thead class="bg-gray-100"><tr><th class="p-2">Item</th><th class="p-2">Qty</th><th class="p-2">Unit Price</th><th class="p-2">VAT</th><th class="p-2">Total</th></tr></thead><tbody id="rbPreviewItems">' + rows + "</tbody>" +
      '<tfoot class="bg-gray-100 font-semibold"><tr><td colspan="4" class="p-2 text-right">Subtotal</td><td class="p-2">' + money(t.subtotal, cur) + '</td></tr><tr><td colspan="4" class="p-2 text-right">VAT</td><td class="p-2">' + money(t.vat, cur) + '</td></tr><tr><td colspan="4" class="p-2 text-right">Grand Total (per bill)</td><td class="p-2">' + money(t.total, cur) + "</td></tr></tfoot></table></div></div>");
    $("rbCloseBtn").onclick = function () { $("rbModal").remove(); };
    $("rbPrintBtn").onclick = function () {
      var w = window.open("", "_blank"); if (!w) return;
      w.document.write("<html><head><title>" + esc(rb.number) + '</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;text-align:left}.flex{display:flex;justify-content:space-between}.text-right{text-align:right}h4{margin:0 0 4px}</style></head><body>' + $("rbPrintArea").innerHTML + "</body></html>");
      w.document.close(); w.print();
    };
    $("rbCsvBtn").onclick = function () {
      var csv = "Description,Quantity,Unit Price,VAT,Total\n";
      (rb.items || []).forEach(function (it) { csv += [String(it.desc || "").replace(/,/g, " "), it.qty, num(it.price), num(it.vat), num(it.subtotal) + num(it.vat)].join(",") + "\n"; });
      csv += ",,Subtotal," + t.subtotal + "\n,,VAT," + t.vat + "\n,,Total," + t.total + "\n";
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "RecurringBill_" + rb.number + ".csv";
      document.body.appendChild(a); a.click(); a.remove();
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
    var _lb = window.loadSupplierBills;
    if (typeof _lb === "function" && !_lb.__rb) { window.loadSupplierBills = function () { var r = _lb.apply(this, arguments); try { render(); } catch (e) {} return r; }; window.loadSupplierBills.__rb = 1; }
    setTimeout(function () { runAllDue(true); }, 3500);
    setInterval(function () { runAllDue(true); }, 30 * 60 * 1000);
    window.addEventListener("focus", function () { runAllDue(true); });
    window.addEventListener("storage", function (e) { if (e && e.key === KEY) render(); });
  }

  window.rbToggleForm = toggleForm;
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

/* ======================= recurring-invoices auto-run ======================= */
/* Recurring Invoices (Customers > Recurring Invoices) used to keep ONE invoice per template.
 * This adds the schedule: when a template's Next Run date arrives (daily / weekly / monthly /
 * yearly / custom days) a NEW invoice is created from the template automatically, the same way
 * Recurring Bills already does. Edit the template and the change applies to the next invoices.
 * Runs when the app is opened, when the tab is focused, and every 30 minutes while it stays open. */
(function () {
  "use strict";
  if (window.__acxRecurringInvoicesAuto) return;
  window.__acxRecurringInvoicesAuto = true;

  var MAX_CATCHUP = 24, running = false;
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function num(x) { var n = parseFloat(x); return isNaN(n) ? 0 : n; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return iso(new Date()); }
  function call(name) { try { if (typeof window[name] === "function") return window[name].apply(window, Array.prototype.slice.call(arguments, 1)); } catch (e) { console.warn("[recurringInvoices]", name, e); } }
  function dp() { try { return window.__getDecimalPlaces ? window.__getDecimalPlaces() : 2; } catch (e) { return 2; } }

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
  function isRecurring(rt) { return rt && rt.recurrenceType && rt.recurrenceType !== "none"; }
  function runnable(rt) {
    var s = String(rt.status || "").toLowerCase();
    return isRecurring(rt) && s !== "draft" && s !== "paused" && s !== "completed" && s !== "cancelled";
  }
  function toast(msg) {
    try {
      var d = document.createElement("div"); d.textContent = msg;
      d.style.cssText = "position:fixed;right:16px;bottom:16px;max-width:340px;background:#1e3a8a;color:#fff;padding:10px 14px;border-radius:8px;z-index:2147483000;font:13px/1.4 sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3)";
      document.body.appendChild(d); setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 7000);
    } catch (e) {}
  }

  var seq = 0;
  function makeInvoice(rt, runDate, invoices) {
    var rate = Number(rt.exchangeRate) || 1, total = Number(rt.total) || 0, vat = Number(rt.vat) || 0;
    var totalKES = Number(rt.totalKES) || total * rate;
    var short = 0;
    var items = (rt.items || []).map(function (it) {
      var c = JSON.parse(JSON.stringify(it)); delete c.stk;
      if (String(c.type || "").toLowerCase() === "product" && typeof window.findAndDeductStock === "function") {
        var ok = false; try { ok = !!window.findAndDeductStock(c.desc || "", parseFloat(c.qty) || 0, c.sku || ""); } catch (e) { ok = false; }
        c.stk = ok; if (!ok) short++;
      }
      return c;
    });
    /* generated invoices continue the recurring RINV- series (never the normal INV- series) */
    var no = typeof window.__acxNextRinv === "function" ? window.__acxNextRinv(invoices) : "RINV-" + Date.now();
    /* several invoices can be made in one run before "invoices" is saved, so the generator keeps returning the
       same next number; make sure this one is not already used in the list being built */
    var taken = {}; invoices.forEach(function (i) { if (i && i.invoiceNumber) taken[String(i.invoiceNumber)] = 1; });
    var guardNo = 0;
    while (taken[no] && guardNo++ < 100000) {
      var mm = /^(.*?)(\d+)$/.exec(no);
      no = mm ? mm[1] + String(parseInt(mm[2], 10) + 1).padStart(mm[2].length, "0") : no + "-2";
    }
    var inv = {
      id: Date.now() + (++seq), invoiceNumber: no, fromRecurring: true, source: "Recurring Invoice",
      recurringRef: rt.id, recurringRunNumber: rt.number, recurringRun: runDate,
      date: runDate, customer: rt.customerName || rt.customer, customerId: rt.customerId,
      netDays: rt.netDays || rt.recurrenceDays || "", terms: rt.terms || "", account: rt.accountCode || "",
      items: items, total: total.toFixed(dp()), vat: vat.toFixed(dp()), vatKES: vat * rate,
      currency: rt.currency || "KES", exchangeRate: rate, totalKES: totalKES,
      amountPaid: 0, paid: false, status: "Unpaid"
    };
    invoices.push(inv);
    try { if (typeof window.updateCustomerReceivables === "function") window.updateCustomerReceivables(inv.customer, totalKES); } catch (e) { console.warn("[recurringInvoices] receivables", e); }
    try { if (typeof window.postToCOA === "function") window.postToCOA(rt.accountCode, totalKES, { date: runDate, ref: no, source: "Recurring Invoice" }); } catch (e) {}
    inv.__short = short;
    return inv;
  }

  function runAllDue(manual) {
    if (running) return 0;
    if (!localStorage.getItem("loggedInUser")) return 0;
    running = true;
    var made = 0, short = 0;
    try {
      var all = jget("recurringInvoices", []); if (!Array.isArray(all)) all = [];
      var invoices = jget("invoices", []); if (!Array.isArray(invoices)) invoices = [];
      var changed = false, t = today();
      all.forEach(function (rt) {
        if (!runnable(rt)) return;
        var anchor = parseInt(String(rt.date || "").split("-")[2], 10) || undefined;
        if (!rt.nextDate) {                       /* first invoice already exists for the start date */
          var first = advance(rt.date, rt.recurrenceType, rt.recurrenceDays, anchor);
          if (first) { rt.nextDate = first; changed = true; } else return;
        }
        var nd = rt.nextDate, guard = 0;
        while (nd && nd <= t && guard < MAX_CATCHUP) {
          guard++;
          var dup = invoices.some(function (i) { return (String(i.recurringId) === String(rt.id) && i.date === nd) || (String(i.recurringRef) === String(rt.id) && i.recurringRun === nd); });
          if (!dup) {
            var inv = makeInvoice(rt, nd, invoices);
            short += inv.__short || 0; delete inv.__short;
            rt.generated = (rt.generated || 0) + 1; rt.lastGenerated = nd; rt.lastInvoice = inv.invoiceNumber;
            made++;
          }
          nd = advance(nd, rt.recurrenceType, rt.recurrenceDays, anchor);
          changed = true;
        }
        if (guard >= MAX_CATCHUP) { while (nd && nd <= t) nd = advance(nd, rt.recurrenceType, rt.recurrenceDays, anchor); }
        rt.nextDate = nd || "";
      });
      if (changed) {
        localStorage.setItem("recurringInvoices", JSON.stringify(all));
        try { if (typeof recurringInvoices !== "undefined" && Array.isArray(recurringInvoices)) { recurringInvoices.length = 0; Array.prototype.push.apply(recurringInvoices, all); } } catch (e) {}
      }
      if (made) {
        localStorage.setItem("invoices", JSON.stringify(invoices));
        try { window.invoices = invoices; } catch (e) {}
        ["renderInvoices", "renderRecurringInvoices", "renderRecurringInvoiceReport", "renderCustomers", "renderAccountsReceivable", "renderCustomerStatement", "updateDashboardTotals", "loadDashboard", "renderDebitControlPanel"].forEach(function (n) { call(n); });
      } else if (changed) { call("renderRecurringInvoices"); }
    } catch (e) { console.error("[recurringInvoices] run failed", e); }
    running = false;
    if (made) toast("Recurring Invoices: " + made + " invoice" + (made > 1 ? "s" : "") + " generated automatically." + (short ? " (" + short + " item(s) were short on stock.)" : ""));
    else if (manual) toast("Recurring Invoices: nothing is due right now.");
    return made;
  }

  window.rbiRunDue = function () { return runAllDue(true); };
  function start() {
    setTimeout(function () { runAllDue(false); }, 4000);
    setInterval(function () { runAllDue(false); }, 30 * 60 * 1000);
    window.addEventListener("focus", function () { runAllDue(false); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

/* ===== Recycle Bin restore fix (merged) ===== */
try{
/* Acacia Books: Recycle Bin restore fix.
   Problem: window.restoreItem only knew File Manager files/folders. Every other record
   (invoices, customers, bills, employees...) was sent to the bin with type "File" and
   originalFolder = its module name, so "Restore" / "Restore Selected" pushed it into the
   File Manager store instead of back into its module (and for other types just deleted it).
   This replaces restoreItem so each record goes back into its own list.
   Load AFTER app-3.js:  <script defer src="recycle-restore.js"></script> */
(function () {
  "use strict";
  if (window.__acxRestoreFix) return;
  window.__acxRestoreFix = true;

  /* originalFolder -> where the record lives.
     k = localStorage key, cache = in-memory variable that must be refreshed (if any),
     r = render functions to call, side = deleting it also changed balances/stock/ledgers */
  var MAP = {
    Invoices: { k: "invoices", cache: "invoices", r: ["renderInvoices", "renderInvoiceTable", "renderInvoiceList", "updateDashboardTotals"], side: 1 },
    BulkInvoices: { k: "bulkInvoices", r: ["renderBulkInvoices"], side: 1 },
    Quotes: { k: "quotes", r: ["renderQuotes", "renderCustomerQuotesReport"] },
    SalesReturns: { k: "salesReturns", r: ["renderSalesReturnList"], side: 1 },
    Receipts: { k: "receipts", r: ["renderReceipts"], side: 1 },
    Deliveries: { k: "deliveries", r: ["renderDeliveryTable", "renderPackages"], side: 1 },
    Customers: { k: "customers", r: ["renderCustomers"] },
    Suppliers: { k: "suppliers", r: ["renderSuppliers"] },
    Bills: { k: "bills", r: ["renderBills", "renderSuppliers", "renderAccountsPayable"], side: 1 },
    BulkBills: { k: "bulkBills", r: ["loadBulkBills", "renderSuppliers", "renderAccountsPayable"], side: 1 },
    SupplierQuotes: { k: "supplierQuotes", r: ["renderSupplierQuotes"] },
    PurchaseOrders: { k: "purchaseOrders", r: ["renderPurchaseOrders"] },
    SupplierDebitNotes: { k: "supplierDebitNotes", r: ["renderDebitNotes", "renderDebitNotesReport"] },
    DebitNotes: { k: "supplierDebitNotes", r: ["renderDebitNotes", "renderDebitNotesReport"] },
    PurchaseReturns: { k: "purchaseReturns", r: ["renderPurchaseReturns", "renderInventoryTable"], side: 1 },
    SupplierPayments: { k: "billPayments", r: ["renderSupplierPayments"], side: 1 },
    TaxPayments: { k: "taxPayments", r: ["renderTaxPayments"], side: 1 },
    OperationalCosts: { k: "operationalCosts", r: ["renderOperationalCosts"] },
    GRN: { k: "grns", r: ["renderGRNTable"] },
    GRNs: { k: "grns", r: ["renderGRNTable"] },
    ManualJournals: { k: "manualJournals", r: ["renderManualJournals"], side: 1 },
    RecurringJournals: { k: "recurringJournals", r: ["renderRecurringJournalList"] },
    CurrencyAdjustments: { k: "currencyAdjustments", r: ["renderCurrencyAdjustments"] },
    ChartOfAccounts: { k: "chartOfAccounts", r: ["renderAccounts"] },
    EquityRecords: { k: "equityRecords", r: ["renderEquity", "renderEquityStatement"] },
    CurrentAccounts: { k: "currentAccounts", cache: "currentAccounts", r: ["renderCurrentAccounts"] },
    Employees: { k: "employees", r: ["renderEmployees", "updateEmployeeDropdowns"] },
    Earnings: { k: "earnings", r: ["renderEarnings"] },
    Attendance: { k: "attendance", r: ["renderAttendanceTable"] },
    BankAccounts: { k: "bankAccounts", r: ["renderBankAccountsTable"] },
    Banks: { k: "banks", r: ["renderBalanceSheet", "renderOpeningBalances", "renderAccounts"], side: 1 },
    ManualTransactions: { k: "manualTransactions", r: ["renderManualTransactions"], side: 1 },
    Shipments: { k: "shipments", r: ["renderShipmentTable"] },
    Movements: { k: "movements", r: ["renderMovementTable", "renderStockTransfer"], side: 1 },
    BulkAdjustments: { k: "baLog", r: ["renderBALog", "renderInventoryTable"], side: 1 },
    BALog: { k: "baLog", r: ["renderBALog", "renderInventoryTable"], side: 1 },
    Users: { k: "users", r: ["renderUserTable"] },
    Plans: { k: "plans", cache: "plans", r: ["renderPlans", "renderPlansTable"] },
    PlanProgress: { k: "planProgress", cache: "progressUpdates", r: ["renderProgressTable"] },
    PlanOwnerships: { k: "planOwnerships", cache: "planOwnerships", r: ["renderOwnerships"] },
    Actuals: { k: "actuals", cache: "actuals", r: ["renderActuals", "renderComparison"] },
    RevisionHistory: { k: "revisionHistoryData", cache: "revisionHistoryData", r: ["renderRevisionHistory", "renderComparison"] },
    NonCurrentAssets: { k: "balanceSheet", sub: "nonCurrentAssets", cache: "balanceSheet", r: ["renderNonCurrentAssets", "renderBalanceSheet"], side: 1 },
    NonCurrentLiabilities: { k: "balanceSheet", sub: "nonCurrentLiabilities", cache: "balanceSheet", r: ["renderNonCurrentLiabilities", "renderNonCurrentLiabilitiesSummary", "renderLoanSchedule", "renderBalanceSheet"], side: 1 }
  };

  var origRestore = window.restoreItem;

  function rd(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function wr(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function call(n) { try { if (typeof window[n] === "function") window[n](); } catch (e) { console.warn("[recycle-restore]", n, e); } }

  function specFor(rec) {
    var f = String(rec.originalFolder || "");
    if (rec.type !== "File") return null;
    if (MAP.hasOwnProperty(f)) return MAP[f];
    if (f.indexOf("Amendments-") === 0) return { k: "amendments", r: ["renderAmendmentsTable", "renderAmendedWarehouseMovement"], side: 1 };
    if (f === "Stock") {
      var wh = (rec.data && rec.data.warehouse) || "";
      if (!wh && typeof window.__invWarehouseNames === "function") { try { wh = (window.__invWarehouseNames() || [])[0] || ""; } catch (e) {} }
      return wh ? { k: "inventory_" + wh, inv: 1, r: ["renderInventoryTable"] } : null;
    }
    if (localStorage.getItem("inventory_" + f) !== null) return { k: "inventory_" + f, inv: 1, r: ["renderInventoryTable"] };
    return null; /* real File Manager file */
  }

  function same(a, b) {
    if (a && b && a.id != null && b.id != null) return String(a.id) === String(b.id);
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  /* refresh an in-memory copy (a top-level let/var in the app) so the module doesn't overwrite the restored record later */
  function syncCache(name, key) {
    var ge = eval; /* indirect eval = global scope */
    try {
      if (ge("typeof " + name) === "undefined") return false;
      ge(name + "=JSON.parse(localStorage.getItem(" + JSON.stringify(key) + ")||" + (name === "balanceSheet" ? "'{}'" : "'[]'") + ")");
      return true;
    } catch (e) { return false; }
  }

  var batch = null, timer = null;
  function report(r) {
    if (!batch) batch = { ok: 0, side: 0, bad: [], reload: false };
    if (r.ok) { batch.ok++; if (r.side) batch.side++; if (r.reload) batch.reload = true; } else batch.bad.push(r.msg);
    clearTimeout(timer);
    timer = setTimeout(function () {
      var b = batch; batch = null;
      var m = [];
      if (b.ok) m.push(b.ok + " item" + (b.ok > 1 ? "s" : "") + " restored.");
      if (b.side) m.push("Linked balances, stock or ledger entries were not re-applied automatically; please check them.");
      if (b.reload) m.push("Refresh the page to see it in its module.");
      if (b.bad.length) m.push(b.bad[0] + (b.bad.length > 1 ? " (+" + (b.bad.length - 1) + " more)" : ""));
      toast(m.join(" "), !b.ok);
    }, 150);
  }

  function toast(msg, bad) {
    var t = document.getElementById("acxRestoreToast");
    if (!t) {
      t = document.createElement("div"); t.id = "acxRestoreToast";
      t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483000;max-width:420px;padding:10px 16px;border-radius:8px;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)";
      document.body.appendChild(t);
    }
    t.style.background = bad ? "#b91c1c" : "#1e3a8a";
    t.textContent = msg; t.style.display = "block";
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = "none"; }, 6000);
  }

  window.restoreItem = function (index) {
    var bin = rd("recycleBin", []);
    var rec = bin[index];
    if (!rec) return;

    /* File Manager files and folders: keep the original behaviour */
    if (rec.type === "Folder") return origRestore.apply(this, arguments);
    var spec = specFor(rec);
    if (!spec) {
      if (rec.type === "File" && typeof origRestore === "function") return origRestore.apply(this, arguments);
      report({ ok: false, msg: '"' + (rec.name || "Item") + '" (' + (rec.type || "unknown type") + ") can't be restored automatically, so it was left in the Recycle Bin." });
      return;
    }

    var data;
    try { data = JSON.parse(JSON.stringify(rec.data)); } catch (e) { data = rec.data; }
    if (data == null) { report({ ok: false, msg: '"' + (rec.name || "Item") + '" has no saved data to restore.' }); return; }

    try {
      var cur, arr;
      if (spec.sub) { cur = rd(spec.k, {}); if (!Array.isArray(cur[spec.sub])) cur[spec.sub] = []; arr = cur[spec.sub]; }
      else { cur = arr = rd(spec.k, []); if (!Array.isArray(arr)) { arr = cur = []; } }
      if (!arr.some(function (x) { return same(x, data); })) arr.push(data);
      wr(spec.k, cur);               /* put it back first... */
      bin.splice(index, 1);          /* ...then take it out of the bin */
      localStorage.setItem("recycleBin", JSON.stringify(bin));
    } catch (e) {
      console.error("[recycle-restore]", e);
      report({ ok: false, msg: 'Could not restore "' + (rec.name || "item") + '": ' + (e.message || e) });
      return;
    }

    var reload = false;
    if (spec.cache && !syncCache(spec.cache, spec.k)) reload = true;
    if (spec.inv) { call("__invRefreshCaches"); call("syncInventoryBalancesToCOA"); }
    (spec.r || []).forEach(call);
    call("renderRecycleBin");
    report({ ok: true, side: spec.side, reload: reload });
  };
})();

}catch(e){console.error('[recycle-restore]',e)}
;
/* acacia-funds-patch.js
 * 1. Funds > Bank List: tick boxes + "Delete selected" (bulk delete).
 * 2. Funds > Bank List: "Merge duplicates" for bank accounts that share the same name.
 * 3. Funds > Reconciliation: statements are picked from the File Manager store
 *    (or uploaded from the device, which also saves a copy to the store), and a
 *    statement can be attached to the reconciliation.
 * Load AFTER app-2.js, app-3.js and acacia-ai-recon.js.
 */
(function () {
  "use strict";
  var W = window, D = document;
  var FOLDER = "Bank Statements";
  var STATEMENT_RE = /\.(csv|txt|xlsx|xls|pdf)$/i;

  /* ---------- helpers ---------- */
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
  function fmt(n) { var dp = W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2; return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function normName(s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function isSystemBank(b) { return !b || b.system || b.name === "Undeposited Funds" || b.name === "Petty Cash"; }
  function allowed(action, label) {
    try { if (typeof W.requirePermission === "function") return !!W.requirePermission("fundsTab", action, label); } catch (e) {}
    return true;
  }
  function toast(msg, kind) {
    var t = D.createElement("div");
    t.className = "afp-toast afp-" + (kind || "ok"); t.textContent = msg;
    D.body.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 300); }, 3200);
  }
  function kes(amount, cur) { try { return typeof convertToKES === "function" ? convertToKES(amount, cur) : num(amount); } catch (e) { return num(amount); } }

  /* ---------- styles ---------- */
  (function css() {
    var s = D.createElement("style");
    s.textContent =
      ".afp-pick{display:flex;align-items:center;gap:6px;font-size:.72rem;color:#6b7280;cursor:pointer}" +
      ".afp-pick input{width:15px;height:15px;cursor:pointer}" +
      ".afp-dup{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:.64rem;font-weight:700}" +
      ".funds-bank-card.afp-selected{border-color:#1e3a8a;background:#eff6ff}" +
      ".afp-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px}" +
      ".afp-bar button{border:none;border-radius:8px;padding:6px 12px;font-size:.78rem;font-weight:600;cursor:pointer;background:#1e3a8a;color:#fff}" +
      ".afp-bar button.afp-danger{background:#b91c1c}" +
      ".afp-bar button.afp-ghost{background:#fff;color:#1e3a8a;border:1px solid #c7d2fe}" +
      ".afp-bar button[disabled]{opacity:.45;cursor:not-allowed}" +
      ".afp-bar label{font-size:.78rem;display:flex;align-items:center;gap:6px;cursor:pointer}" +
      ".afp-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:14px}" +
      ".afp-modal{background:#fff;color:#111827;border-radius:12px;max-width:620px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3)}" +
      ".afp-modal h3{margin:0;padding:14px 16px 4px;font-size:1rem;font-weight:700}" +
      ".afp-modal .afp-sub{padding:0 16px 8px;font-size:.78rem;color:#6b7280}" +
      ".afp-body{padding:4px 16px;overflow:auto;flex:1}" +
      ".afp-foot{padding:12px 16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;border-top:1px solid #e5e7eb}" +
      ".afp-btn{border:1px solid #1e3a8a;background:#1e3a8a;color:#fff;border-radius:8px;padding:7px 14px;font-size:.82rem;font-weight:600;cursor:pointer}" +
      ".afp-btn.ghost{background:#fff;color:#1e3a8a}" +
      ".afp-btn.danger{background:#b91c1c;border-color:#b91c1c}" +
      ".afp-in{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font-size:.84rem;margin:6px 0;background:#fff;color:#111827}" +
      ".afp-file{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;margin:6px 0;cursor:pointer}" +
      ".afp-file:hover{border-color:#93c5fd;background:#eff6ff}" +
      ".afp-file b{font-size:.84rem;word-break:break-all}" +
      ".afp-file small{display:block;color:#6b7280;font-size:.72rem}" +
      ".afp-grp{border:1px solid #e5e7eb;border-radius:8px;padding:9px 10px;margin:8px 0;font-size:.82rem}" +
      ".afp-grp small{display:block;color:#6b7280;margin-top:3px}" +
      ".afp-empty{padding:18px 6px;text-align:center;color:#6b7280;font-size:.84rem}" +
      ".afp-chip{display:inline-flex;align-items:center;gap:8px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:999px;padding:4px 6px 4px 12px;font-size:.78rem;max-width:100%}" +
      ".afp-chip a,.afp-chip button{background:none;border:none;color:#1e3a8a;font-weight:700;cursor:pointer;font-size:.78rem;padding:2px 4px}" +
      ".afp-attach{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}" +
      ".afp-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;padding:10px 16px;border-radius:8px;font-size:.84rem;color:#fff;background:#166534;box-shadow:0 6px 18px rgba(0,0,0,.25);transition:opacity .3s}" +
      ".afp-toast.afp-warn{background:#b45309}.afp-toast.afp-err{background:#b91c1c}" +
      "html.dark .afp-modal,[data-theme=dark] .afp-modal,[data-theme=amoled] .afp-modal,[data-theme=solar-dark] .afp-modal{background:#1f2937;color:#f3f4f6}" +
      "html.dark .afp-in,[data-theme=dark] .afp-in,[data-theme=amoled] .afp-in,[data-theme=solar-dark] .afp-in{background:#111827;color:#f3f4f6;border-color:#374151}" +
      "html.dark .afp-file,html.dark .afp-grp,[data-theme=dark] .afp-file,[data-theme=dark] .afp-grp{border-color:#374151}" +
      "html.dark .afp-foot,[data-theme=dark] .afp-foot{border-color:#374151}" +
      "html.dark .afp-btn.ghost,[data-theme=dark] .afp-btn.ghost{background:#111827;color:#93c5fd}";
    D.head.appendChild(s);
  })();

  /* ---------- modal ---------- */
  function modal(title, sub, bodyHTML, footHTML) {
    close();
    var ov = D.createElement("div"); ov.className = "afp-ov"; ov.id = "afpOverlay";
    ov.innerHTML = '<div class="afp-modal" role="dialog" aria-modal="true"><h3>' + esc(title) + "</h3>" +
      (sub ? '<div class="afp-sub">' + sub + "</div>" : "") + '<div class="afp-body">' + bodyHTML + '</div><div class="afp-foot">' + (footHTML || "") + "</div></div>";
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    D.body.appendChild(ov);
    return ov;
  }
  function close() { var o = D.getElementById("afpOverlay"); if (o) o.remove(); }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  /* =====================================================================
   * PART 1 + 2: Bank list — bulk delete and merge same-name accounts
   * ===================================================================== */
  var selected = {}; // bank name+index key -> true

  function getBanks() {
    var list = J("banks", []);
    try { if (typeof banks !== "undefined" && Array.isArray(banks)) { banks = list; } } catch (e) {}
    return list;
  }
  function commitBanks(list) {
    try { if (typeof banks !== "undefined") banks = list; } catch (e) {}
    if (typeof saveBanks === "function") { try { saveBanks(); return; } catch (e) {} }
    S("banks", list);
    ["renderBankTable", "updateBankDropdowns"].forEach(function (n) { try { if (typeof W[n] === "function") W[n](); } catch (e) {} });
  }
  function afterBankChange() {
    ["syncBankBalancesToCOA", "updateBalanceSheetFromChart", "renderBalanceSheet", "renderOpeningBalances", "renderAccounts", "updateBankSummary", "populateReconcileBankDropdown"].forEach(function (n) {
      try { if (typeof W[n] === "function") W[n](); } catch (e) {}
    });
    try { if (W.FundsRecon) W.FundsRecon.refresh(); } catch (e) {}
  }
  /* Receipts keep a bankIndex; after accounts are removed the positions shift. */
  function remapBankIndexes(oldList, newList) {
    ["receipts", "customerPayments", "billPayments", "supplierPayments"].forEach(function (key) {
      var arr = J(key, []), dirty = false;
      arr.forEach(function (r) {
        if (!r || r.bankIndex === undefined || r.bankIndex === "" || r.bankIndex === null) return;
        var old = oldList[r.bankIndex]; if (!old) return;
        var ni = newList.findIndex(function (b) { return b && normName(b.name) === normName(old.name); });
        if (ni < 0) { if (!r.bankName) r.bankName = old.name; r.bankIndex = ""; dirty = true; }
        else if (String(ni) !== String(r.bankIndex)) { r.bankIndex = ni; dirty = true; }
      });
      if (dirty) S(key, arr);
    });
  }
  function adjustCOA(chartName, deltaKES) {
    if (!chartName || !deltaKES) return;
    var coa = J("chartOfAccounts", []);
    var acc = coa.find(function (a) { return a && (a.name === chartName || a.code === chartName); });
    if (acc) { acc.amount = (acc.amount || 0) + deltaKES; S("chartOfAccounts", coa); }
  }

  function bulkDelete() {
    var list = getBanks();
    var idxs = Object.keys(selected).map(Number).filter(function (i) { return list[i] && !isSystemBank(list[i]); }).sort(function (a, b) { return b - a; });
    if (!idxs.length) return toast("Tick the accounts you want to delete first.", "warn");
    if (!allowed("delete", "delete funds accounts")) return;
    var names = idxs.slice().reverse().map(function (i) { return list[i].name; });
    if (!confirm("Delete " + idxs.length + " bank account(s)?\n\n" + names.slice(0, 12).join("\n") + (names.length > 12 ? "\n…and " + (names.length - 12) + " more" : "") + "\n\nThey will be moved to the Recycle Bin.")) return;
    var oldList = list.slice();
    idxs.forEach(function (i) {
      var b = list[i];
      adjustCOA(b.chartAccount, -kes(b.balance, b.currency));
      if (!b.id) { try { b.id = crypto.randomUUID(); } catch (e) { b.id = "bk-" + Date.now() + "-" + i; } }
      try { if (typeof moveToRecycle === "function") moveToRecycle(b, "File", "Banks"); } catch (e) {}
      list.splice(i, 1);
    });
    remapBankIndexes(oldList, list);
    selected = {};
    commitBanks(list);
    afterBankChange();
    toast(idxs.length + " bank account(s) moved to the Recycle Bin.");
  }

  function dupGroups() {
    var list = getBanks(), map = {};
    list.forEach(function (b, i) {
      if (isSystemBank(b)) return;
      var k = normName(b.name); if (!k) return;
      (map[k] = map[k] || []).push(i);
    });
    return Object.keys(map).filter(function (k) { return map[k].length > 1; }).map(function (k) { return map[k]; });
  }

  function openMerge() {
    var list = getBanks(), groups = dupGroups();
    if (!groups.length) return toast("No bank accounts share the same name.", "info");
    if (!allowed("edit", "merge funds accounts")) return;
    var body = groups.map(function (g, gi) {
      var first = list[g[0]];
      var same = g.filter(function (i) { return (list[i].currency || "") === (first.currency || ""); });
      var other = g.filter(function (i) { return same.indexOf(i) < 0; });
      var total = same.reduce(function (s, i) { return s + num(list[i].balance); }, 0);
      return '<label class="afp-grp" style="display:block;cursor:pointer"><input type="checkbox" data-afp-grp="' + gi + '" ' + (same.length > 1 ? "checked" : "disabled") + ' style="margin-right:8px">' +
        "<b>" + esc(first.name) + "</b> — " + same.length + " accounts" +
        "<small>" + same.map(function (i) { return esc((list[i].accountNumber || "no number") + " · " + (list[i].currency || "") + " " + fmt(num(list[i].balance))); }).join("<br>") + "</small>" +
        "<small>Merged balance: <b>" + esc((first.currency || "") + " " + fmt(total)) + "</b> · kept as the first account" + (first.accountNumber ? " (" + esc(first.accountNumber) + ")" : "") + "</small>" +
        (other.length ? '<small style="color:#b45309">' + other.length + " account(s) with a different currency stay separate.</small>" : "") + "</label>";
    }).join("");
    var ov = modal("Merge accounts with the same name",
      "Balances are added together, transactions stay linked (they use the account name), and the extra accounts are removed. Merged copies are kept in <b>bankMergeLog</b> in case you need to check them.",
      body, '<button class="afp-btn ghost" data-afp="close">Cancel</button><button class="afp-btn" data-afp="merge">Merge selected</button>');
    ov.addEventListener("click", function (e) {
      var a = e.target.getAttribute && e.target.getAttribute("data-afp");
      if (a === "close") close();
      if (a === "merge") {
        var chosen = Array.prototype.map.call(ov.querySelectorAll("[data-afp-grp]:checked"), function (c) { return groups[+c.getAttribute("data-afp-grp")]; });
        if (!chosen.length) return toast("Tick at least one group to merge.", "warn");
        var n = mergeGroups(chosen); close();
        toast(n + " duplicate account(s) merged.");
      }
    });
  }

  function mergeGroups(groups) {
    var list = getBanks(), oldList = list.slice(), removed = {}, count = 0, log = J("bankMergeLog", []);
    groups.forEach(function (g) {
      var p = list[g[0]]; if (!p) return;
      var dups = g.slice(1).filter(function (i) { return list[i] && (list[i].currency || "") === (p.currency || ""); });
      if (!dups.length) return;
      var extraNums = [];
      dups.forEach(function (i) {
        var d = list[i];
        var dKES = kes(d.balance, d.currency);
        if (d.chartAccount && d.chartAccount !== p.chartAccount) { adjustCOA(d.chartAccount, -dKES); adjustCOA(p.chartAccount, dKES); }
        p.balance = num(p.balance) + num(d.balance);
        if (d.accountNumber && d.accountNumber !== p.accountNumber) { if (!p.accountNumber) p.accountNumber = d.accountNumber; else extraNums.push(d.accountNumber); }
        if (!p.chartAccount && d.chartAccount) p.chartAccount = d.chartAccount;
        if (!p.link && d.link) p.link = d.link;
        log.unshift({ at: new Date().toISOString(), mergedInto: p.name, account: d });
        removed[i] = true; count++;
      });
      if (extraNums.length) p.mergedAccountNumbers = (p.mergedAccountNumbers || []).concat(extraNums);
    });
    var next = list.filter(function (_, i) { return !removed[i]; });
    remapBankIndexes(oldList, next);
    S("bankMergeLog", log.slice(0, 50));
    selected = {};
    commitBanks(next);
    afterBankChange();
    return count;
  }

  /* ---- decorate the bank list ---- */
  function cardIndex(card) {
    var btn = card.querySelector('button[onclick^="viewBank("]'); if (!btn) return -1;
    var m = /viewBank\((\d+)\)/.exec(btn.getAttribute("onclick") || ""); return m ? +m[1] : -1;
  }
  function updateBar() {
    var n = Object.keys(selected).length, del = D.getElementById("afpBulkDel"), mg = D.getElementById("afpMerge"), all = D.getElementById("afpSelAll");
    if (del) { del.disabled = !n; del.textContent = "🗑 Delete selected" + (n ? " (" + n + ")" : ""); }
    var g = dupGroups().length;
    if (mg) { mg.style.display = g ? "" : "none"; mg.textContent = "🔗 Merge duplicates (" + g + ")"; }
    if (all) {
      var boxes = D.querySelectorAll("#bankTable .afp-pick input"), vis = Array.prototype.filter.call(boxes, function (b) { return b.closest(".funds-bank-card").style.display !== "none"; });
      all.checked = vis.length > 0 && vis.every(function (b) { return b.checked; });
    }
  }
  function decorate() {
    var box = D.getElementById("bankTable"); if (!box) return;
    var list = J("banks", []), counts = {};
    list.forEach(function (b) { var k = normName(b && b.name); if (k && !isSystemBank(b)) counts[k] = (counts[k] || 0) + 1; });
    Array.prototype.forEach.call(box.querySelectorAll(".funds-bank-card"), function (card) {
      if (card.querySelector(".afp-pick")) return;
      var i = cardIndex(card), b = list[i];
      if (i < 0 || !b) return;
      var nameEl = card.querySelector(".funds-bank-card-name");
      if (counts[normName(b.name)] > 1 && nameEl && !nameEl.querySelector(".afp-dup")) nameEl.insertAdjacentHTML("beforeend", '<span class="afp-dup" title="Another account has the same name">Duplicate name</span>');
      if (isSystemBank(b)) return;
      var lab = D.createElement("label"); lab.className = "afp-pick";
      lab.innerHTML = '<input type="checkbox"> Select';
      var cb = lab.firstChild; cb.checked = !!selected[i];
      card.classList.toggle("afp-selected", cb.checked);
      cb.addEventListener("change", function () {
        if (cb.checked) selected[i] = true; else delete selected[i];
        card.classList.toggle("afp-selected", cb.checked); updateBar();
      });
      card.insertBefore(lab, card.firstChild);
    });
    ensureBar(); updateBar();
  }
  function ensureBar() {
    if (D.getElementById("afpBar")) return;
    var tools = D.querySelector("#bankListSection .funds-listtools"); if (!tools) return;
    var bar = D.createElement("div"); bar.className = "afp-bar"; bar.id = "afpBar";
    bar.innerHTML = '<label><input type="checkbox" id="afpSelAll"> Select all</label>' +
      '<button type="button" class="afp-danger" id="afpBulkDel" disabled>🗑 Delete selected</button>' +
      '<button type="button" class="afp-ghost" id="afpMerge" style="display:none">🔗 Merge duplicates</button>';
    tools.parentNode.insertBefore(bar, tools.nextSibling);
    D.getElementById("afpBulkDel").onclick = bulkDelete;
    D.getElementById("afpMerge").onclick = openMerge;
    D.getElementById("afpSelAll").onchange = function () {
      var on = this.checked;
      Array.prototype.forEach.call(D.querySelectorAll("#bankTable .funds-bank-card"), function (card) {
        var cb = card.querySelector(".afp-pick input"); if (!cb || card.style.display === "none") return;
        var i = cardIndex(card); cb.checked = on; card.classList.toggle("afp-selected", on);
        if (on) selected[i] = true; else delete selected[i];
      });
      updateBar();
    };
  }
  function hookBankList() {
    if (typeof W.renderBankTable === "function" && !W.renderBankTable.__afp) {
      var orig = W.renderBankTable;
      W.renderBankTable = function () { var r = orig.apply(this, arguments); try { selected = pruneSelection(); decorate(); } catch (e) { console.error(e); } return r; };
      W.renderBankTable.__afp = true;
    }
    if (typeof W.filterFundsBankList === "function" && !W.filterFundsBankList.__afp) {
      var f = W.filterFundsBankList;
      W.filterFundsBankList = function () { var r = f.apply(this, arguments); try { updateBar(); } catch (e) {} return r; };
      W.filterFundsBankList.__afp = true;
    }
  }
  function pruneSelection() {
    var list = J("banks", []), out = {};
    Object.keys(selected).forEach(function (i) { if (list[i] && !isSystemBank(list[i])) out[i] = true; });
    return out;
  }

  /* =====================================================================
   * PART 3: Reconciliation — pick statement from store / upload / attach
   * ===================================================================== */
  function fmStore() {
    var s = J("fileManager", null);
    if (!s || typeof s !== "object") s = { currentFolder: "Home", folders: [], files: [] };
    if (!Array.isArray(s.files)) s.files = []; if (!Array.isArray(s.folders)) s.folders = [];
    return s;
  }
  function storedStatements() {
    return fmStore().files.filter(function (f) { return f && f.content && (STATEMENT_RE.test(f.name || "") || /csv|pdf|excel|spreadsheet/i.test(f.type || "")); })
      .sort(function (a, b) { return (b.dateSort || 0) - (a.dateSort || 0); });
  }
  function dataUrlToFile(rec) {
    return fetch(rec.content).then(function (r) { return r.blob(); }).then(function (blob) {
      var type = rec.type && rec.type !== "file" ? rec.type : (/\.pdf$/i.test(rec.name) ? "application/pdf" : /\.csv$/i.test(rec.name) ? "text/csv" : blob.type);
      return new File([blob], rec.name, { type: type });
    });
  }
  function saveToStore(file) {
    return new Promise(function (ok) {
      var fr = new FileReader();
      fr.onerror = function () { ok(null); };
      fr.onload = function () {
        var st = fmStore();
        if (st.folders.indexOf(FOLDER) < 0) st.folders.push(FOLDER);
        var rec = { id: "st" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: file.name, size: (file.size / 1024).toFixed(1) + " KB", bytes: file.size, type: file.type || "file", date: new Date().toLocaleString(), dateSort: Date.now(), folder: FOLDER, tags: ["bank-statement"], content: fr.result };
        st.files.push(rec);
        if (!S("fileManager", st)) { toast("Statement used, but there was not enough storage to keep a copy in Files.", "warn"); return ok(null); }
        try { if (typeof W.renderFiles === "function") W.renderFiles(); } catch (e) {}
        ok(rec);
      };
      fr.readAsDataURL(file);
    });
  }

  /* attachment reference per bank */
  function attachKey() { return "reconStatementRef"; }
  function currentBank() { var s = D.getElementById("reconcileBank"); return s ? s.value : ""; }
  function getRef(bank) { return (J(attachKey(), {}))[bank] || null; }
  function setRef(bank, ref) { var m = J(attachKey(), {}); if (ref) m[bank] = ref; else delete m[bank]; S(attachKey(), m); renderChip(); }
  function openStored(ref) {
    var rec = fmStore().files.find(function (f) { return f.id === ref.fileId; });
    if (!rec) return toast("That statement is no longer in Files.", "warn");
    fetch(rec.content).then(function (r) { return r.blob(); }).then(function (b) {
      var url = URL.createObjectURL(b);
      if (/pdf|image/i.test(b.type)) W.open(url, "_blank");
      else { var a = D.createElement("a"); a.href = url; a.download = rec.name; a.click(); }
    });
  }
  function renderChip() {
    var host = D.getElementById("afpAttachRow"); if (!host) return;
    var bank = currentBank(), ref = bank ? getRef(bank) : null;
    host.innerHTML = '<button type="button" class="rc-btn ghost" id="afpAttachBtn">📎 ' + (ref ? "Replace statement" : "Attach statement") + "</button>" +
      (ref ? '<span class="afp-chip">📄 ' + esc(ref.name) + ' <button type="button" id="afpChipOpen">Open</button><button type="button" id="afpChipX" title="Remove">✕</button></span>'
        : '<span class="rc-sub" style="margin:0">Attach the bank statement you are reconciling against (kept in Files › ' + FOLDER + ").</span>");
    D.getElementById("afpAttachBtn").onclick = function () {
      if (!currentBank()) return toast("Choose a bank account first.", "warn");
      pickStatement(null, { attachOnly: true });
    };
    var o = D.getElementById("afpChipOpen"); if (o) o.onclick = function () { openStored(ref); };
    var x = D.getElementById("afpChipX"); if (x) x.onclick = function () { setRef(bank, null); };
  }
  function mountAttachRow() {
    if (D.getElementById("afpAttachRow")) return true;
    var setup = D.querySelector("#rcRoot .rc-setup"); if (!setup) return false;
    var row = D.createElement("div"); row.className = "afp-attach"; row.id = "afpAttachRow";
    setup.parentNode.insertBefore(row, setup.nextSibling);
    var sel = D.getElementById("reconcileBank"); if (sel) sel.addEventListener("change", renderChip);
    renderChip();
    return true;
  }

  /* The picker. onPick(file, rec) receives a File ready to parse.  */
  function pickStatement(onPick, opts) {
    opts = opts || {};
    var bank = currentBank();
    var files = storedStatements();
    var title = opts.attachOnly ? "Attach a statement" : "Choose a bank statement";
    var sub = "Pick one from your Files, or upload a new one" + (bank ? " for <b>" + esc(bank) + "</b>" : "") + ".";
    var ov = modal(title, sub,
      '<input class="afp-in" id="afpSearch" placeholder="Search your files…">' +
      '<div id="afpList"></div>',
      '<label style="margin-right:auto;font-size:.78rem;display:flex;gap:6px;align-items:center"><input type="checkbox" id="afpKeep" checked> Save uploads to Files</label>' +
      '<input type="file" id="afpDevice" accept=".csv,.txt,.xlsx,.xls,.pdf" style="display:none">' +
      '<button class="afp-btn ghost" data-afp="close">Cancel</button><button class="afp-btn" data-afp="device">⬆ Upload from device</button>');
    function draw() {
      var q = (D.getElementById("afpSearch").value || "").trim().toLowerCase();
      var rows = files.filter(function (f) { return !q || (f.name + " " + (f.folder || "") + " " + (f.tags || []).join(" ")).toLowerCase().indexOf(q) >= 0; });
      D.getElementById("afpList").innerHTML = rows.length ? rows.map(function (f) {
        return '<div class="afp-file" data-afp-file="' + esc(f.id) + '"><div><b>' + esc(f.name) + "</b><small>" + esc(f.folder || "Home") + " · " + esc(f.size || "") + " · " + esc(f.date || "") + '</small></div><span class="afp-btn" style="pointer-events:none">Use</span></div>';
      }).join("") : '<div class="afp-empty">' + (files.length ? "No files match your search." : "No statements in Files yet. Upload one from your device and it will be saved here.") + "</div>";
    }
    draw();
    D.getElementById("afpSearch").oninput = draw;
    function finish(file, rec) {
      close();
      if (rec && bank) setRef(bank, { fileId: rec.id, name: rec.name, at: Date.now() });
      if (opts.attachOnly) return toast("Statement attached.");
      if (typeof onPick === "function") onPick(file, rec);
    }
    ov.addEventListener("click", function (e) {
      var t = e.target, a = t.getAttribute && t.getAttribute("data-afp");
      if (a === "close") return close();
      if (a === "device") return D.getElementById("afpDevice").click();
      var row = t.closest && t.closest("[data-afp-file]");
      if (row) {
        var rec = files.find(function (f) { return f.id === row.getAttribute("data-afp-file"); });
        if (rec) dataUrlToFile(rec).then(function (file) { finish(file, rec); }).catch(function () { toast("Could not open that file.", "err"); });
      }
    });
    D.getElementById("afpDevice").onchange = function () {
      var f = this.files[0]; if (!f) return;
      if (!STATEMENT_RE.test(f.name)) return toast("Use a CSV, Excel or PDF statement.", "warn");
      if (D.getElementById("afpKeep").checked) saveToStore(f).then(function (rec) { finish(f, rec); });
      else finish(f, null);
    };
  }

  function hookRecon() {
    mountAttachRow();
    /* header "Import statement" -> picker -> existing importer */
    if (W.FundsRecon && !W.FundsRecon.__afp) {
      W.FundsRecon.__afp = true;
      W.FundsRecon.pickStatement = function () {
        if (!currentBank()) return toast("Choose a bank account first.", "warn");
        if (!allowed("add", "import bank statements")) return;
        pickStatement(function (file) {
          var input = D.getElementById("rcStatementFile"); if (!input) return;
          try { var dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); }
          catch (e) { toast("Could not hand the file to the importer.", "err"); }
        });
      };
      var fin = W.FundsRecon.finish;
      if (typeof fin === "function") W.FundsRecon.finish = wrapFinish(fin);
    }
    if (typeof W.reconcileBankAccount === "function" && !W.reconcileBankAccount.__afp) W.reconcileBankAccount = wrapFinish(W.reconcileBankAccount);
    /* AI panel uses the same picker */
    W.AcaciaFundsPatch.pickForAI = function (cb) { pickStatement(cb); };
  }
  function wrapFinish(fn) {
    var w = function () {
      var bank = currentBank(), ref = bank ? getRef(bank) : null, before = J("bankReconciliations", []).length;
      var r = fn.apply(this, arguments);
      try {
        var after = J("bankReconciliations", []);
        if (ref && after.length > before) {
          for (var i = before; i < after.length; i++) after[i].statementFile = { fileId: ref.fileId, name: ref.name };
          S("bankReconciliations", after); setRef(bank, null);
        }
      } catch (e) {}
      return r;
    };
    w.__afp = true; return w;
  }

  /* ---------- boot ---------- */
  W.AcaciaFundsPatch = W.AcaciaFundsPatch || {};
  W.AcaciaFundsPatch.pickStatement = pickStatement;
  W.AcaciaFundsPatch.mergeDuplicates = openMerge;
  W.AcaciaFundsPatch.bulkDeleteBanks = bulkDelete;
  W.AcaciaFundsPatch._mergeGroups = mergeGroups; W.AcaciaFundsPatch._dupGroups = dupGroups;

  function boot(tries) {
    hookBankList();
    var box = D.getElementById("bankTable");
    if (box && !box.__afpObs) {
      box.__afpObs = true;
      new MutationObserver(function () { if (!box.querySelector(".funds-bank-card .afp-pick") || !D.getElementById("afpBar")) decorate(); }).observe(box, { childList: true });
      decorate();
    }
    var reconReady = !!(W.FundsRecon && D.querySelector("#rcRoot .rc-setup"));
    if (reconReady) hookRecon();
    if ((!box || !reconReady) && tries < 40) setTimeout(function () { boot(tries + 1); }, 600);
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", function () { boot(0); }); else boot(0);
  W.addEventListener("load", function () { boot(0); });
})();


/* Funds: block bank accounts that share a name (add, draft, approve draft, rename). */
;(function () {
  "use strict";
  var W = window, D = document, editIdx = -1;
  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function J(k) { try { return JSON.parse(localStorage.getItem(k) || "[]") || []; } catch (e) { return []; } }
  function clash(name, skipIdx) {
    var n = norm(name); if (!n) return false;
    return J("banks").some(function (b, i) { return i !== skipIdx && b && norm(b.name) === n; });
  }
  function warn(name) { alert('A bank account named "' + String(name).trim() + '" already exists. Use a different name, or edit the existing account.'); }
  function wrap(fn, check) {
    var orig = W[fn]; if (typeof orig !== "function" || orig.__dupGuard) return;
    var w = function () { if (check.apply(this, arguments)) return; return orig.apply(this, arguments); };
    w.__dupGuard = true; W[fn] = w;
  }
  function install() {
    wrap("addBank", function () {
      var el = D.getElementById("bankName"), v = el ? el.value : "";
      if (clash(v)) { warn(v); return true; } return false;
    });
    wrap("saveBankAsDraft", function () {
      var el = D.getElementById("bankName"), v = el ? el.value : "";
      if (clash(v)) { warn(v); return true; }
      if (v && J("bankDrafts").some(function (d) { return d && norm(d.name) === norm(v); })) { alert('A draft named "' + v.trim() + '" already exists.'); return true; }
      return false;
    });
    wrap("approveDraft", function (i) {
      var d = J("bankDrafts")[i];
      if (d && clash(d.name)) { warn(d.name); return true; } return false;
    });
    var eb = W.editBank;
    if (typeof eb === "function" && !eb.__dupGuard) {
      var w = function (i) { editIdx = +i; return eb.apply(this, arguments); };
      w.__dupGuard = true; W.editBank = w;
    }
  }
  D.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("#saveEditBank") : null; if (!t) return;
    var el = D.getElementById("editBankName");
    if (el && clash(el.value, editIdx)) { e.stopImmediatePropagation(); e.preventDefault(); warn(el.value); }
  }, true);
  install();
  W.addEventListener("load", install);
})();

/* Bulk Bills: working Preview (own popup) and a real Edit -> Save-updates flow. */
;(function () {
  "use strict";
  var W = window, D = document;
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function el(id) { return D.getElementById(id); }
  function call(n) { try { if (typeof W[n] === "function") return W[n].apply(W, [].slice.call(arguments, 1)); } catch (e) { console.error(n, e); } }
  function perm(a, label) { try { return typeof W.requirePermission === "function" ? !!W.requirePermission("bulkBillingTab", a, label) : true; } catch (e) { return true; } }
  function dp() { return W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2; }

  /* ---- Preview: the shared bill popup lives in the hidden Supplier Bills tab ---- */
  function showPreviewOverlay() {
    var m = el("supplierBillPreviewModal"); if (!m) return;
    if (m.getClientRects().length) return; // already visible, nothing to do
    var old = el("afpBulkPrev"); if (old) old.remove();
    var ov = D.createElement("div"); ov.id = "afpBulkPrev";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:100000;overflow:auto;padding:20px;display:flex;justify-content:center;align-items:flex-start";
    var card = D.createElement("div"); card.style.cssText = "background:#fff;border-radius:14px;max-width:900px;width:100%;margin:auto";
    card.innerHTML = m.innerHTML;
    Array.prototype.forEach.call(card.querySelectorAll("[id]"), function (n) { n.removeAttribute("id"); });
    Array.prototype.forEach.call(card.querySelectorAll("[onclick]"), function (b) {
      if (/close/i.test(b.getAttribute("onclick") || "")) b.setAttribute("onclick", "document.getElementById('afpBulkPrev').remove()");
    });
    var x = D.createElement("button"); x.type = "button"; x.textContent = "✕ Close";
    x.style.cssText = "display:block;margin:12px 16px 0 auto;padding:6px 14px;border-radius:8px;background:#1e3a8a;color:#fff;border:none;font-weight:600;cursor:pointer";
    x.onclick = function () { ov.remove(); };
    card.insertBefore(x, card.firstChild);
    ov.appendChild(card);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) ov.remove(); });
    D.body.appendChild(ov);
    m.classList.add("hidden"); // keep the Supplier Bills tab popup closed
  }
  function wrapPreview() {
    var o = W.previewBulkBill; if (typeof o !== "function" || o.__afp) return;
    W.previewBulkBill = function () { var r = o.apply(this, arguments); try { showPreviewOverlay(); } catch (e) { console.error(e); } return r; };
    W.previewBulkBill.__afp = true;
  }

  /* ---- Edit ---- */
  function setBanner(on, no) {
    var h = D.querySelector("#bulkBillingTab h2.text-sm.font-bold.mb-4:not(.text-left)") || Array.prototype.filter.call(D.querySelectorAll("#bulkBillingTab h2"), function (h) { return /bulk bill/i.test(h.textContent) && h.id !== "x"; }).pop();
    var b = el("afpBulkEditBar");
    if (!on) { if (b) b.remove(); if (h && h.getAttribute("data-afp-t")) { h.textContent = h.getAttribute("data-afp-t"); h.removeAttribute("data-afp-t"); } return; }
    if (h) { if (!h.getAttribute("data-afp-t")) h.setAttribute("data-afp-t", h.textContent); h.textContent = "Edit Bulk Bill " + no; }
    if (!b && h) {
      b = D.createElement("div"); b.id = "afpBulkEditBar";
      b.style.cssText = "background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:.85rem;display:flex;gap:10px;align-items:center;flex-wrap:wrap";
      b.innerHTML = "<span>Editing <b>" + no + "</b>. Change what you need, then press Save to update this bill.</span>";
      var c = D.createElement("button"); c.type = "button"; c.textContent = "Cancel edit";
      c.style.cssText = "margin-left:auto;padding:4px 12px;border-radius:6px;border:1px solid #1e3a8a;background:#fff;color:#1e3a8a;font-weight:600;cursor:pointer";
      c.onclick = function () { resetEdit(); };
      b.appendChild(c); h.parentNode.insertBefore(b, h.nextSibling);
    }
  }
  function clearForm() {
    ["bulkBillDate", "bulkBillTermDays", "bulkBillChartOfAccount"].forEach(function (id) { var e = el(id); if (e) e.value = ""; });
    var s = el("bulkBillingSupplier"); if (s) { Array.prototype.forEach.call(s.options, function (o) { o.selected = false; }); }
    call("axRefreshMultiSelect", "bulkBillingSupplier");
    var r = el("bulkBillCurrencyRate"); if (r) r.value = "1";
  }
  function resetEdit() {
    try { currentBulkEditingIndex = null; bulkBillItems = []; } catch (e) {}
    call("renderBulkBillItems"); clearForm(); setBanner(false);
    var n = el("bulkBillNumber"); if (n && typeof W.generateBulkBillNumber === "function") n.value = W.generateBulkBillNumber();
  }
  function editBulkBill(i) {
    if (!perm("edit", "edit bulk bills")) return;
    var b = J("bulkBills", [])[i]; if (!b) return alert("Bulk bill not found.");
    try { currentBulkEditingIndex = i; bulkBillItems = (b.items || []).map(function (x) { return Object.assign({}, x); }); } catch (e) { console.error(e); }
    call("renderBulkBillItems");
    var sups = Array.isArray(b.suppliers) ? b.suppliers : [b.supplier].filter(Boolean);
    var set = function (id, v) { var e = el(id); if (e && v != null) e.value = v; };
    set("bulkBillNumber", b.billNumber); set("bulkBillDate", b.date);
    var s = el("bulkBillingSupplier");
    if (s) Array.prototype.forEach.call(s.options, function (o) { o.selected = sups.indexOf(o.value) >= 0; });
    call("axRefreshMultiSelect", "bulkBillingSupplier");
    set("bulkBillTermDays", b.termDays); set("bulkBillChartOfAccount", b.chartOfAccount);
    set("bulkBillCurrency", b.currency); set("bulkBillCurrencyRate", b.currencyRate);
    setBanner(true, b.billNumber);
    var d = el("bulkBillDate"); if (d) { d.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  function updateBulkBill() {
    var idx = currentBulkEditingIndex;
    if (!perm("edit", "edit bulk bills")) return;
    var all = J("bulkBills", []), old = all[idx];
    if (!old) { resetEdit(); return alert("That bulk bill no longer exists."); }
    var date = el("bulkBillDate").value, sel = Array.prototype.map.call(el("bulkBillingSupplier").selectedOptions, function (o) { return o.value; });
    var chart = el("bulkBillChartOfAccount").value, term = parseInt(el("bulkBillTermDays").value) || 0;
    var cur = el("bulkBillCurrency").value, rate = parseFloat(el("bulkBillCurrencyRate").value) || 1;
    if (!date || !sel.length || !chart || !bulkBillItems.length) return alert("Fill all fields and keep at least one item.");
    if (sel.length > 1 && !confirm("A saved bill belongs to one supplier. Only " + sel[0] + " will be kept. Continue?")) return;
    try { reverseBillFromLedger(old); removeMirroredBill(old.billNumber); } catch (e) { console.error(e); }
    var sub = bulkBillItems.reduce(function (s, x) { return s + (parseFloat(x.subtotal) || 0); }, 0);
    var vat = bulkBillItems.reduce(function (s, x) { return s + (parseFloat(x.vat) || 0); }, 0);
    var nb = Object.assign({}, old, { date: date, supplier: sel[0], chartOfAccount: chart, termDays: term, items: bulkBillItems.map(function (x) { return Object.assign({}, x); }), subtotal: sub, vat: vat, total: (sub + vat) * rate, currency: cur, currencyRate: rate, paidAmount: old.paidAmount || 0, source: "bulk" });
    delete nb.suppliers;
    all[idx] = nb;
    var bills = J("bills", []); bills.push(nb);
    localStorage.setItem("bulkBills", JSON.stringify(all)); localStorage.setItem("bills", JSON.stringify(bills));
    try { applyBillToLedger(nb); } catch (e) { console.error(e); }
    resetEdit();
    ["loadBulkBills", "loadSupplierBills", "renderSuppliers", "renderAccountsPayable", "renderInventorySummary", "renderInventoryTable"].forEach(function (n) { call(n); });
    alert("Bulk bill " + nb.billNumber + " updated ✅");
  }

  D.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("#saveBulkBillBtn") : null; if (!b) return;
    var editing = false; try { editing = currentBulkEditingIndex !== null && currentBulkEditingIndex !== undefined; } catch (x) {}
    if (!editing) return;
    e.stopImmediatePropagation(); e.preventDefault(); updateBulkBill();
  }, true);

  function install() {
    wrapPreview();
    if (typeof W.editBulkBill === "function" && !W.editBulkBill.__afp) { W.editBulkBill = editBulkBill; W.editBulkBill.__afp = true; }
  }
  install(); W.addEventListener("load", install);
})();

/* Funds: reliable Edit Bank popup (editable fields, duplicate-name check, renames follow into transactions). */
;(function () {
  "use strict";
  var W = window, D = document;
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function kes(a, c) { try { return typeof convertToKES === "function" ? convertToKES(a, c) : parseFloat(a) || 0; } catch (e) { return parseFloat(a) || 0; } }
  var RENAME_KEYS = ["transactions", "manualTransactions", "transfers", "customerPayments", "billPayments", "receipts", "bankStatementLines", "bankReconciliations", "supplierPayments"];
  var RENAME_FIELDS = ["bank", "bankName", "fromBank", "toBank"];

  function renameRefs(from, to) {
    if (norm(from) === norm(to) && from === to) return;
    RENAME_KEYS.forEach(function (k) {
      var arr = J(k, null); if (!Array.isArray(arr)) return; var dirty = false;
      arr.forEach(function (r) { if (!r || typeof r !== "object") return; RENAME_FIELDS.forEach(function (f) { if (r[f] === from) { r[f] = to; dirty = true; } }); });
      if (dirty) S(k, arr);
    });
  }

  function editBank(i) {
    try { if (typeof W.requirePermission === "function" && !W.requirePermission("fundsTab", "edit", "edit funds accounts")) return; } catch (e) {}
    var list = J("banks", []), b = list[i]; if (!b) return alert("Bank not found.");
    var coa = J("chartOfAccounts", []);
    var cur = ["KES", "USD", "EUR", "GBP", "CAD", "AUD", "UGX", "TZS", "ZAR", "NGN", "INR", "AED"];
    if (b.currency && cur.indexOf(b.currency) < 0) cur.unshift(b.currency);
    var old = D.getElementById("afpEditBank"); if (old) old.remove();
    var ov = D.createElement("div"); ov.id = "afpEditBank"; ov.className = "afp-ov";
    ov.innerHTML = '<div class="afp-modal" role="dialog" aria-modal="true" style="max-width:460px"><h3>Edit bank account</h3><div class="afp-body">' +
      '<label class="afp-lbl">Bank name</label><input class="afp-in" id="afpEbName" value="' + esc(b.name) + '">' +
      '<label class="afp-lbl">Account number</label><input class="afp-in" id="afpEbAcc" value="' + esc(b.accountNumber) + '">' +
      '<label class="afp-lbl">Currency</label><select class="afp-in" id="afpEbCur">' + cur.map(function (c) { return '<option value="' + esc(c) + '"' + (c === b.currency ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>" +
      '<label class="afp-lbl">Balance</label><input class="afp-in" id="afpEbBal" type="number" step="any" value="' + esc(b.balance) + '">' +
      '<label class="afp-lbl">Chart of account</label><select class="afp-in" id="afpEbChart">' + coa.map(function (a) { var sel = a.name === b.chartAccount || a.code === b.chartAccount; return '<option value="' + esc(a.name) + '"' + (sel ? " selected" : "") + ">" + esc(a.code ? a.name + " (" + a.code + ")" : a.name) + "</option>"; }).join("") + "</select>" +
      '</div><div class="afp-foot"><button type="button" class="afp-btn ghost" id="afpEbCancel">Cancel</button><button type="button" class="afp-btn" id="afpEbSave">Save</button></div></div>';
    D.body.appendChild(ov);
    var lbl = D.createElement("style"); lbl.textContent = ".afp-lbl{display:block;font-size:.78rem;font-weight:600;margin-top:8px}"; ov.appendChild(lbl);
    var nameEl = D.getElementById("afpEbName"); nameEl.focus(); nameEl.select();
    function close() { ov.remove(); }
    D.getElementById("afpEbCancel").onclick = close;
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    D.getElementById("afpEbSave").onclick = function () {
      var name = nameEl.value.trim(), acc = D.getElementById("afpEbAcc").value.trim(), c = D.getElementById("afpEbCur").value;
      var bal = parseFloat(D.getElementById("afpEbBal").value), chart = D.getElementById("afpEbChart").value;
      if (!name || !acc || !c || isNaN(bal) || !chart) return alert("Please fill all fields.");
      var fresh = J("banks", []);
      if (fresh.some(function (x, j) { return j !== i && x && norm(x.name) === norm(name); })) return alert('A bank account named "' + name + '" already exists. Use a different name.');
      var oldName = b.name, oldKES = kes(b.balance, b.currency), oldChart = b.chartAccount;
      var target = fresh[i]; if (!target) return close();
      target.name = name; target.accountNumber = acc; target.currency = c; target.balance = bal; target.chartAccount = chart;
      var coa2 = J("chartOfAccounts", []);
      var o = coa2.find(function (a) { return a.name === oldChart || a.code === oldChart; });
      var n = coa2.find(function (a) { return a.name === chart || a.code === chart; });
      if (o) o.amount = (o.amount || 0) - oldKES;
      if (n) n.amount = (n.amount || 0) + kes(bal, c);
      S("chartOfAccounts", coa2);
      try { banks = fresh; } catch (e) {}
      renameRefs(oldName, name);
      if (typeof saveBanks === "function") { try { saveBanks(); } catch (e) { S("banks", fresh); } } else S("banks", fresh);
      ["syncBankBalancesToCOA", "renderBalanceSheet", "renderOpeningBalances", "renderAccounts", "updateBankSummary", "populateReconcileBankDropdown"].forEach(function (f) { try { if (typeof W[f] === "function") W[f](); } catch (e) {} });
      close();
    };
    ov.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); if (e.key === "Enter" && e.target.tagName === "INPUT") D.getElementById("afpEbSave").click(); });
  }
  function install() { if (typeof W.editBank === "function" && !W.editBank.__afpNew) { W.editBank = editBank; W.editBank.__afpNew = true; } }
  install(); W.addEventListener("load", install);
})();
;
/* ===================== payroll-months.js ===================== */
try{
/* payroll-months.js — Books: Earnings & Allowances per MONTH, and Gross Pay & Deductions picks up the
 * earnings of the payroll month you select.
 *
 * Load AFTER app-3.js (index.html already does this).
 *
 *  - Earnings & Allowances: new "Earnings for month" field, a Month column, a month filter and
 *    month grouping with a gross subtotal per month. One record per employee per month.
 *  - Records saved before this update have no month. They are shown as "Every month" and are still used
 *    as a fallback for any payroll month that has no record of its own. Edit one and pick a month to move it.
 *  - Gross Pay & Deductions: the payroll month now decides which month's earnings (gross + loan deductions)
 *    are used, in Save Payroll and in Bulk Add All Employees.
 *  - Also fixed on the way: Edit now loads the loan/deduction fields (they used to be zeroed on re-save),
 *    row buttons use the real record number (they were off by one once a draft existed), and
 *    Bulk Add no longer overwrites existing records with zeros.
 */
(function (w) {
  'use strict';
  var LS = w.localStorage;
  function ls(k, d) { try { var v = JSON.parse(LS.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { LS.setItem(k, JSON.stringify(v)); }
  function $(id) { return document.getElementById(id); }
  function dp() { return w.__getDecimalPlaces ? w.__getDecimalPlaces() : 2; }
  function num(v) { return parseFloat(v) || 0; }
  function kes(v) { return 'KES ' + num(v).toFixed(dp()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() { try { return w.crypto.randomUUID(); } catch (e) { return 'e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); } }
  function status(r) { return (r && r.status) || 'approved'; }

  function mLabel(m) {
    var x = /^(\d{4})-(\d{2})$/.exec(m || '');
    if (!x) return 'Every month';
    return new Date(+x[1], +x[2] - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' });
  }

  /* ---------- lookup used by payroll ---------- */
  /* exact month first, then a record with no month ("every month"). Drafts are never used. */
  function earningFor(empID, month) {
    var a = ls('earnings', []);
    if (!Array.isArray(a)) return null;
    a = a.filter(function (r) { return r && r.empID === empID && status(r) === 'approved'; });
    if (month) {
      var hit = a.filter(function (r) { return r.month === month; })[0];
      return hit || a.filter(function (r) { return !r.month; })[0] || null;
    }
    a.sort(function (x, y) { return String(y.month || '').localeCompare(String(x.month || '')); });
    return a[0] || null;
  }
  function monthsOf(empID) {
    var a = ls('earnings', []);
    return (Array.isArray(a) ? a : []).filter(function (r) { return r && r.empID === empID && status(r) === 'approved' && r.month; })
      .map(function (r) { return r.month; }).sort();
  }
  w.__earningFor = earningFor;

  /* give old records a stable id (needed for the Payroll app link and the recycle bin) */
  function ensureIds() {
    var a = ls('earnings', []);
    if (!Array.isArray(a)) return [];
    var ch = false;
    a.forEach(function (r) { if (r && !r.id) { r.id = uuid(); ch = true; } });
    if (ch) put('earnings', a);
    return a;
  }

  /* ---------- table ---------- */
  var sortKey = '', sortDir = 1;
  var SORT = { empID: 'empID', month: 'month', basic: 'basicPay', house: 'houseAllowance', transport: 'transportAllowance',
    overtime: 'overtimePay', bonus: 'bonusPay', other: 'otherBenefits', gross: 'grossPay' };

  function approvedRows() {
    var all = ls('earnings', []);
    if (!Array.isArray(all)) return [];
    return all.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return x.r && status(x.r) === 'approved'; });
  }
  function fillMonthFilter(rows) {
    var sel = $('earningsMonthFilter');
    if (!sel) return;
    var cur = sel.value, seen = {}, ms = [];
    rows.forEach(function (x) { var m = x.r.month || ''; if (!seen[m]) { seen[m] = 1; ms.push(m); } });
    ms.sort().reverse();
    var html = '<option value="">-- All Months --</option>' + ms.map(function (m) {
      return '<option value="' + esc(m) + '">' + esc(m ? mLabel(m) : 'Every month (no month set)') + '</option>';
    }).join('');
    if (sel.getAttribute('data-sig') !== html) { sel.innerHTML = html; sel.setAttribute('data-sig', html); }
    sel.value = ms.indexOf(cur) > -1 ? cur : '';
  }

  w.renderEarnings = function () {
    var tb = $('earningsTable');
    if (!tb) return;
    ensureIds();
    var all = approvedRows();
    fillMonthFilter(all);
    var f = ($('earningsMonthFilter') || {}).value || '';
    var rows = f ? all.filter(function (x) { return (x.r.month || '') === f; }) : all.slice();
    if (sortKey) {
      var k = SORT[sortKey];
      rows.sort(function (a, b) {
        var p = a.r[k], q = b.r[k], c;
        if (sortKey === 'empID' || sortKey === 'month') c = String(p || '').localeCompare(String(q || ''));
        else c = num(p) - num(q);
        return c * sortDir;
      });
    }
    tb.innerHTML = '';
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="12" class="p-3 text-center text-gray-500">No Earnings Found' + (f ? ' for ' + esc(mLabel(f)) : '') + '</td></tr>';
      return;
    }
    var groups = {}, order = [];
    rows.forEach(function (x) { var m = x.r.month || ''; if (!groups[m]) { groups[m] = []; order.push(m); } groups[m].push(x); });
    order.sort(function (a, b) { return a === '' ? 1 : b === '' ? -1 : b.localeCompare(a); });   /* newest month first, "every month" last */
    var T = { basic: 0, house: 0, transport: 0, overtime: 0, bonus: 0, other: 0, gross: 0, loans: 0 };
    var html = '';
    order.forEach(function (m) {
      var g = groups[m], gs = 0;
      g.forEach(function (x) { gs += num(x.r.grossPay); });
      html += '<tr class="bg-blue-50 font-semibold"><td colspan="12" class="p-2 text-blue-900">📅 ' + esc(m ? mLabel(m) : 'Every month (no month set)') +
        ' · ' + g.length + ' employee' + (g.length === 1 ? '' : 's') + ' · Gross ' + kes(gs) + '</td></tr>';
      g.forEach(function (x) {
        var r = x.r, i = x.i;
        T.basic += num(r.basicPay); T.house += num(r.houseAllowance); T.transport += num(r.transportAllowance);
        T.overtime += num(r.overtimePay); T.bonus += num(r.bonusPay); T.other += num(r.otherBenefits);
        T.gross += num(r.grossPay); T.loans += num(r.totalLoanDeductions);
        var tip = 'Sacco: ' + kes(r.saccoLoan) + ' | Company: ' + kes(r.companyLoan) + ' | HELB: ' + kes(r.helbLoan) + ' | Other: ' + kes(r.otherLoan);
        html += '<tr>' +
          '<td class="p-2 border"><input type="checkbox" class="earnings-select" data-index="' + i + '"></td>' +
          '<td class="p-2 border">' + esc(r.empID) + '</td>' +
          '<td class="p-2 border">' + esc(mLabel(r.month)) + '</td>' +
          '<td class="p-2 border">' + kes(r.basicPay) + '</td>' +
          '<td class="p-2 border">' + kes(r.houseAllowance) + '</td>' +
          '<td class="p-2 border">' + kes(r.transportAllowance) + '</td>' +
          '<td class="p-2 border">' + kes(r.overtimePay) + '</td>' +
          '<td class="p-2 border">' + kes(r.bonusPay) + '</td>' +
          '<td class="p-2 border">' + kes(r.otherBenefits) + '</td>' +
          '<td class="p-2 border font-bold">' + kes(r.grossPay) + '</td>' +
          '<td class="p-2 border text-orange-700" title="' + esc(tip) + '">' + kes(r.totalLoanDeductions) + '</td>' +
          '<td class="p-2 border text-center space-x-1">' +
          '<button onclick="previewEarning(' + i + ')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">Preview</button>' +
          '<button onclick="viewHistory(\'' + esc(String(r.empID).replace(/'/g, "\\'")) + '\')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">History</button>' +
          '<button onclick="editEarning(' + i + ')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">Edit</button>' +
          '<button onclick="deleteEarning(' + i + ')" class="bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800">Delete</button>' +
          '</td></tr>';
      });
    });
    html += '<tr class="bg-gray-200 text-black font-bold"><td class="p-2 border">TOTAL</td><td class="p-2 border"></td><td class="p-2 border"></td>' +
      '<td class="p-2 border">' + kes(T.basic) + '</td><td class="p-2 border">' + kes(T.house) + '</td><td class="p-2 border">' + kes(T.transport) + '</td>' +
      '<td class="p-2 border">' + kes(T.overtime) + '</td><td class="p-2 border">' + kes(T.bonus) + '</td><td class="p-2 border">' + kes(T.other) + '</td>' +
      '<td class="p-2 border text-blue-900">' + kes(T.gross) + '</td><td class="p-2 border text-orange-700">' + kes(T.loans) + '</td><td class="p-2 border"></td></tr>';
    tb.innerHTML = html;
    var tc = $('totalCount'); if (tc && $('earningsTab') && $('earningsTab').contains(tc)) tc.textContent = rows.length;
    try { if (typeof w.renderOvertimeSummary === 'function' && $('overtimeSummaryBody')) w.renderOvertimeSummary(); } catch (e) { /* optional panel */ }
  };

  w.sortEarnings = function (key) {
    if (!SORT[key]) return;
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
    w.renderEarnings();
    var dd = $('earningsDropdown'); if (dd) dd.classList.add('hidden');
  };
  w.resetEarnings = function () {
    sortKey = ''; sortDir = 1;
    var s = $('earningsSearch'); if (s) s.value = '';
    var f = $('earningsMonthFilter'); if (f) f.value = '';
    w.renderEarnings();
    var dd = $('earningsDropdown'); if (dd) dd.classList.add('hidden');
  };
  w.exportEarningsCSV = function () {
    var f = ($('earningsMonthFilter') || {}).value || '';
    var rows = approvedRows().filter(function (x) { return !f || (x.r.month || '') === f; });
    var head = ['Employee ID', 'Month', 'Basic', 'House', 'Transport', 'Overtime', 'Bonus', 'Other', 'Gross', 'Sacco Loan', 'Company Loan', 'HELB', 'Other Loan', 'Total Loan Deductions'];
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var lines = [head.map(q).join(',')];
    rows.forEach(function (x) {
      var r = x.r;
      lines.push([r.empID, r.month || '', r.basicPay, r.houseAllowance, r.transportAllowance, r.overtimePay, r.bonusPay, r.otherBenefits, r.grossPay,
        r.saccoLoan, r.companyLoan, r.helbLoan, r.otherLoan, r.totalLoanDeductions].map(function (v, n) { return n < 2 ? q(v) : q(num(v).toFixed(dp())); }).join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'earnings' + (f ? '-' + f : '') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  /* ---------- save / edit / delete ---------- */
  var FIELDS = ['basicPay', 'houseAllowance', 'transportAllowance', 'overtimePay', 'bonusPay', 'otherBenefits', 'saccoLoan', 'companyLoan', 'helbLoan', 'otherLoan'];
  function formRecord() {
    var r = { empID: $('earningsEmpID').value, month: ($('earningsMonth') || {}).value || '' };
    FIELDS.forEach(function (f) { r[f] = num($(f).value); });
    return finish(r);
  }
  function finish(r) {
    r.grossPay = num(r.basicPay) + num(r.houseAllowance) + num(r.transportAllowance) + num(r.overtimePay) + num(r.bonusPay) + num(r.otherBenefits);
    r.totalLoanDeductions = num(r.saccoLoan) + num(r.companyLoan) + num(r.helbLoan) + num(r.otherLoan);
    return r;
  }
  function clearForm() {
    FIELDS.concat(['Grosspay']).forEach(function (id) { var el = $(id); if (el) el.value = ''; });
    $('earningsEmpID').value = '';
    var ix = $('earningsEditIndex'); if (ix) ix.value = '';
    /* the month stays selected so a whole month can be entered employee after employee */
  }
  function needFields() {
    if (!$('earningsEmpID').value) { alert('⚠️ Please select an employee!'); return false; }
    if (!($('earningsMonth') || {}).value) { alert('⚠️ Please select the month these earnings are for!'); return false; }
    return true;
  }

  w.saveEarnings = function () {
    var ix = $('earningsEditIndex') ? $('earningsEditIndex').value : '';
    if (!w.requirePermission('earningsTab', ix === '' ? 'add' : 'edit', ix === '' ? 'add earnings' : 'edit earnings')) return;
    if (!needFields()) return;
    var rec = formRecord(); rec.status = 'approved';
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var dup = -1;
    list.forEach(function (r, i) { if (r && r.empID === rec.empID && r.month === rec.month && String(i) !== String(ix)) dup = i; });
    if (ix !== '') {
      if (dup > -1 && !confirm('Earnings for ' + rec.empID + ' already exist for ' + mLabel(rec.month) + '. Replace them with this record?')) return;
      var old = list[parseInt(ix, 10)];
      rec.id = (old && old.id) || uuid();
      list[parseInt(ix, 10)] = rec;
      if (dup > -1) list.splice(dup, 1);
    } else if (dup > -1) {
      rec.id = list[dup].id || uuid();
      list[dup] = rec;
    } else { rec.id = uuid(); list.push(rec); }
    put('earnings', list);
    clearForm();
    w.renderEarnings();
  };

  w.saveEarningsDraft = function () {
    if (!needFields()) return;
    var rec = formRecord(); rec.status = 'draft'; rec.id = uuid();
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var ix = $('earningsEditIndex').value;
    if (ix !== '') { var old = list[parseInt(ix, 10)]; rec.id = (old && old.id) || rec.id; list[parseInt(ix, 10)] = rec; } else list.push(rec);
    put('earnings', list);
    clearForm();
    w.renderEarnings();
    alert('📄 Saved as Draft (awaiting approval)');
  };

  w.editEarning = function (i) {
    if (!w.requirePermission('earningsTab', 'edit', 'edit earnings')) return;
    var t = (ls('earnings', []) || [])[i];
    if (!t) return;
    $('earningsEmpID').value = t.empID;
    var mo = $('earningsMonth'); if (mo) mo.value = t.month || '';
    FIELDS.forEach(function (f) { $(f).value = t[f] == null ? '' : t[f]; });
    $('Grosspay').value = num(t.grossPay).toFixed(dp());
    $('earningsEditIndex').value = i;
    try { $('earningsEmpID').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
  };

  w.bulkAddEarnings = function () {
    var m = ($('earningsMonth') || {}).value || '';
    if (!m) return alert('⚠️ Select the month in "Earnings for month" first, then click Bulk Add.');
    var emps = ls('employees', []);
    if (!emps.length) return alert('⚠️ No employees found!');
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var added = 0, skipped = 0;
    emps.forEach(function (e) {
      if (list.some(function (r) { return r && r.empID === e.id && r.month === m; })) { skipped++; return; }
      /* start from the employee's most recent earlier month (basic, allowances, loans); overtime and bonus start at 0 */
      var prev = list.filter(function (r) { return r && r.empID === e.id && status(r) === 'approved' && (!r.month || r.month < m); })
        .sort(function (a, b) { return String(b.month || '').localeCompare(String(a.month || '')); })[0];
      var rec = { id: uuid(), empID: e.id, month: m, status: 'approved', overtimePay: 0, bonusPay: 0,
        basicPay: prev && num(prev.basicPay) > 0 ? num(prev.basicPay) : num(e.salary),
        houseAllowance: prev ? num(prev.houseAllowance) : 0, transportAllowance: prev ? num(prev.transportAllowance) : 0,
        otherBenefits: prev ? num(prev.otherBenefits) : 0, saccoLoan: prev ? num(prev.saccoLoan) : 0,
        companyLoan: prev ? num(prev.companyLoan) : 0, helbLoan: prev ? num(prev.helbLoan) : 0, otherLoan: prev ? num(prev.otherLoan) : 0 };
      list.push(finish(rec)); added++;
    });
    put('earnings', list);
    w.renderEarnings();
    alert('✅ ' + mLabel(m) + ': ' + added + ' employee(s) added' + (skipped ? ', ' + skipped + ' already had earnings for this month (left unchanged).' : '.'));
  };

  w.deleteEarning = function (i) {
    if (!w.requirePermission('earningsTab', 'delete', 'delete earnings')) return;
    var list = ls('earnings', []), a = list[i];
    if (!a) return;
    var emp = (ls('employees', []).filter(function (e) { return e.id === a.empID; })[0] || {}).name || a.empID;
    if (!confirm('⚠️ Are you sure you want to delete the ' + mLabel(a.month) + ' earning for "' + emp + '"?')) return;
    if (!a.id) a.id = uuid();
    if (w.moveToRecycle) w.moveToRecycle(a, 'File', 'Earnings');
    list.splice(i, 1);
    put('earnings', list);
    w.renderEarnings();
    alert('♻️ Earning record moved to Recycle Bin.');
  };

  w.bulkDeleteEarnings = function () {
    var list = ls('earnings', []);
    var sel = document.querySelectorAll('.earnings-select:checked');
    if (!sel.length) return alert('Please select at least one record.');
    Array.prototype.map.call(sel, function (c) { return Number(c.dataset.index); }).sort(function (a, b) { return b - a; })
      .forEach(function (i) { list.splice(i, 1); });
    put('earnings', list);
    w.renderEarnings();
  };

  /* ---------- bulk edit (tick records -> Bulk Edit -> change month / amounts in one window) ---------- */
  var BE_COLS = [['month', 'Month'], ['basicPay', 'Basic'], ['houseAllowance', 'House'], ['transportAllowance', 'Transport'], ['overtimePay', 'Overtime'],
    ['bonusPay', 'Bonus'], ['otherBenefits', 'Other'], ['saccoLoan', 'Sacco Loan'], ['companyLoan', 'Company Loan'], ['helbLoan', 'HELB'], ['otherLoan', 'Other Loan']];
  var beModal = null, beRows = [];
  function beClose() { if (beModal && beModal.parentNode) beModal.parentNode.removeChild(beModal); beModal = null; beRows = []; document.removeEventListener('keydown', beKey, true); }
  function beKey(e) { if (e.key === 'Escape') beClose(); }
  function beTotals(tr) {
    var r = {};
    BE_COLS.forEach(function (c) { if (c[0] !== 'month') r[c[0]] = num(tr.querySelector('[data-f="' + c[0] + '"]').value); });
    finish(r);
    tr.querySelector('.be-gross').textContent = kes(r.grossPay);
    tr.querySelector('.be-loans').textContent = kes(r.totalLoanDeductions);
  }

  w.bulkEditEarnings = function () {
    if (!w.requirePermission('earningsTab', 'edit', 'edit earnings')) return;
    var sel = document.querySelectorAll('.earnings-select:checked');
    if (!sel.length) return alert('Please select at least one record.');
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var emps = ls('employees', []), nm = {};
    (Array.isArray(emps) ? emps : []).forEach(function (e) { if (e) nm[e.id] = e.name; });
    beClose();
    beRows = [];
    Array.prototype.map.call(sel, function (c) { return Number(c.dataset.index); }).sort(function (a, b) { return a - b; }).forEach(function (i) {
      var r = list[i]; if (r) beRows.push({ i: i, id: r.id, empID: r.empID, name: nm[r.empID] || '', month: r.month || '' });
    });
    if (!beRows.length) return alert('Selected records were not found.');

    var inp = 'border:1px solid #d1d5db;border-radius:6px;padding:4px 6px;font-size:13px;color:#111827;background:#fff;';
    var body = beRows.map(function (b, k) {
      var r = list[b.i];
      return '<tr data-k="' + k + '" style="border-top:1px solid #e5e7eb"><td style="padding:6px 8px;white-space:nowrap">' + esc(b.empID) + (b.name ? ' <span style="color:#6b7280">— ' + esc(b.name) + '</span>' : '') + '</td>' +
        BE_COLS.map(function (c) {
          if (c[0] === 'month') return '<td style="padding:6px 4px"><input type="month" data-f="month" value="' + esc(r.month || '') + '" style="' + inp + 'width:140px"></td>';
          return '<td style="padding:6px 4px"><input type="number" min="0" step="any" data-f="' + c[0] + '" value="' + esc(r[c[0]] == null ? 0 : r[c[0]]) + '" style="' + inp + 'width:95px;text-align:right"></td>';
        }).join('') +
        '<td class="be-gross" style="padding:6px 8px;text-align:right;font-weight:700;white-space:nowrap"></td><td class="be-loans" style="padding:6px 8px;text-align:right;color:#c2410c;white-space:nowrap"></td></tr>';
    }).join('');

    beModal = document.createElement('div');
    beModal.id = 'acxEarningsBulkEditModal';
    beModal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px';
    beModal.innerHTML =
      '<div style="background:#fff;color:#111827;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);width:min(1250px,100%);max-height:90vh;display:flex;flex-direction:column">' +
        '<div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center"><div>' +
          '<div style="font-weight:700;font-size:15px">Bulk Edit Earnings &amp; Allowances (' + beRows.length + ')</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:2px">Gross and loan totals are recalculated automatically. There can be only one record per employee per month.</div></div>' +
          '<button type="button" id="acxBEEClose" style="font-size:22px;line-height:1;color:#6b7280;background:none;border:0;cursor:pointer">&times;</button></div>' +
        '<div style="padding:10px 18px;border-bottom:1px solid #f3f4f6;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:13px"><span>Set for all:</span>' +
          '<select id="acxBEEField" style="' + inp + '">' + BE_COLS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') + '</select>' +
          '<input id="acxBEEVal" type="month" style="' + inp + 'width:150px">' +
          '<button type="button" id="acxBEEAll" style="padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;color:#111827;cursor:pointer">Apply to all</button></div>' +
        '<div style="overflow:auto;padding:0 12px"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase"><th style="padding:8px">Employee</th>' +
          BE_COLS.map(function (c) { return '<th style="padding:8px 4px">' + c[1] + '</th>'; }).join('') + '<th style="padding:8px;text-align:right">Gross</th><th style="padding:8px;text-align:right">Loans</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
        '<div style="padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px">' +
          '<button type="button" id="acxBEECancel" style="padding:7px 16px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-size:14px">Cancel</button>' +
          '<button type="button" id="acxBEESave" style="padding:7px 16px;border:0;border-radius:8px;background:#1e3a8a;color:#fff;cursor:pointer;font-size:14px;font-weight:600">Save Changes</button></div></div>';
    document.body.appendChild(beModal);
    document.addEventListener('keydown', beKey, true);

    beModal.querySelectorAll('tr[data-k]').forEach(function (tr) {
      beTotals(tr);
      tr.addEventListener('input', function () { beTotals(tr); });
    });
    beModal.addEventListener('mousedown', function (e) { if (e.target === beModal) beClose(); });
    $('acxBEEClose').onclick = beClose; $('acxBEECancel').onclick = beClose;
    $('acxBEEField').onchange = function () {
      var v = $('acxBEEVal'); v.type = this.value === 'month' ? 'month' : 'number'; v.value = '';
    };
    $('acxBEEAll').onclick = function () {
      var f = $('acxBEEField').value, v = $('acxBEEVal').value;
      if (v === '') return alert('Enter a value first.');
      beModal.querySelectorAll('tr[data-k]').forEach(function (tr) { tr.querySelector('[data-f="' + f + '"]').value = v; beTotals(tr); });
    };
    $('acxBEESave').onclick = beSave;
  };

  function beSave() {
    if (!beModal) return;
    var list = ls('earnings', []); if (!Array.isArray(list)) list = [];
    var bad = false, edits = [];
    beModal.querySelectorAll('tr[data-k]').forEach(function (tr) {
      var b = beRows[+tr.getAttribute('data-k')], vals = {};
      BE_COLS.forEach(function (c) {
        var el = tr.querySelector('[data-f="' + c[0] + '"]');
        el.style.borderColor = '#d1d5db';
        if (c[0] === 'month') { vals.month = el.value || ''; return; }
        var n = parseFloat(el.value);
        if (el.value !== '' && (isNaN(n) || n < 0)) { bad = true; el.style.borderColor = '#dc2626'; }
        vals[c[0]] = el.value === '' || isNaN(n) ? 0 : n;
      });
      edits.push({ b: b, vals: vals });
    });
    if (bad) return alert('⚠️ Amounts must be numbers of 0 or more. Check the highlighted fields.');

    var changed = 0, missing = 0, before = [], after = [], next = list.slice();
    edits.forEach(function (x) {
      var i = (list[x.b.i] && list[x.b.i].id === x.b.id) ? x.b.i : list.findIndex(function (r) { return r && r.id === x.b.id; });
      if (i < 0) { missing++; return; }
      var old = list[i], rec = finish(Object.assign({}, old, x.vals));
      var same = BE_COLS.every(function (c) { return c[0] === 'month' ? (old.month || '') === rec.month : num(old[c[0]]) === num(rec[c[0]]); });
      if (same) return;
      next[i] = rec; changed++;
      before.push(old.empID + ' ' + mLabel(old.month) + ': ' + num(old.grossPay).toFixed(dp()));
      after.push(rec.empID + ' ' + mLabel(rec.month) + ': ' + num(rec.grossPay).toFixed(dp()));
    });
    if (!changed) { beClose(); return alert(missing ? 'Those records no longer exist.' : 'No changes to save.'); }

    /* one record per employee per month */
    var seen = {}, clash = [];
    next.forEach(function (r) {
      if (!r || status(r) !== 'approved') return;
      var key = r.empID + '|' + (r.month || '');
      if (seen[key]) clash.push(r.empID + ' — ' + mLabel(r.month)); else seen[key] = 1;
    });
    if (clash.length) return alert('⚠️ Two records would have the same employee and month:\n\n' + clash.slice(0, 8).join('\n') + '\n\nChange the month or the employee records and try again.');

    put('earnings', next);
    beClose();
    var hc = document.querySelector('#earningsTab thead input[type="checkbox"]'); if (hc) hc.checked = false;
    w.renderEarnings();
    try { if (typeof w.logActivity === 'function') w.logActivity({ action: 'Edited', module: 'Earnings & Allowances', description: 'Bulk edited ' + changed + ' earnings record(s)', originalValue: before.join('; '), editedValue: after.join('; ') }); } catch (e) { /* optional */ }
    alert('✅ ' + changed + ' earnings record' + (changed === 1 ? '' : 's') + ' updated' + (missing ? ' (' + missing + ' no longer existed)' : '') + '.');
  }

  /* ---------- history / preview ---------- */
  w.viewHistory = function (empID) {
    var a = (ls('earnings', []) || []).filter(function (r) { return r && r.empID === empID && status(r) === 'approved'; })
      .sort(function (x, y) { return String(y.month || '').localeCompare(String(x.month || '')); });
    if (!a.length) return alert('No history found for this employee.');
    var t = 'Earnings History for ' + empID + '\n\n';
    a.forEach(function (r) { t += mLabel(r.month) + '\nGross Pay: ' + kes(r.grossPay) + '\nLoan Deductions: ' + kes(r.totalLoanDeductions) + '\n-----------------------------\n'; });
    alert(t);
  };
  w.renderEarningsHistoryTab = function (empID) {
    var box = $('earningsHistoryList'); if (!box) return;
    var a = (ls('earnings', []) || []).filter(function (r) { return r && r.empID === empID && status(r) === 'approved'; })
      .sort(function (x, y) { return String(y.month || '').localeCompare(String(x.month || '')); });
    box.innerHTML = a.length ? a.map(function (r) {
      return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;"><span>Gross Pay: ' + kes(r.grossPay) +
        '</span><span style="color:#6b7280;">' + esc(mLabel(r.month)) + '</span></div>';
    }).join('') : '<p style="color:#9ca3af;">No history recorded yet.</p>';
  };
  var _preview = w.previewEarning;
  if (typeof _preview === 'function') {
    w.previewEarning = function (i) {
      _preview.apply(this, arguments);
      try {
        var t = (ls('earnings', []) || [])[i], panel = $('earningsPreviewPanel');
        if (!t || !panel) return;
        Array.prototype.forEach.call(panel.querySelectorAll('p'), function (p) {
          if (/^Employee ID:/.test(p.textContent) && !/Month:/.test(p.textContent)) p.textContent += ' · Month: ' + mLabel(t.month);
        });
      } catch (e) { /* cosmetic only */ }
    };
  }

  /* ---------- Gross Pay & Deductions: use the payroll month's earnings ---------- */
  w.getEmployeeLoanDeductions = function (empID, month) {
    month = month || ($('payrollMonth') || {}).value || '';
    var t = earningFor(empID, month);
    if (!t) return { saccoLoan: 0, companyLoan: 0, helbLoan: 0, otherLoan: 0, total: 0 };
    var a = num(t.saccoLoan), b = num(t.companyLoan), c = num(t.helbLoan), d = num(t.otherLoan);
    return { saccoLoan: a, companyLoan: b, helbLoan: c, otherLoan: d, total: a + b + c + d };
  };

  function hintEl() { return $('payrollEarningsHint'); }
  w.autoFillGrossFromEarnings = function () {
    var emp = ($('payrollEmpID') || {}).value || '', m = ($('payrollMonth') || {}).value || '';
    var gross = $('payrollGross'), ded = $('payrollDeductions'), br = $('deductionBreakdown'), hint = hintEl();
    function clear(msg) { if (gross) gross.value = ''; if (ded) ded.value = ''; if (br) br.innerText = msg || ''; var np = $('payrollNetPayPreview'); if (np) np.innerText = ''; }
    if (hint) hint.textContent = '';
    if (!emp) return clear('');
    if (!m) return clear('Select the payroll month — the earnings recorded for that month are used.');
    var t = earningFor(emp, m);
    if (!t) {
      var ms = monthsOf(emp);
      return clear('No earnings recorded for ' + mLabel(m) + ' for this employee.' + (ms.length ? ' Recorded months: ' + ms.map(mLabel).join(', ') + '.' : '') +
        ' Add them under Earnings & Allowances (pick the month) first.');
    }
    gross.value = num(t.grossPay).toFixed(dp());
    if (typeof w.updateAutoDeductions === 'function') w.updateAutoDeductions();
    if (hint) {
      var done = (ls('payrollRecords', []) || []).some(function (r) { return r && r.empID === emp && r.month === m; });
      hint.textContent = 'Using ' + (t.month ? mLabel(t.month) : 'standing (every month)') + ' earnings — gross ' + kes(t.grossPay) +
        (num(t.totalLoanDeductions) ? ', loan deductions ' + kes(t.totalLoanDeductions) : '') + '.' +
        (done ? ' ⚠️ Payroll for this employee is already saved for ' + mLabel(m) + '.' : '');
    }
  };

  /* ---------- start-up ---------- */
  function init() {
    ensureIds();
    if ($('earningsTable')) w.renderEarnings();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
})(window);
}catch(e){console.error('[merged:payroll-months.js]',e)}

/* ===== merged: acacia-companyid.js ===== */
try{
/* ACACIA BOOKS - Company ID guard (acacia-companyid.js)
   Load AFTER app-3.js (last script in index.html).

   Why this exists
   - The Company ID (ACC-000123) is what your other apps are linked to, so it must never change.
   - The old counter ("lastCompanyId") was stored PER COMPANY, so every new company / fresh browser
     started again at ACC-000001 and a company with an empty field could be given a new ID.

   What it does
   1. Pins every company's ID in a GLOBAL key (__acxOrgIds) that company switching can't hide.
   2. Uses a GLOBAL counter (__acxOrgIdMax) = highest ID ever seen on this browser, so IDs never repeat.
   3. "Generate ID" never creates a new ID if the company already has one anywhere
      (field, orgInfo, pin, Supabase). It just puts the existing one back.
   4. Mirrors the ID to Supabase (acacia_company_status.org_code) so a cleared browser / new device
      gets the SAME ID back automatically. Needs supabase/company_org_code.sql (one time).
   5. Never silently replaces an existing ID. If this device and the server disagree you get a warning,
      and "Restore previous ID" is how you choose the right one (that choice is pushed to the server). */
(function () {
  "use strict";
  if (window.__acxCidGuard) return;
  window.__acxCidGuard = true;

  var RE = /^ACC-\d{6}$/;
  var MAP = "__acxOrgIds", MAX = "__acxOrgIdMax", FRESH = "__acxOrgIdFresh_", WARN = "__acxOrgIdWarned_";
  var ls = window.localStorage;
  var noColumnLogged = false;

  function J(k, d) { try { var v = JSON.parse(ls.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { ls.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch (e) {} }
  function real() { return (window.__companyNS && window.__companyNS.real) || ls; }
  function rawJ(k) { try { return JSON.parse(real().getItem(k) || "null"); } catch (e) { return null; } }
  function cur() { var u = J("loggedInUser", null); return u && u.companyId ? String(u.companyId) : ""; }
  function numOf(id) { return RE.test(String(id || "")) ? parseInt(String(id).slice(4), 10) : 0; }
  function fmt(n) { return "ACC-" + String(n).padStart(6, "0"); }
  function ok(id) { return RE.test(String(id || "")); }
  function toast(msg) {
    try { if (typeof window.showToast === "function") return window.showToast(msg); } catch (e) {}
    try { alert(msg); } catch (e) {}
  }

  /* ---------- supabase (same anon access the app already uses) ---------- */
  function sb() {
    var u = window.__SUPA_URL__, k = window.__SUPA_KEY__;
    if (!u || !k) return null;
    return { url: u, h: { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json" } };
  }
  function rowFor(c) { var r = window.__acxCompanyRow; return r && String(r.company_id) === String(c) ? r : null; }

  function serverId(c) {
    var r = rowFor(c);
    if (r && ok(r.org_code)) return Promise.resolve(r.org_code);
    var s = sb(); if (!s || !c || !navigator.onLine) return Promise.resolve(null);
    return fetch(s.url + "/rest/v1/acacia_company_status?select=org_code&company_id=eq." + encodeURIComponent(c), { headers: s.h })
      .then(function (x) { return x.ok ? x.json() : []; })
      .then(function (a) { var v = a && a[0] && a[0].org_code; return ok(v) ? v : null; })
      .catch(function () { return null; });
  }
  function serverMax() {
    var s = sb(); if (!s || !navigator.onLine) return Promise.resolve(0);
    return fetch(s.url + "/rest/v1/acacia_company_status?select=org_code&org_code=not.is.null&order=org_code.desc&limit=1", { headers: s.h })
      .then(function (x) { return x.ok ? x.json() : []; })
      .then(function (a) { return numOf(a && a[0] && a[0].org_code); })
      .catch(function () { return 0; });
  }

  /* ---------- where an ID can already live on this device ---------- */
  function localId(c) {
    if (!c) return null;
    var map = J(MAP, {});
    if (ok(map[c])) return map[c];
    var a = rawJ("orgInfo_" + c + "::" + c); if (a && ok(a.companyId)) return a.companyId;
    var b = rawJ("orgInfo::" + c);           if (b && ok(b.companyId)) return b.companyId;
    var cs = J("companies", []);
    if (Array.isArray(cs)) for (var i = 0; i < cs.length; i++)
      if (cs[i] && String(cs[i].companyId) === c && ok(cs[i].orgCode)) return cs[i].orgCode;
    return null;
  }
  function scanMax() {
    var m = Number(J(MAX, 0)) || 0, map = J(MAP, {}), r = real(), i, k;
    Object.keys(map).forEach(function (x) { m = Math.max(m, numOf(map[x])); });
    try {
      for (i = 0; i < r.length; i++) {
        k = r.key(i); if (!k) continue;
        if (k.indexOf("lastCompanyId") === 0) m = Math.max(m, numOf(r.getItem(k)));
        else if (k.indexOf("orgInfo") === 0) { var o = rawJ(k); if (o && o.companyId) m = Math.max(m, numOf(o.companyId)); }
        else if (k.indexOf("companyIdHistory_") === 0) { (rawJ(k) || []).forEach(function (x) { m = Math.max(m, numOf(x)); }); }
      }
    } catch (e) {}
    return m;
  }

  /* ---------- write the ID everywhere it must be ---------- */
  function pin(c, id, push) {
    if (!c || !ok(id)) return;
    var map = J(MAP, {}); map[c] = id; S(MAP, map);
    /* also stamp the ID on this company's user accounts so it syncs to Supabase with them and Support can read it */
    try {
      var us = J("users", []);
      if (Array.isArray(us)) { var uch = false; us.forEach(function (x) { if (x && String(x.companyId) === c && x.orgCode !== id) { x.orgCode = id; uch = true; } }); if (uch) { S("users", us); try { if (window.__acxPushAccounts) window.__acxPushAccounts(); } catch (e2) {} } }
    } catch (e) {}
    S(MAX, String(Math.max(Number(J(MAX, 0)) || 0, numOf(id))));
    try {
      var cs = J("companies", []);
      if (Array.isArray(cs)) { var ch = false; cs.forEach(function (x) { if (x && String(x.companyId) === c && x.orgCode !== id) { x.orgCode = id; ch = true; } }); if (ch) S("companies", cs); }
    } catch (e) {}
    if (cur() === c) {               /* scoped keys only make sense for the active company */
      ["orgInfo", "orgInfo_" + c].forEach(function (k) {
        var o = J(k, null) || {};
        if (o.companyId !== id) { o.companyId = id; S(k, o); }
      });
      var el = document.getElementById("companyId"); if (el && el.value !== id) el.value = id;
      var sm = document.getElementById("orgSummaryCompanyId"); if (sm && sm.textContent !== id) sm.textContent = id;
    }
    if (push) mirror(c, id, push === "force");
  }

  function mirror(c, id, force) {
    var s = sb(); if (!s || !navigator.onLine) return;
    var q = s.url + "/rest/v1/acacia_company_status?company_id=eq." + encodeURIComponent(c) + (force ? "" : "&org_code=is.null");
    fetch(q, { method: "PATCH", keepalive: true, headers: Object.assign({ Prefer: "return=minimal" }, s.h), body: JSON.stringify({ org_code: id }) })
      .then(function (x) {
        if (x.ok) { var r = rowFor(c); if (r && (force || !r.org_code)) r.org_code = id; return; }
        return x.text().then(function (t) {
          if (x.status === 409 || /23505|duplicate/i.test(t)) return onConflict(c, id);
          if (!noColumnLogged) { noColumnLogged = true; console.info("[companyId] not mirrored to Supabase (run supabase/company_org_code.sql once):", x.status); }
        });
      }).catch(function () {});
  }

  /* another company already owns this number on the server */
  function onConflict(c, id) {
    if (ls.getItem(FRESH + c) === "1") {          /* brand new ID nobody is linked to yet: safe to move up */
      serverMax().then(function (sm) {
        var n = Math.max(sm, scanMax()) + 1, nid = fmt(n);
        try { ls.removeItem(FRESH + c); } catch (e) {}
        pin(c, nid, "force");
        alert("Company ID " + id + " was already taken by another company, so this company was given " + nid + ".");
      });
    } else {
      toast("Company ID " + id + " is also registered to another company on the server. Contact support before linking more apps.");
    }
  }

  function bestKnown(c) { return localId(c); }

  /* ---------- 1. counter that never goes backwards or repeats ---------- */
  window.acxNextCompanyId = function () {
    var id = fmt(scanMax() + 1);
    S(MAX, String(numOf(id)));
    try { ls.setItem("lastCompanyId", id); } catch (e) {}
    return id;
  };

  /* ---------- 2. issuing at sign-up / add company: reuse before create ---------- */
  var origIssue = window.acxIssueCompanyId;
  window.acxIssueCompanyId = function (c, info) {
    c = String(c || cur());
    var have = bestKnown(c);
    if (have) { pin(c, have, true); return have; }
    var id = typeof origIssue === "function" ? origIssue.apply(this, arguments) : window.acxNextCompanyId();
    if (ok(id)) { try { ls.setItem(FRESH + c, "1"); } catch (e) {} pin(c, id, true); }
    return id;
  };

  /* ---------- 3/4. Generate + Restore are disabled: the ID made at sign-up is final ---------- */
  window.generateCompanyId = function () { alert("The Company ID " + (cur() && bestKnown(cur()) || "") + " was created with your account. It is fixed and cannot be regenerated or changed."); };
  window.restoreCompanyId = function () { alert("The Company ID is fixed when the account is created and cannot be changed."); };

  /* ---------- 5. keep field + stored copies correct on load / save / server row ---------- */
  function ensure() {
    var c = cur(); if (!c) return;
    var have = bestKnown(c);
    if (have) { pin(c, have, false); return; }
    var el = document.getElementById("companyId");
    if (el && ok(el.value)) pin(c, el.value, true);
  }
  ["loadOrgInfo", "saveOrgInfo"].forEach(function (fn) {
    var o = window[fn];
    if (typeof o === "function") window[fn] = function () { var r = o.apply(this, arguments); try { ensure(); } catch (e) {} return r; };
  });

  function onRow() {
    var c = cur(); if (!c) return;
    var r = rowFor(c), loc = bestKnown(c), srv = r && ok(r.org_code) ? r.org_code : null;
    if (srv && !loc) { pin(c, srv, false); return; }                         /* new device / cleared browser: get it back */
    if (!srv && loc) { pin(c, loc, true); return; }                          /* first time: server learns this device's ID */
    if (srv && loc && srv !== loc) { pin(c, srv, false); return; }           /* the ID saved when the account was created always wins */
  }
  window.addEventListener("acx-company-row", function () { try { onRow(); } catch (e) {} });
  document.addEventListener("DOMContentLoaded", function () { setTimeout(function () { try { ensure(); onRow(); } catch (e) {} }, 1500); });
  setTimeout(function () { try { ensure(); onRow(); } catch (e) {} }, 2500);
  /* sign-up: the company row is created a moment after the ID, so push the ID again until the server has it */
  [6000, 15000, 40000].forEach(function (ms) { setTimeout(function () { try { var c = cur(), id = c && bestKnown(c); if (id) mirror(c, id, false); } catch (e) {} }, ms); });

  window.acxCompanyIdInfo = function () { var c = cur(); return { company: c, local: localId(c), server: rowFor(c) && rowFor(c).org_code || null, highest: scanMax() }; };
})();
}catch(e){console.error('[merged:acacia-companyid.js]',e)}

/* ===== merged: acacia-orgprofile.js ===== */
try{
/* ACACIA BOOKS - Organization Profile fixes (acacia-orgprofile.js)
   Load AFTER app-3.js and acacia-fixes.js (last script in index.html).

   1. Profile "empty after refresh": the form is filled once at page load. If the company data
      arrives a moment later (login, cloud sync) the form stayed blank, and a later autosave could
      even save that blank form over your real data. Now:
        - the form is refilled whenever the stored profile changes (unless you are typing),
        - a save that would replace a filled profile with a blank form is blocked
          (the Save button click is always honoured).
   2. Bank accounts added in Funds also appear under Organization Profile > Bank Account
      (Undeposited Funds / Petty Cash are system accounts and are skipped). Existing rows and
      anything you typed are kept; matching is by bank name + account number. */
(function () {
  "use strict";
  if (window.__acxOrgFix) return;
  window.__acxOrgFix = true;

  var W = window, ls = W.localStorage;
  var touched = false, lastRaw = null, explicitAt = 0;

  function J(k, d) { try { var v = JSON.parse(ls.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function cid() { var u = J("loggedInUser", null); return u && u.companyId ? String(u.companyId) : ""; }
  function orgKey() { var c = cid(); return c ? "orgInfo_" + c : null; }
  function currentRaw() { var k = orgKey(); return (k && ls.getItem(k)) || ls.getItem("orgInfo") || ""; }
  function readOrg() {
    var k = orgKey(), a = k ? J(k, null) : null, b = J("orgInfo", null);
    if (a && b) return (Date.parse(b.updatedAt || 0) || 0) > (Date.parse(a.updatedAt || 0) || 0) ? b : a;
    return a || b || null;
  }
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; }
  var CORE_FIELDS = [["orgName", "name"], ["orgPIN", "pin"], ["orgPhone", "phone"], ["orgEmail", "email"], ["orgAddress", "address"]];
  function formBlank() { return CORE_FIELDS.every(function (f) { return !val(f[0]); }); }
  function storedHasCore() { var o = readOrg(); return !!o && CORE_FIELDS.some(function (f) { return o[f[1]]; }); }

  /* ---------- Funds banks -> Organization Profile > Bank Account ---------- */
  function keyOf(n, a) { return String(n || "").trim().toLowerCase() + "|" + String(a || "").trim(); }
  function fundsBanks() {
    var a = J("banks", []);
    if (!Array.isArray(a)) return [];
    return a.filter(function (b) {
      return b && b.name && !b.system && b.name !== "Undeposited Funds" && b.name !== "Petty Cash";
    });
  }
  function rowVal(row, cls) { var e = row.querySelector("." + cls); return e ? String(e.value || "").trim() : ""; }

  function mergeBanks() {
    try {
      if (!cid()) return;
      var fb = fundsBanks(); if (!fb.length) return;

      /* a) the stored profile (only when one already exists, so we never invent a half-empty profile) */
      var org = readOrg();
      if (org) {
        var list = Array.isArray(org.banks) ? org.banks.slice() : [], have = {}, add = [];
        list.forEach(function (x) { have[keyOf(x.bankName, x.accountNumber)] = 1; });
        fb.forEach(function (b) {
          var k = keyOf(b.name, b.accountNumber); if (have[k]) return; have[k] = 1;
          add.push({ bankName: b.name, accountName: "", accountNumber: b.accountNumber || "", branch: "", swift: "" });
        });
        if (add.length) {
          org.banks = list.concat(add);
          if (!org.bankName) { org.bankName = add[0].bankName; org.bankAccountNumber = add[0].accountNumber; }
          var s = JSON.stringify(org), k2 = orgKey();
          ls.setItem("orgInfo", s); if (k2) ls.setItem(k2, s);
          lastRaw = currentRaw();       /* our own write: no need to reload the form */
        }
      }

      /* b) the form on screen: append only the missing rows, never rebuild (keeps what is being typed) */
      var cont = document.getElementById("orgBanksContainer");
      if (cont && typeof W.addOrgBankRow === "function") {
        var rows = Array.prototype.slice.call(cont.querySelectorAll(".org-bank-row")), onForm = {};
        rows.forEach(function (r) { onForm[keyOf(rowVal(r, "org-bank-name"), rowVal(r, "org-bank-accnum"))] = 1; });
        var missing = fb.filter(function (b) { return !onForm[keyOf(b.name, b.accountNumber)]; });
        if (missing.length) {
          rows.forEach(function (r) {         /* drop the empty placeholder row */
            var blank = ["org-bank-name", "org-bank-accname", "org-bank-accnum", "org-bank-branch", "org-bank-swift"].every(function (c) { return !rowVal(r, c); });
            if (blank) r.remove();
          });
          missing.forEach(function (b) {
            W.addOrgBankRow({ bankName: b.name, accountName: "", accountNumber: b.accountNumber || "", branch: "", swift: "" });
          });
        }
      }
    } catch (e) { console.warn("[orgprofile] bank merge", e); }
  }

  /* ---------- refill the form when the stored profile changes ---------- */
  function refresh(force) {
    if (typeof W.loadOrgInfo !== "function") return;
    if (touched && !force) return;
    var raw = currentRaw();
    if (!force && raw === lastRaw) { mergeBanks(); return; }
    try { W.loadOrgInfo(); } catch (e) {}          /* the wrapper below records lastRaw and merges banks */
  }

  var origLoad = W.loadOrgInfo;
  if (typeof origLoad === "function") {
    W.loadOrgInfo = function () {
      var r = origLoad.apply(this, arguments);
      touched = false; lastRaw = currentRaw();
      mergeBanks();
      return r;
    };
  }

  var origSave = W.saveOrgInfo;
  if (typeof origSave === "function") {
    W.saveOrgInfo = function () {
      var byButton = Date.now() - explicitAt < 5000;
      if (!byButton && formBlank() && storedHasCore()) {   /* would wipe a filled profile with an empty form */
        console.warn("[orgprofile] blocked saving a blank form over a filled profile; reloading it instead");
        refresh(true);
        return;
      }
      var r = origSave.apply(this, arguments);
      lastRaw = currentRaw(); touched = false;
      return r;
    };
  }

  var origRender = W.renderBankTable;
  if (typeof origRender === "function") {
    W.renderBankTable = function () {
      var r = origRender.apply(this, arguments);
      setTimeout(mergeBanks, 0);
      return r;
    };
  }
  var origTab = W.showTab;
  if (typeof origTab === "function") {
    W.showTab = function () {
      var r = origTab.apply(this, arguments);
      setTimeout(function () { refresh(false); }, 50);
      return r;
    };
  }

  /* what counts as "the user is editing" and "the user pressed Save" */
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
  function mark(e) {
    if (!e || !e.isTrusted || !e.target || !e.target.closest) return;
    if (e.target.closest("#orgProfileTab")) touched = true;
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("button");
    if (b && /saveOrgInfo/.test(b.getAttribute("onclick") || "")) explicitAt = Date.now();
  }, true);

  W.addEventListener("acx-company-row", function () { refresh(false); });
  W.addEventListener("storage", function () { refresh(false); });
  setInterval(function () { refresh(false); }, 3000);
  setTimeout(function () { refresh(false); }, 1500);
})();
}catch(e){console.error('[merged:acacia-orgprofile.js]',e)}

/* ===== merged: acacia-funds-inactive.js ===== */
try{
/* ACACIA BOOKS - Inactive bank accounts in Funds (acacia-funds-inactive.js)
   Load AFTER app-3.js (last script in index.html).

   - Every bank account card in Funds gets a "Mark inactive" / "Reactivate" button
     (Undeposited Funds and Petty Cash are system accounts and cannot be made inactive).
   - An inactive account is hidden from the Funds bank list and removed from the bank dropdowns,
     so nothing new gets posted to it. Its balance, transactions and history are kept.
   - "Show inactive" (next to the list search) shows them again, greyed out with an Inactive tag,
     in the list and in the dropdowns, so you can view history or reactivate.
   - The flag is stored on the account itself (banks[].inactive), so it syncs like the rest of Funds. */
(function () {
  "use strict";
  if (window.__acxInactiveBanks) return;
  window.__acxInactiveBanks = true;

  var W = window, ls = W.localStorage, SHOW = "__acxShowInactiveBanks";

  function J(k, d) { try { var v = JSON.parse(ls.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function getBanks() { var a = J("banks", []); return Array.isArray(a) ? a : []; }
  function showInactive() { return ls.getItem(SHOW) === "1"; }
  function isInactive(b) { return !!(b && b.inactive && !b.system && b.name !== "Undeposited Funds" && b.name !== "Petty Cash"); }

  var css = document.createElement("style");
  css.textContent =
    ".acx-inactive-hidden{display:none !important}" +
    ".funds-bank-card.acx-inactive{opacity:.62}" +
    ".acx-inactive-tag{margin-left:8px;padding:1px 8px;border-radius:999px;background:#e5e7eb;color:#374151;font-size:11px;font-weight:600}" +
    ".acx-show-inactive{display:inline-flex;align-items:center;gap:6px;font-size:12px;margin-left:10px;white-space:nowrap}";
  (document.head || document.documentElement).appendChild(css);

  /* ---------- toggle ---------- */
  function setInactive(idx, flag) {
    try { if (typeof W.requirePermission === "function" && !W.requirePermission("fundsTab", "edit", "edit funds accounts")) return; } catch (e) {}
    var arr = getBanks(), b = arr[idx];
    if (!b || b.system) return;
    if (flag && !confirm("Mark \"" + b.name + "\" as inactive?\n\nIt will be hidden from Funds and from bank dropdowns so nothing new is posted to it. Its balance and history are kept, and you can reactivate it any time.")) return;
    if (flag) b.inactive = true; else delete b.inactive;
    ls.setItem("banks", JSON.stringify(arr));
    try { if (typeof banks !== "undefined" && Array.isArray(banks)) { banks.length = 0; arr.forEach(function (x) { banks.push(x); }); } } catch (e) {}
    refreshAll();
  }
  function refreshAll() {
    try { if (typeof W.renderBankTable === "function") W.renderBankTable(); } catch (e) {}
    try { if (typeof W.updateBankDropdowns === "function") W.updateBankDropdowns(); } catch (e) {}
    strip();
  }

  /* ---------- the Funds bank list ---------- */
  function ensureShowBox() {
    var tools = document.querySelector("#bankListSection .funds-listtools");
    if (!tools || document.getElementById("acxShowInactiveBox")) return;
    var lab = document.createElement("label");
    lab.id = "acxShowInactiveBox"; lab.className = "acx-show-inactive";
    lab.innerHTML = '<input type="checkbox" id="acxShowInactive"> Show inactive';
    var cb = lab.firstChild; cb.checked = showInactive();
    cb.addEventListener("change", function () {
      try { ls.setItem(SHOW, cb.checked ? "1" : "0"); } catch (e) {}
      refreshAll();
    });
    tools.appendChild(lab);
  }

  function decorate() {
    var host = document.getElementById("bankTable"); if (!host) return;
    var all = getBanks(), show = showInactive();
    ensureShowBox();
    var cb = document.getElementById("acxShowInactive"); if (cb) cb.checked = show;
    host.querySelectorAll(".funds-bank-card").forEach(function (card) {
      if (card.getAttribute("data-acx-done")) return;
      var vb = card.querySelector('button[onclick^="viewBank("]');
      var m = vb && /viewBank\((\d+)\)/.exec(vb.getAttribute("onclick") || "");
      if (!m) return;
      var idx = parseInt(m[1], 10), b = all[idx];
      if (!b) return;
      card.setAttribute("data-acx-done", "1");
      if (b.system) return;
      var acts = card.querySelector(".funds-bank-card-actions");
      if (acts) {
        var tb = document.createElement("button");
        tb.type = "button"; tb.className = "acx-toggle-active";
        tb.textContent = isInactive(b) ? "Reactivate" : "Mark inactive";
        tb.addEventListener("click", function () { setInactive(idx, !isInactive(b)); });
        acts.insertBefore(tb, acts.querySelector("a") || null);
      }
      if (isInactive(b)) {
        card.classList.add("acx-inactive");
        var nm = card.querySelector(".funds-bank-card-name");
        if (nm) { var tag = document.createElement("span"); tag.className = "acx-inactive-tag"; tag.textContent = "Inactive"; nm.appendChild(tag); }
        if (!show) card.classList.add("acx-inactive-hidden");
      }
    });
  }

  /* ---------- bank dropdowns everywhere ---------- */
  function hiddenLabels() {
    var set = {};
    getBanks().forEach(function (b) {
      if (!isInactive(b)) return;
      var n = String(b.name || "").trim(), a = String(b.accountNumber || "").trim();
      set[n] = 1;
      if (a) { set[n + " - " + a] = 1; set[n + " (" + a + ")"] = 1; set[n + " \u00b7 " + a] = 1; }
    });
    return set;
  }
  function strip() {
    if (showInactive()) return;
    var set = hiddenLabels(); if (!Object.keys(set).length) return;
    var sels = document.querySelectorAll("select");
    for (var i = 0; i < sels.length; i++) {
      var sel = sels[i], opts = Array.prototype.slice.call(sel.options);
      for (var j = 0; j < opts.length; j++) {
        var o = opts[j], t = o.textContent.trim(), v = o.value;
        if (!(set[t] || set[v])) continue;
        if (o.selected && v !== "") continue;      /* never pull the option out from under a record being viewed or edited */
        o.remove();
      }
    }
  }

  /* ---------- hook the existing functions ---------- */
  function after(name, fn) {
    var o = W[name]; if (typeof o !== "function" || o.__acxInact) return;
    var w = function () { var r = o.apply(this, arguments); try { fn(); } catch (e) {} return r; };
    w.__acxInact = true; W[name] = w;
  }
  after("renderBankTable", function () { decorate(); strip(); });
  ["updateBankDropdowns", "populateOverviewTxBankSelect", "populateBankDropdowns", "populateTransferAccounts", "populateReconcileBankDropdown"]
    .forEach(function (n) { after(n, strip); });

  /* dropdowns built later (payment forms, modals) */
  var t = null;
  if (W.MutationObserver) {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i], n = m.target;
        if (n && (n.tagName === "SELECT" || n.tagName === "OPTION" || (m.addedNodes && m.addedNodes.length))) {
          clearTimeout(t); t = setTimeout(strip, 150); return;
        }
      }
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  setTimeout(function () { try { decorate(); strip(); } catch (e) {} }, 1500);
  W.acxToggleBankInactive = setInactive;
})();
}catch(e){console.error('[merged:acacia-funds-inactive.js]',e)}
;

/* acacia-cancel.js — adds a Cancel button next to every Save button that doesn't already have one. */
(function () {
  "use strict";
  var MARK = "data-acx-cancel";
  var SAVE_RE = /^(save\b|submit (transaction|adjustment)\b|add bank$)/i;
  var CANCEL_RE = /^(cancel|close|back|discard)\b/i;
  var CLS = "bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600";

  function label(b) {
    return (b.textContent || "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function isSave(b) { return b.tagName === "BUTTON" && !b.hasAttribute(MARK) && SAVE_RE.test(label(b)); }
  function hasCancel(scope) {
    var bs = scope.querySelectorAll("button,a");
    for (var i = 0; i < bs.length; i++) if (CANCEL_RE.test(label(bs[i]))) return true;
    return false;
  }
  function fields(root) {
    return Array.prototype.slice.call(root.querySelectorAll("input,select,textarea")).filter(function (f) {
      return !/^(hidden|button|submit|reset)$/i.test(f.type);
    });
  }
  function dirty(root) {
    return fields(root).some(function (f) {
      if (f.type === "checkbox" || f.type === "radio") return f.checked !== f.defaultChecked;
      if (f.tagName === "SELECT") return f.selectedIndex > 0;
      return String(f.value || "") !== "" && f.value !== f.defaultValue;
    });
  }
  function reset(root) {
    fields(root).forEach(function (f) {
      try {
        if (f.type === "checkbox" || f.type === "radio") f.checked = false;
        else if (f.tagName === "SELECT") f.selectedIndex = 0;
        else if (f.type === "file") f.value = "";
        else f.value = "";
        f.dispatchEvent(new Event("input", { bubbles: true }));
        f.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}
    });
  }
  function hide(el) { el.classList.add("hidden"); if (el.style && el.style.display) el.style.display = "none"; }

  function findCancelFn(btn) {
    var oc = btn.getAttribute("onclick") || "";
    var m = oc.match(/^\s*(?:window\.)?(save|add|submit)([A-Z]\w*)\(/);
    if (!m) return null;
    var base = m[2];
    var names = [base, base.replace(/(As)?Draft$/, ""), base.replace(/Changes$/, "")];
    for (var i = 0; i < names.length; i++) {
      var fn = window["cancel" + names[i]];
      if (names[i] && typeof fn === "function") return fn;
    }
    return null;
  }

  function doCancel(btn) {
    var modal = btn.closest(".fixed.inset-0,[role=dialog],[id$='Modal'],[id$='modal']");
    var root = modal || null;
    if (!root) {
      var el = btn.parentElement, up = 0;
      while (el && el !== document.body && up < 8) {
        if (fields(el).length >= 2) { root = el; if (fields(el).length > 40) break; }
        el = el.parentElement; up++;
        if (root && fields(el || root).length > 40) break;
      }
    }
    if (root && dirty(root) && !confirm("Discard your changes?")) return;
    var fn = findCancelFn(btn);
    if (fn) { try { fn(); return; } catch (e) { console.warn("[acacia-cancel]", e); } }
    if (root) reset(root);
    if (modal) { hide(modal); return; }
    var sec = btn.closest("[id$='FormSection'],[id$='formSection']");
    if (sec) {
      hide(sec);
      var list = document.getElementById(sec.id.replace(/Form(Section)$/i, "List$1"));
      if (list) list.classList.remove("hidden");
    }
  }

  function scan() {
    var all = document.querySelectorAll("button");
    var rows = new Set();
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (!isSave(b) || !b.parentElement) continue;
      rows.add(b.parentElement);
    }
    rows.forEach(function (row) {
      if (row.hasAttribute(MARK + "-row")) return;
      var saves = Array.prototype.filter.call(row.children, function (c) { return isSave(c); });
      if (!saves.length) return;
      var gp = row.parentElement;
      if (hasCancel(row) || (gp && gp.querySelectorAll("button").length <= 8 && hasCancel(gp))) {
        row.setAttribute(MARK + "-row", "1"); return;
      }
      var last = saves[saves.length - 1];
      var c = document.createElement("button");
      c.type = "button"; c.className = CLS; c.textContent = "Cancel";
      c.setAttribute(MARK, "1");
      if (last.classList.contains("w-full")) c.classList.add("w-full", "mt-2");
      else c.style.marginLeft = "6px";
      c.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); doCancel(last); });
      last.parentNode.insertBefore(c, last.nextSibling);
      row.setAttribute(MARK + "-row", "1");
    });
  }

  var t = null;
  function soon() { clearTimeout(t); t = setTimeout(scan, 300); }
  function start() {
    scan(); setTimeout(scan, 1500);
    try { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
