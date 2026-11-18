/* acacia-support.js - customer-side live chat with the Acacia developer panel (Support Hub).
   Upload this file in the SAME folder as each app's index.html (Books, CRM, Sell, Expenses, Payroll, Projects).
   Defines window.acxOpenSupportPanel(). Messages are stored in Supabase (acacia_tickets / acacia_ticket_messages)
   through the acx_ticket_* functions from acacia_support_chat.sql, and appear in the panel under Support. */
(function () {
  'use strict';
  if (window.__acxSupport) return;
  window.__acxSupport = true;

  var root = null, view = 'list', current = null, timer = null, lastCount = -1, sending = false;
  var tickets = [], msgs = [];

  function cfg() {
    var A = window.AcaciaCloud || {};
    return { url: window.__SUPA_URL__ || A.URL, key: window.__SUPA_KEY__ || A.KEY };
  }
  function session() {
    var s = null;
    try { s = window.acxSession && window.acxSession(); } catch (e) {}
    if (!s || !s.companyId) return null;
    var o = s.obj || {};
    var email = String(o.email || o.username || o.user || o.login || '').trim().toLowerCase();
    return {
      companyId: String(s.companyId),
      companyName: String(o.companyName || o.company || o.companyname || ''),
      name: String(o.name || o.fullName || o.fullname || o.displayName || o.username || email || 'Customer'),
      email: email,
      app: String(window.ACX_APP || 'Books')
    };
  }
  function rpc(fn, args) {
    var c = cfg();
    if (!c.url || !c.key) return Promise.reject(new Error('Support is not connected to the cloud yet.'));
    return fetch(c.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('Request failed (' + r.status + ')'));
        return j;
      });
    });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ago(d) {
    var m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 2) return 'just now'; if (m < 90) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 36) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  }

  function css() {
    if (document.getElementById('acxsCss')) return;
    var st = document.createElement('style'); st.id = 'acxsCss';
    st.textContent =
      '#acxsRoot{position:fixed;right:18px;bottom:18px;width:370px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 36px);z-index:2147483200;background:#fff;color:#111;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border:1px solid #e5e7eb}' +
      '#acxsRoot *{box-sizing:border-box}' +
      '.acxs-h{background:#22615D;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}' +
      '.acxs-h b{flex:1;font-size:15px}.acxs-h small{display:block;opacity:.8;font-weight:400;font-size:11px}' +
      '.acxs-h button{background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px}' +
      '.acxs-h button:hover{background:rgba(255,255,255,.18)}' +
      '.acxs-b{flex:1;overflow:auto;padding:12px;background:#f7f7f5}' +
      '.acxs-new{width:100%;padding:11px;border:0;border-radius:10px;background:#22615D;color:#fff;font-weight:600;cursor:pointer;margin-bottom:10px}' +
      '.acxs-item{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer}' +
      '.acxs-item:hover{border-color:#22615D}.acxs-item .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.acxs-item .m{font-size:12px;color:#6b7280;margin-top:2px;display:flex;gap:8px;align-items:center}' +
      '.acxs-pill{font-size:11px;padding:1px 8px;border-radius:999px;background:#e5e7eb;color:#374151}' +
      '.acxs-pill.open{background:#dcfce7;color:#166534}.acxs-pill.reply{background:#fee2e2;color:#991b1b}' +
      '.acxs-row{display:flex;margin:6px 0}.acxs-row.me{justify-content:flex-end}' +
      '.acxs-msg{max-width:82%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;background:#fff;border:1px solid #e5e7eb}' +
      '.acxs-row.me .acxs-msg{background:#22615D;color:#fff;border-color:#22615D}' +
      '.acxs-msg small{display:block;font-size:10px;opacity:.65;margin-top:3px}' +
      '.acxs-empty{color:#6b7280;text-align:center;padding:22px 10px;font-size:13px}' +
      '.acxs-f{padding:10px;border-top:1px solid #e5e7eb;background:#fff;display:flex;gap:8px;align-items:flex-end}' +
      '.acxs-f textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:8px 10px;font:inherit;max-height:100px;outline:none}' +
      '.acxs-f textarea:focus{border-color:#22615D}' +
      '.acxs-f button{border:0;background:#22615D;color:#fff;border-radius:10px;padding:9px 14px;font-weight:600;cursor:pointer}' +
      '.acxs-f button:disabled{opacity:.5;cursor:default}' +
      '.acxs-err{color:#b91c1c;font-size:12px;padding:6px 12px;background:#fef2f2}' +
      '.acxs-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:10px}' +
      '.acxs-kv{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px}' +
      '.acxs-kv:last-child{border-bottom:0}.acxs-kv span{color:#6b7280}.acxs-kv b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;word-break:break-all;text-align:right}' +
      '.acxs-cp{border:1px solid #d1d5db;background:#fff;border-radius:6px;font-size:11px;padding:2px 7px;cursor:pointer;margin-left:6px}' +
      '.acxs-note{font-size:12px;color:#6b7280;line-height:1.5}' +
      '.acxs-danger{border-color:#fecaca;background:#fff7f7}.acxs-danger h4{margin:0 0 4px;color:#991b1b;font-size:14px}' +
      '.acxs-danger input{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font:inherit;margin:6px 0;outline:none}' +
      '.acxs-del{width:100%;border:0;border-radius:10px;background:#b91c1c;color:#fff;font-weight:600;padding:10px;cursor:pointer;margin-top:4px}' +
      '.acxs-del:disabled{opacity:.5;cursor:default}.acxs-ghost{width:100%;border:1px solid #d1d5db;background:#fff;border-radius:10px;padding:9px;cursor:pointer;margin-top:6px;font-weight:600;color:#991b1b}';
    document.head.appendChild(st);
  }

  function build() {
    css();
    if (root) root.remove();
    root = document.createElement('div'); root.id = 'acxsRoot';
    document.body.appendChild(root);
  }
  function close() {
    stopPoll();
    if (root) { root.remove(); root = null; }
  }
  function stopPoll() { if (timer) { clearInterval(timer); timer = null; } }
  function startPoll(fn, ms) { stopPoll(); timer = setInterval(fn, ms); }
  function setErr(t) {
    var e = root && root.querySelector('.acxs-err');
    if (e) { e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; }
  }

  /* ---------- list view ---------- */
  function showList() {
    view = 'list'; current = null; lastCount = -1;
    var s = session();
    root.innerHTML =
      '<div class="acxs-h"><b>Acacia Support<small>Chat with the developer team</small></b><button id="acxsAcct" title="My company: Company ID, license, delete account">&#128100;</button><button id="acxsX" title="Close">&times;</button></div>' +
      '<div class="acxs-b" id="acxsBody"><div class="acxs-empty">Loading your conversations...</div></div><div class="acxs-err" style="display:none"></div>';
    root.querySelector('#acxsX').onclick = close;
    root.querySelector('#acxsAcct').onclick = showAccount;
    var load = function () {
      rpc('acx_ticket_list', { p_company: s.companyId, p_email: s.email }).then(function (rows) {
        tickets = rows || [];
        if (view !== 'list') return;
        if (!tickets.length && lastCount === -1) { lastCount = 0; return openThread(null); }
        lastCount = tickets.length; drawList();
      }).catch(function (e) {
        if (view !== 'list') return;
        var b = root.querySelector('#acxsBody');
        if (b && lastCount === -1) b.innerHTML = '<div class="acxs-empty">Could not load conversations.<br><small>' + esc(e.message) + '</small><br><br>Ask the developer to run <b>acacia_support_chat.sql</b> in Supabase.</div>';
      });
    };
    load(); startPoll(load, 8000);
  }
  function drawList() {
    var b = root.querySelector('#acxsBody'); if (!b) return;
    b.innerHTML = '<button class="acxs-new" id="acxsNew">+ New conversation</button>' +
      tickets.map(function (t) {
        var reply = t.status !== 'resolved' && t.last_sender === 'support';
        return '<div class="acxs-item" data-id="' + esc(t.id) + '"><div class="t">' + esc(t.subject || 'Support request') + '</div>' +
          '<div class="m"><span class="acxs-pill ' + (reply ? 'reply' : (t.status === 'resolved' ? '' : 'open')) + '">' +
          (reply ? 'New reply' : (t.status === 'resolved' ? 'Resolved' : 'Open')) + '</span><span>' + ago(t.updated_at) + '</span></div></div>';
      }).join('');
    b.querySelector('#acxsNew').onclick = function () { openThread(null); };
    [].forEach.call(b.querySelectorAll('.acxs-item'), function (el) {
      el.onclick = function () {
        var id = el.getAttribute('data-id');
        openThread(tickets.filter(function (t) { return String(t.id) === id; })[0]);
      };
    });
  }

  /* ---------- thread view ---------- */
  function openThread(t) {
    view = 'thread'; current = t || null; msgs = []; lastCount = -1;
    var s = session(), hasList = tickets.length > 0;
    root.innerHTML =
      '<div class="acxs-h">' + (hasList ? '<button id="acxsBack" title="Back">&larr;</button>' : '') +
      '<b>' + esc(t ? (t.subject || 'Support request') : 'New conversation') + '<small>' + esc(s.app) + ' &middot; ' + esc(s.email) + '</small></b><button id="acxsAcct" title="My company">&#128100;</button><button id="acxsX" title="Close">&times;</button></div>' +
      '<div class="acxs-b" id="acxsBody"></div><div class="acxs-err" style="display:none"></div>' +
      '<div class="acxs-f"><textarea id="acxsIn" rows="1" placeholder="Type your message..."></textarea><button id="acxsSend">Send</button></div>';
    root.querySelector('#acxsX').onclick = close;
    var back = root.querySelector('#acxsBack'); if (back) back.onclick = showList;
    root.querySelector('#acxsAcct').onclick = showAccount;
    var ta = root.querySelector('#acxsIn');
    ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    root.querySelector('#acxsSend').onclick = send;
    drawThread();
    if (t) { pull(); startPoll(pull, 4000); } else stopPoll();
    setTimeout(function () { ta.focus(); }, 50);
  }
  function drawThread() {
    var b = root && root.querySelector('#acxsBody'); if (!b) return;
    if (!msgs.length) {
      b.innerHTML = '<div class="acxs-empty">' + (current ? 'No messages yet.' : 'Hi! Tell us what you need help with and a developer will reply here.') + '</div>';
      return;
    }
    b.innerHTML = msgs.map(function (m) {
      var me = m.sender === 'customer';
      return '<div class="acxs-row ' + (me ? 'me' : '') + '"><div class="acxs-msg">' + esc(m.body) +
        '<small>' + (me ? 'You' : 'Support') + ' &middot; ' + ago(m.created_at) + '</small></div></div>';
    }).join('');
    b.scrollTop = b.scrollHeight;
  }
  function pull() {
    if (!current || view !== 'thread') return;
    var s = session(); if (!s) return;
    rpc('acx_ticket_messages', { p_ticket: current.id, p_email: s.email }).then(function (rows) {
      rows = rows || [];
      if (view !== 'thread' || rows.length === lastCount) return;
      lastCount = rows.length; msgs = rows; drawThread();
    }).catch(function () {});
  }
  function send() {
    if (sending) return;
    var ta = root.querySelector('#acxsIn'), btn = root.querySelector('#acxsSend');
    var text = (ta.value || '').trim(); if (!text) return;
    var s = session();
    if (!s || !s.email) { setErr('Please sign in again, then reopen support.'); return; }
    sending = true; btn.disabled = true; setErr('');
    var p;
    if (current) {
      p = rpc('acx_ticket_post', { p_ticket: current.id, p_email: s.email, p_body: text });
    } else {
      var subject = text.replace(/\s+/g, ' ').slice(0, 70);
      p = rpc('acx_ticket_create', {
        p_company: s.companyId, p_company_name: s.companyName, p_app: s.app,
        p_name: s.name, p_email: s.email, p_subject: subject, p_body: text
      }).then(function (id) { current = { id: id, subject: subject, status: 'open' }; });
    }
    p.then(function () {
      ta.value = ''; sending = false; btn.disabled = false;
      msgs.push({ sender: 'customer', body: text, created_at: new Date().toISOString() });
      lastCount = msgs.length; drawThread();
      var h = root.querySelector('.acxs-h b'); if (h && current) h.firstChild.nodeValue = current.subject || 'Support request';
      startPoll(pull, 4000);
    }).catch(function (e) {
      sending = false; btn.disabled = false;
      setErr('Could not send: ' + e.message);
    });
  }

  /* ---------- account view: Company ID, license code, delete account ---------- */
  function appLogout() {
    try { if (window.AcxSession) window.AcxSession.clear(true); } catch (e) {}
    try {
      if (typeof window.handleLogout === 'function') return window.handleLogout();
      if (typeof window.signOut === 'function') return window.signOut();
      var o = document.getElementById('aclOut'); if (o) return o.click();
      var h = document.querySelector('[onclick*="handleLogout"],[onclick*="signOut"],[onclick*="logout"]'); if (h) h.click();
    } catch (e) {}
  }
  function copyBtn(v) { return v ? '<button class="acxs-cp" data-copy="' + esc(v) + '">Copy</button>' : ''; }
  function showAccount() {
    view = 'account'; stopPoll();
    var s = session();
    root.innerHTML =
      '<div class="acxs-h"><button id="acxsBack" title="Back to chat">&larr;</button><b>My company<small>' + esc(s.app) + ' &middot; ' + esc(s.email) + '</small></b><button id="acxsX" title="Close">&times;</button></div>' +
      '<div class="acxs-b" id="acxsBody"><div class="acxs-empty">Loading...</div></div><div class="acxs-err" style="display:none"></div>';
    root.querySelector('#acxsX').onclick = close;
    root.querySelector('#acxsBack').onclick = showList;
    rpc('acx_company_info', { p_company: s.companyId }).then(function (i) { drawAccount(i || {}, s); })
      .catch(function (e) { drawAccount({ found: false, error: e.message }, s); });
  }
  function drawAccount(info, s) {
    var b = root && root.querySelector('#acxsBody'); if (!b || view !== 'account') return;
    var cid = info.org_code || s.companyId;
    var lic = info.license_code
      ? '<b>' + esc(info.license_code) + '</b>' + copyBtn(info.license_code)
      : '<b style="font-family:inherit;font-weight:500;color:#6b7280">Issued once Acacia approves your plan</b>';
    var until = info.paid_until ? new Date(info.paid_until).toLocaleDateString() : '';
    b.innerHTML =
      '<div class="acxs-card">' +
        '<div class="acxs-kv"><span>Company</span><b>' + esc(info.company_name || s.companyName || '-') + '</b></div>' +
        '<div class="acxs-kv"><span>Company ID</span><div><b>' + esc(cid) + '</b>' + copyBtn(cid) + '</div></div>' +
        '<div class="acxs-kv"><span>License code</span><div>' + lic + '</div></div>' +
        '<div class="acxs-kv"><span>Plan</span><b>' + esc(info.plan || '-') + '</b></div>' +
        '<div class="acxs-kv"><span>Status</span><b>' + esc(info.status || '-') + (until ? ' &middot; until ' + esc(until) : '') + '</b></div>' +
      '</div>' +
      (info.error ? '<div class="acxs-note" style="margin-bottom:10px">Could not load the latest details (' + esc(info.error) + '). Ask the developer to run <b>acacia_company_lifecycle.sql</b>.</div>' : '') +
      '<div class="acxs-card acxs-danger"><h4>Delete account</h4>' +
        '<div class="acxs-note">Deactivates this company in every Acacia app: nobody can sign in any more and it is removed from Support. Only the company administrator can do this.</div>' +
        '<div id="acxsDelBox"><button class="acxs-ghost" id="acxsDelStart">Delete this account...</button></div>' +
      '</div>';
    [].forEach.call(b.querySelectorAll('.acxs-cp'), function (btn) {
      btn.onclick = function () {
        var v = btn.getAttribute('data-copy');
        try { navigator.clipboard.writeText(v); btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1200); } catch (e) {}
      };
    });
    b.querySelector('#acxsDelStart').onclick = function () {
      var name = info.company_name || s.companyName || '';
      b.querySelector('#acxsDelBox').innerHTML =
        '<div class="acxs-note" style="margin-top:8px">Type the company name' + (name ? ' <b>' + esc(name) + '</b>' : '') + ' and your password to confirm.</div>' +
        '<input id="acxsDelName" autocomplete="off" placeholder="Company name">' +
        '<input id="acxsDelPw" type="password" autocomplete="current-password" placeholder="Your password">' +
        '<button class="acxs-del" id="acxsDelGo">Permanently delete account</button>';
      b.querySelector('#acxsDelGo').onclick = function () {
        var go = b.querySelector('#acxsDelGo');
        var typed = (b.querySelector('#acxsDelName').value || '').trim().toLowerCase();
        var pw = b.querySelector('#acxsDelPw').value || '';
        if (name && typed !== String(name).trim().toLowerCase()) { setErr('The company name does not match.'); return; }
        if (!pw) { setErr('Enter your password.'); return; }
        go.disabled = true; setErr('');
        rpc('acx_delete_my_company', { p_company: s.companyId, p_email: s.email, p_password: pw }).then(function () {
          try { localStorage.setItem('acx_tomb_' + s.companyId.toLowerCase(), String(Date.now())); } catch (e) {}
          b.innerHTML = '<div class="acxs-empty">Your account has been deleted and the company is deactivated.<br>Signing you out...</div>';
          setTimeout(function () { appLogout(); setTimeout(function () { location.reload(); }, 600); }, 1500);
        }).catch(function (e) { go.disabled = false; setErr(e.message || 'Could not delete the account.'); });
      };
    };
  }

  /* ---------- public entry ---------- */
  window.acxOpenSupportPanel = function () {
    var s = session();
    build();
    if (!s || !s.email) {
      root.innerHTML = '<div class="acxs-h"><b>Acacia Support</b><button id="acxsX">&times;</button></div>' +
        '<div class="acxs-b"><div class="acxs-empty">Please sign in to chat with support.</div></div>';
      root.querySelector('#acxsX').onclick = close;
      return;
    }
    showList();
  };
  window.acxOpenAccountPanel = function () {
    var s = session();
    build();
    if (!s || !s.email) {
      root.innerHTML = '<div class="acxs-h"><b>My company</b><button id="acxsX">&times;</button></div>' +
        '<div class="acxs-b"><div class="acxs-empty">Please sign in first.</div></div>';
      root.querySelector('#acxsX').onclick = close;
      return;
    }
    showAccount();
  };
  window.acxCloseSupportPanel = close;
})();
