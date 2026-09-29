/* acacia-support.js - "Contact support" chat for every Acacia app.
   Loaded automatically by the approval gate once the account is active.
   Tickets go to Supabase; the Support Hub reads and replies. */
(function(){
  if (window.__acxSupport) return; window.__acxSupport = true;
  var URL_ = window.__SUPA_URL__ || 'https://xglsampckermarjpczdf.supabase.co', KEY_ = window.__SUPA_KEY__ || 'sb_publishable_x-dPR7pzhvJgag9soW0I8w_yfKTmi6A';
  var H = { apikey: KEY_, Authorization: 'Bearer ' + KEY_, 'Content-Type': 'application/json' };
  var APP = window.ACX_APP || 'App';
  var view = 'home', openId = null, panel, btn, badge, body;

  function rpc(fn, args){
    return fetch(URL_ + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(args) })
      .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function(t){ return t ? JSON.parse(t) : null; });
  }
  function mine(){ try { return JSON.parse(localStorage.getItem('acx_my_tickets') || '[]'); } catch(e){ return []; } }
  function saveMine(a){ try { localStorage.setItem('acx_my_tickets', JSON.stringify(a.slice(0, 30))); } catch(e){} }
  function who(){
    var s = window.acxSession ? window.acxSession() : null, o = (s && s.obj) || {};
    return { companyId: s ? s.companyId : 'guest', company: o.companyName || '', email: o.email || '', name: o.fullName || o.name || o.username || '' };
  }
  function el(tag, css, text){ var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function btnEl(label, css, fn){ var b = el('button', 'border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font:inherit;' + css, label); b.onclick = fn; return b; }
  function inputEl(ph, val){ var i = el('input', 'width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;margin-bottom:8px;font:inherit;background:#fff;color:#0f172a'); i.placeholder = ph; i.value = val || ''; return i; }
  function ago(d){ var m = Math.round((Date.now() - new Date(d).getTime()) / 60000); if (m < 2) return 'now'; if (m < 90) return m + 'm'; var h = Math.round(m / 60); return h < 36 ? h + 'h' : Math.round(h / 24) + 'd'; }

  function build(){
    btn = el('button', 'position:fixed;right:16px;bottom:16px;z-index:2147483000;background:#2563eb;color:#fff;border:0;border-radius:999px;padding:12px 18px;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)', '\uD83D\uDCAC Support');
    badge = el('span', 'display:none;background:#dc2626;color:#fff;border-radius:999px;font-size:11px;padding:1px 7px;margin-left:8px');
    btn.appendChild(badge);
    panel = el('div', 'display:none;position:fixed;right:16px;bottom:70px;z-index:2147483000;width:340px;max-width:calc(100vw - 32px);max-height:70vh;overflow:auto;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px/1.45 system-ui,sans-serif');
    btn.onclick = function(){ panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; if (panel.style.display === 'block') render(); };
    document.body.appendChild(panel); document.body.appendChild(btn);
  }
  function head(title, back){
    var h = el('div', 'display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;position:sticky;top:0;background:#fff');
    if (back){ var b = el('button', 'border:0;background:none;cursor:pointer;font-size:16px', '\u2190'); b.onclick = function(){ view = 'home'; render(); }; h.appendChild(b); }
    h.appendChild(el('div', 'flex:1', title));
    var x = el('button', 'border:0;background:none;cursor:pointer;font-size:16px', '\u2715'); x.onclick = function(){ panel.style.display = 'none'; }; h.appendChild(x);
    return h;
  }
  function render(){
    panel.innerHTML = '';
    if (view === 'thread') return renderThread();
    panel.appendChild(head('Contact support'));
    var w = who(), pad = el('div', 'padding:14px');
    pad.appendChild(el('div', 'color:#475569;margin-bottom:10px', 'Ask us anything. We reply here, and you can check back later.'));
    var nm = w.name ? null : inputEl('Your name'), em = w.email ? null : inputEl('Your email');
    if (nm) pad.appendChild(nm); if (em) pad.appendChild(em);
    var sub = inputEl('Subject'), msg = el('textarea', 'width:100%;box-sizing:border-box;height:90px;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;margin-bottom:8px;font:inherit;resize:vertical;background:#fff;color:#0f172a'); msg.placeholder = 'Describe the problem or question';
    var pri = el('select', 'width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px;margin-bottom:10px;font:inherit;background:#fff;color:#0f172a');
    ['Medium', 'High', 'Low'].forEach(function(p){ var o = el('option', '', p + ' priority'); o.value = p; pri.appendChild(o); });
    var status = el('div', 'color:#dc2626;margin-bottom:8px;display:none');
    var send = btnEl('Send', 'background:#2563eb;color:#fff;width:100%;font-weight:600', function(){
      var name = w.name || (nm && nm.value.trim()), email = w.email || (em && em.value.trim());
      if (!msg.value.trim()) { status.textContent = 'Please type your message.'; status.style.display = 'block'; return; }
      if (!email) { status.textContent = 'Please enter your email.'; status.style.display = 'block'; return; }
      send.disabled = true; send.textContent = 'Sending\u2026'; status.style.display = 'none';
      rpc('acx_ticket_create', { p_company: w.companyId, p_company_name: w.company, p_email: email, p_name: name || '', p_app: APP,
        p_subject: sub.value.trim(), p_message: msg.value.trim(), p_priority: pri.value })
        .then(function(id){ var a = mine(); a.unshift({ id: id, subject: sub.value.trim() || 'Support request', at: Date.now(), seen: 1 }); saveMine(a); openId = id; view = 'thread'; render(); })
        .catch(function(){ send.disabled = false; send.textContent = 'Send'; status.textContent = 'Could not send. Check your connection and try again.'; status.style.display = 'block'; });
    });
    pad.appendChild(sub); pad.appendChild(msg); pad.appendChild(pri); pad.appendChild(status); pad.appendChild(send);
    var list = mine();
    if (list.length){
      pad.appendChild(el('div', 'margin:16px 0 6px;font-weight:700', 'Your conversations'));
      list.forEach(function(t){
        var row = el('div', 'display:flex;justify-content:space-between;align-items:center;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px;cursor:pointer');
        row.appendChild(el('div', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1', t.subject));
        if (t.unread) row.appendChild(el('span', 'background:#dc2626;color:#fff;border-radius:999px;font-size:11px;padding:1px 7px;margin-left:8px', 'new'));
        row.onclick = function(){ openId = t.id; view = 'thread'; render(); };
        pad.appendChild(row);
      });
    }
    panel.appendChild(pad);
  }
  function renderThread(){
    panel.appendChild(head('Conversation', true));
    var pad = el('div', 'padding:14px'); body = el('div', ''); pad.appendChild(body); panel.appendChild(pad);
    body.appendChild(el('div', 'color:#64748b', 'Loading\u2026'));
    load(true);
  }
  function load(paint){
    if (!openId) return;
    rpc('acx_ticket_get', { p_ticket: openId }).then(function(t){
      if (!t) { if (paint && body) { body.innerHTML = ''; body.appendChild(el('div', '', 'Conversation not found.')); } return; }
      var a = mine(), rec = a.filter(function(x){ return x.id === openId; })[0];
      if (rec){ rec.seen = t.messages.length; rec.unread = false; saveMine(a); }
      updateBadge();
      if (!paint || !body || view !== 'thread') return;
      body.innerHTML = '';
      body.appendChild(el('div', 'font-weight:700;margin-bottom:8px', t.subject));
      t.messages.forEach(function(m){
        var mineMsg = m.sender === 'customer';
        var b = el('div', 'max-width:85%;margin:6px 0;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-break:break-word;' + (mineMsg ? 'background:#dbeafe;margin-left:auto' : 'background:#f1f5f9'), m.body);
        var meta = el('div', 'font-size:11px;color:#64748b;margin-top:2px;text-align:' + (mineMsg ? 'right' : 'left'), (mineMsg ? 'You' : 'Support') + ' \u00b7 ' + ago(m.at));
        body.appendChild(b); body.appendChild(meta);
      });
      if (t.status === 'resolved') body.appendChild(el('div', 'margin:10px 0;color:#16a34a;font-weight:600', '\u2714 Marked as resolved. Reply below to reopen.'));
      var ta = el('textarea', 'width:100%;box-sizing:border-box;height:64px;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;margin:10px 0 8px;font:inherit;resize:vertical;background:#fff;color:#0f172a'); ta.placeholder = 'Write a reply';
      var s = btnEl('Send reply', 'background:#2563eb;color:#fff;font-weight:600', function(){
        if (!ta.value.trim()) return; s.disabled = true;
        rpc('acx_ticket_reply', { p_ticket: openId, p_body: ta.value.trim() }).then(function(){ load(true); }).catch(function(){ s.disabled = false; alert('Could not send. Try again.'); });
      });
      body.appendChild(ta); body.appendChild(s);
    }).catch(function(){ if (paint && body) { body.innerHTML = ''; body.appendChild(el('div', 'color:#dc2626', 'Could not load. Check your connection.')); } });
  }
  function updateBadge(){
    var n = mine().filter(function(t){ return t.unread; }).length;
    badge.textContent = n; badge.style.display = n ? 'inline-block' : 'none';
  }
  function poll(){
    var a = mine().slice(0, 8); if (!a.length) return;
    a.forEach(function(rec){
      rpc('acx_ticket_get', { p_ticket: rec.id }).then(function(t){
        if (!t) return; var all = mine(), r = all.filter(function(x){ return x.id === rec.id; })[0]; if (!r) return;
        var support = t.messages.filter(function(m){ return m.sender === 'support'; }).length;
        var wasSeen = r.seen || 0, total = t.messages.length;
        if (total > wasSeen && support > 0 && !(view === 'thread' && openId === rec.id && panel.style.display === 'block')) r.unread = true;
        saveMine(all); updateBadge();
        if (view === 'thread' && openId === rec.id && panel.style.display === 'block' && total > wasSeen) load(true);
      }).catch(function(){});
    });
  }
  function start(){ build(); updateBadge(); setInterval(poll, 45000); setTimeout(poll, 4000); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
