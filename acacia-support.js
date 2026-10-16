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
      '.acxs-err{color:#b91c1c;font-size:12px;padding:6px 12px;background:#fef2f2}';
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
      '<div class="acxs-h"><b>Acacia Support<small>Chat with the developer team</small></b><button id="acxsX" title="Close">&times;</button></div>' +
      '<div class="acxs-b" id="acxsBody"><div class="acxs-empty">Loading your conversations...</div></div><div class="acxs-err" style="display:none"></div>';
    root.querySelector('#acxsX').onclick = close;
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
      '<b>' + esc(t ? (t.subject || 'Support request') : 'New conversation') + '<small>' + esc(s.app) + ' &middot; ' + esc(s.email) + '</small></b><button id="acxsX" title="Close">&times;</button></div>' +
      '<div class="acxs-b" id="acxsBody"></div><div class="acxs-err" style="display:none"></div>' +
      '<div class="acxs-f"><textarea id="acxsIn" rows="1" placeholder="Type your message..."></textarea><button id="acxsSend">Send</button></div>';
    root.querySelector('#acxsX').onclick = close;
    var back = root.querySelector('#acxsBack'); if (back) back.onclick = showList;
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
  window.acxCloseSupportPanel = close;
})();
