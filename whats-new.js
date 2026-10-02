/* Webinar Center  ->  "What's New" feed.
   Replaces the fixed "New Module" banner with a live list of new modules / apps / improvements,
   each with a short explanation and an Open button. Admins can announce new ones from the panel.
   Add built-in items to BUILT_IN below (newest first). Unseen items show a red dot on the Webinar button. */
(function () {
  'use strict';
  if (window.__acxWhatsNew) return; window.__acxWhatsNew = true;

  var KEY = 'acaciaWhatsNew', SEEN = 'acaciaWhatsNewSeen';
  var BUILT_IN = [
    { id: 'b-notif-log', type: 'Improvement', date: '2026-10-02', title: 'Smarter Notifications',
      text: 'The bell now shows what actually happened: new, paid, edited and deleted invoices, bills and more, with before \u2192 after values.', tab: '' },
    { id: 'b-merge', type: 'New Module', date: '2026-10-01', title: 'Merge Duplicates',
      text: 'Merge duplicate Customers, Suppliers and Inventory items in one click. Balances, stock and linked invoices/bills are combined safely.', tab: 'customersTab' },
    { id: 'b-orgs', type: 'Improvement', date: '2026-09-30', title: 'Organizations Panel',
      text: 'Switch companies from a full panel showing logo, Organization ID (copyable) and plan, with a tick on the active company.', tab: 'orgProfileTab' },
    { id: 'b-mail', type: 'New App', date: '2026-09-30', title: 'Mail Hub',
      text: 'Send and manage company email in a dedicated app. Mail sent from Books lands in the Mail Hub as a draft.', link: 'https://kimani254star.github.io/acacia-mail/' },
    { id: 'b-crm', type: 'New App', date: '2026-09-28', title: 'CRM Hub',
      text: 'Track leads, customers and follow-ups in the CRM app, opened straight from Books.', link: 'https://kimani254star.github.io/acacia-crm/?from=books' }
  ];
  var BADGE = { 'New Module': ['#fee2e2', '#b91c1c'], 'New App': ['#dbeafe', '#1d4ed8'], 'Improvement': ['#dcfce7', '#15803d'] };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var jget = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  var jset = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var isAdmin = function () { var u = jget('loggedInUser', null); return !!(u && /admin/i.test(String(u.role || ''))); };
  var safeUrl = function (u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; };

  function items() {
    var custom = jget(KEY, []); if (!Array.isArray(custom)) custom = [];
    var all = custom.concat(BUILT_IN);
    all.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    return all;
  }
  function unseen() { var s = jget(SEEN, []); return items().filter(function (i) { return s.indexOf(i.id) < 0; }); }
  function markSeen() { jset(SEEN, items().map(function (i) { return i.id; })); dot(); }

  function dot() {
    var b = $('webinarToggle'); if (!b) return;
    var d = b.querySelector('.acx-wn-dot'), n = unseen().length;
    if (n && !d) { d = document.createElement('span'); d.className = 'acx-wn-dot'; d.style.cssText = 'display:inline-block;min-width:16px;height:16px;line-height:16px;border-radius:9px;background:#dc2626;color:#fff;font-size:10px;text-align:center;margin-left:6px;padding:0 4px;vertical-align:middle'; b.appendChild(d); }
    if (d) { if (n) d.textContent = n; else d.remove(); }
  }

  function host() {
    var h = $('acxWhatsNew'); if (h) return h;
    var panel = $('webinarPanel'); if (!panel) return null;
    /* swap the old fixed banner for our container */
    var old = null;
    panel.querySelectorAll('div').forEach(function (d) { if (!old && /Interactive Q&A Session Hub/.test(d.textContent) && d.className.indexOf('border-red-100') > -1) old = d; });
    h = document.createElement('div'); h.id = 'acxWhatsNew';
    if (old) old.replaceWith(h);
    else { var body = panel.querySelector('.custom-scrollbar') || panel; body.insertBefore(h, body.firstChild); }
    h.addEventListener('click', onClick);
    return h;
  }

  var showAll = false, adding = false;
  function card(i, fresh) {
    var c = BADGE[i.type] || BADGE['Improvement'], link = safeUrl(i.link);
    var act = link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener" style="color:#2563eb;font-weight:700;font-size:13px">Open app \u2192</a>'
      : (i.tab ? '<button data-go="' + esc(i.tab) + '" style="color:#2563eb;font-weight:700;font-size:13px;background:none;border:0;cursor:pointer;padding:0">Open module \u2192</button>' : '');
    return '<div style="border:1px solid #e5e7eb;border-radius:14px;padding:10px 12px;margin-bottom:8px;background:' + (fresh ? '#fff7ed' : '#fff') + ';position:relative">' +
      '<div style="display:flex;align-items:center;gap:8px"><span style="background:' + c[0] + ';color:' + c[1] + ';font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px">' + esc(i.type) + '</span>' +
      (fresh ? '<span style="color:#dc2626;font-size:11px;font-weight:700">NEW</span>' : '') +
      '<span style="flex:1"></span><span style="color:#9ca3af;font-size:11px">' + esc(i.date || '') + '</span>' +
      (i.custom && isAdmin() ? '<button data-del="' + esc(i.id) + '" title="Remove" style="color:#9ca3af;background:none;border:0;cursor:pointer;margin-left:4px">\u2715</button>' : '') + '</div>' +
      '<div style="font-weight:700;font-size:14px;color:#111827;margin-top:4px">' + esc(i.title) + '</div>' +
      '<div style="font-size:13px;color:#4b5563;margin-top:2px;line-height:1.4">' + esc(i.text) + '</div>' +
      (act ? '<div style="margin-top:6px">' + act + '</div>' : '') + '</div>';
  }

  var seenBefore = [];
  function render() {
    var h = host(); if (!h) return;
    var all = items(), shown = showAll ? all : all.slice(0, 3);
    var html = '<div style="display:flex;align-items:center;margin-bottom:6px"><span style="font-weight:700;font-size:14px;color:#111827">\uD83D\uDCE2 What\u2019s New</span><span style="flex:1"></span>' +
      (isAdmin() ? '<button data-add="1" style="color:#2563eb;font-size:13px;background:none;border:0;cursor:pointer">' + (adding ? 'Cancel' : '\uFF0B Announce') + '</button>' : '') + '</div>';
    if (adding) {
      var f = 'width:100%;border:1px solid #d1d5db;border-radius:10px;padding:5px 8px;font-size:13px;margin-bottom:6px;box-sizing:border-box';
      html += '<div style="border:1px dashed #9ca3af;border-radius:14px;padding:10px;margin-bottom:8px;background:#f9fafb">' +
        '<select id="wnType" style="' + f + '"><option>New Module</option><option>New App</option><option>Improvement</option></select>' +
        '<input id="wnTitle" placeholder="Name (e.g. Payroll Hub)" style="' + f + '">' +
        '<textarea id="wnText" rows="2" placeholder="Brief explanation of what it does" style="' + f + '"></textarea>' +
        '<input id="wnLink" placeholder="App link https://\u2026 (optional)" style="' + f + '">' +
        '<input id="wnTab" placeholder="Or module tab id e.g. quotesTab (optional)" style="' + f + '">' +
        '<button data-save="1" style="background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:5px 14px;font-size:13px;cursor:pointer">Publish</button></div>';
    }
    html += shown.map(function (i) { return card(i, seenBefore.indexOf(i.id) < 0); }).join('');
    if (all.length > 3) html += '<button data-more="1" style="color:#2563eb;font-size:13px;background:none;border:0;cursor:pointer">' + (showAll ? 'Show less' : 'Show all (' + all.length + ')') + '</button>';
    h.innerHTML = html;
  }

  function onClick(e) {
    var t = e.target, b;
    if ((b = t.closest('[data-go]'))) { var tab = b.getAttribute('data-go'), p = $('webinarPanel'); if (p) p.classList.add('hidden'); if (typeof window.showTab === 'function') { try { window.showTab(tab); } catch (x) {} } return; }
    if (t.closest('[data-add]')) { adding = !adding; render(); return; }
    if (t.closest('[data-more]')) { showAll = !showAll; render(); return; }
    if ((b = t.closest('[data-del]'))) { var id = b.getAttribute('data-del'); if (confirm('Remove this announcement?')) { jset(KEY, jget(KEY, []).filter(function (x) { return x.id !== id; })); render(); dot(); } return; }
    if (t.closest('[data-save]')) {
      var title = ($('wnTitle').value || '').trim(), text = ($('wnText').value || '').trim();
      if (!title || !text) return alert('Please enter a name and a brief explanation.');
      var link = ($('wnLink').value || '').trim(), tabId = ($('wnTab').value || '').trim();
      if (link && !safeUrl(link)) return alert('Link must start with http:// or https://');
      var list = jget(KEY, []);
      list.unshift({ id: 'c' + Date.now().toString(36), custom: true, type: $('wnType').value, title: title, text: text, link: link, tab: tabId, date: new Date().toISOString().slice(0, 10) });
      jset(KEY, list); adding = false; seenBefore = jget(SEEN, []); render(); dot();
      if (typeof window.addNotification === 'function') { try { window.addNotification('\uD83C\uDD95 ' + $('wnType').value + ': ' + title, { force: true, type: 'new', lines: [text] }); } catch (x) {} }
    }
  }

  function boot() {
    var orig = window.toggleWebinarPanel;
    if (typeof orig !== 'function' || !$('webinarPanel')) return setTimeout(boot, 400);
    if (orig.__wn) return;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      var p = $('webinarPanel');
      if (p && !p.classList.contains('hidden')) { seenBefore = jget(SEEN, []); adding = false; render(); markSeen(); }
      return r;
    };
    wrapped.__wn = true; window.toggleWebinarPanel = wrapped;
    dot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
