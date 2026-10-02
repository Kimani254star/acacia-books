/* "Organizations" panel for the company switcher (replaces the small dropdown).
   Shows logo, name, Organization ID (with copy), plan, and a tick on the active company. */
(function () {
  'use strict';
  var COLORS = ['#1e3a8a', '#047857', '#b45309', '#7c3aed', '#be123c', '#0e7490', '#4d7c0f', '#a21caf'];
  var SEP = function () { return (window.__companyNS && window.__companyNS.SEP) || '::'; };

  function raw(k) {
    try { var NS = window.__companyNS; return NS ? NS.nGet.call(NS.real, k) : window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function J(k, d) { try { var v = JSON.parse(raw(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function orgInfoFor(cid) {
    var me = J('loggedInUser', null);
    var o = J('orgInfo' + SEP() + cid, null);
    if (!o && me && String(me.companyId) === String(cid)) o = J('orgInfo', null);
    return o || {};
  }
  function orgIdFor(cid, info) {
    var n = info && info.companyId;
    if (n != null && /^\d{5,}$/.test(String(n))) return String(n);
    return String(cid);
  }
  function planFor(cid) {
    var c = (J('companies', []) || []).filter(function (x) { return x && String(x.companyId) === String(cid); })[0];
    var me = J('loggedInUser', null);
    return (c && c.plan) || (me && String(me.companyId) === String(cid) && me.plan) || '';
  }
  function initials(name) {
    var w = String(name || '?').trim().split(/\s+/);
    return (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase();
  }
  function colorFor(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }

  function css() {
    if (document.getElementById('acxOrgPanelCss')) return;
    var s = document.createElement('style'); s.id = 'acxOrgPanelCss';
    s.textContent =
      '#acxOrgPanel{position:fixed;z-index:10050;width:410px;max-width:96vw;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.28);display:none;flex-direction:column;font-family:Roboto,system-ui,sans-serif;color:#1f2937;border-radius:0 0 8px 8px}' +
      '#acxOrgPanel.open{display:flex}' +
      '#acxOrgPanel .op-head{display:flex;align-items:center;gap:14px;padding:18px 20px;background:#f7f8fc;border-bottom:1px solid #e5e7eb}' +
      '#acxOrgPanel .op-title{font-size:17px;flex:1;color:#111827}' +
      '#acxOrgPanel .op-manage{color:#2563eb;font-size:14px;background:none;border:0;cursor:pointer;display:flex;align-items:center;gap:5px}' +
      '#acxOrgPanel .op-manage:hover{text-decoration:underline}' +
      '#acxOrgPanel .op-sep{width:1px;height:22px;background:#d1d5db}' +
      '#acxOrgPanel .op-x{background:none;border:0;color:#ef4444;font-size:20px;cursor:pointer;line-height:1;padding:0 2px}' +
      '#acxOrgPanel .op-sub{padding:16px 20px;font-size:17px;border-bottom:1px solid #e5e7eb;color:#111827}' +
      '#acxOrgPanel .op-list{overflow:auto;flex:1}' +
      '#acxOrgPanel .op-row{display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid #eef0f3;cursor:pointer}' +
      '#acxOrgPanel .op-row:hover{background:#f3f4f8}' +
      '#acxOrgPanel .op-row.active{background:#f4f5f9}' +
      '#acxOrgPanel .op-logo{width:40px;height:40px;border:1px solid #e5e7eb;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff}' +
      '#acxOrgPanel .op-logo img{max-width:100%;max-height:100%;object-fit:contain}' +
      '#acxOrgPanel .op-logo b{color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:13px}' +
      '#acxOrgPanel .op-main{flex:1;min-width:0}' +
      '#acxOrgPanel .op-name{font-size:15px;display:flex;align-items:center;gap:8px;color:#111827}' +
      '#acxOrgPanel .op-name span.n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#acxOrgPanel .op-badge{background:#a8a3b3;color:#fff;font-size:11px;padding:0 6px;border-radius:4px;line-height:18px;flex:none}' +
      '#acxOrgPanel .op-meta{font-size:12.5px;color:#6b7280;margin-top:3px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}' +
      '#acxOrgPanel .op-copy{background:none;border:0;cursor:pointer;color:#6b7280;padding:0 1px;font-size:12px}' +
      '#acxOrgPanel .op-copy:hover{color:#2563eb}' +
      '#acxOrgPanel .op-dot{color:#9ca3af}' +
      '#acxOrgPanel .op-tick{width:22px;height:22px;border-radius:50%;background:#3b82f6;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;flex:none}' +
      '#acxOrgPanel .op-add{padding:14px 20px;color:#2563eb;font-size:14px;cursor:pointer;border-top:1px solid #e5e7eb;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left}' +
      '#acxOrgPanel .op-add:hover{background:#f3f4f8}';
    document.head.appendChild(s);
  }

  function panel() {
    var p = document.getElementById('acxOrgPanel');
    if (p) return p;
    css();
    p = document.createElement('div'); p.id = 'acxOrgPanel';
    document.body.appendChild(p);
    return p;
  }

  function close() {
    var p = document.getElementById('acxOrgPanel'); if (p) p.classList.remove('open');
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function outside(e) {
    var p = document.getElementById('acxOrgPanel'), w = document.getElementById('acxCompanySwitcherWrap');
    if (p && !p.contains(e.target) && !(w && w.contains(e.target))) close();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  /* get the company list from the original dropdown logic (it renders buttons[data-cid]) */
  function listFromOriginal() {
    var menu = document.getElementById('acxCompanyMenu'), out = [];
    if (!menu) return out;
    menu.querySelectorAll('button[data-cid]').forEach(function (b) {
      var sp = b.querySelector('span');
      out.push({ cid: b.getAttribute('data-cid'), name: sp ? sp.textContent : b.getAttribute('data-cid'), active: /bg-gray-800/.test(b.className) });
    });
    return out;
  }

  function open(orig, ev) {
    var menu = document.getElementById('acxCompanyMenu');
    /* make the original render its list, then hide its small dropdown */
    if (menu) { menu.classList.add('hidden'); try { orig.call(this, ev); } catch (e) {} menu.classList.add('hidden'); }
    var rows = listFromOriginal();
    var me = J('loggedInUser', null), cur = me ? String(me.companyId || '') : '';
    var nameCount = {};
    rows.forEach(function (r) { var k = r.name.trim(); nameCount[k] = (nameCount[k] || 0) + 1; });

    var p = panel();
    var html =
      '<div class="op-head"><div class="op-title">Organizations</div>' +
      '<button class="op-manage" data-act="manage">\u2699 Manage</button><span class="op-sep"></span>' +
      '<button class="op-x" data-act="close" title="Close">\u2715</button></div>' +
      '<div class="op-sub">My Organizations</div><div class="op-list">';
    rows.forEach(function (r) {
      var info = orgInfoFor(r.cid), oid = orgIdFor(r.cid, info), plan = planFor(r.cid);
      var logo = (typeof info.logo === 'string' && info.logo.length > 10)
        ? '<img src="' + esc(info.logo) + '" alt="" data-initials="' + esc(initials(r.name)) + '" data-bg="' + colorFor(r.cid) + '">'
        : '<b style="background:' + colorFor(r.cid) + '">' + esc(initials(r.name)) + '</b>';
      var dup = nameCount[r.name.trim()] > 1 ? '<span class="op-badge">' + esc(oid.slice(-2)) + '</span>' : '';
      var isCur = r.cid === cur || r.active;
      html += '<div class="op-row' + (isCur ? ' active' : '') + '" data-cid="' + esc(r.cid) + '">' +
        '<div class="op-logo">' + logo + '</div>' +
        '<div class="op-main"><div class="op-name"><span class="n">' + esc(r.name) + '</span>' + dup + '</div>' +
        '<div class="op-meta">Organization ID: ' + esc(oid) +
        ' <button class="op-copy" data-copy="' + esc(oid) + '" title="Copy ID">\u29C9</button>' +
        (plan ? '<span class="op-dot">\u2022</span>' + esc(plan) : '') + '</div></div>' +
        (isCur ? '<div class="op-tick">\u2713</div>' : '') + '</div>';
    });
    html += '</div><button class="op-add" data-act="add">\u2795 Add new company\u2026</button>';
    p.innerHTML = html;

    p.querySelectorAll('img[data-initials]').forEach(function (img) {
      img.onerror = function () {
        var b = document.createElement('b'); b.style.background = img.getAttribute('data-bg'); b.textContent = img.getAttribute('data-initials');
        img.replaceWith(b);
      };
    });
    p.onclick = function (e) {
      var t = e.target;
      var cp = t.closest('[data-copy]');
      if (cp) {
        e.stopPropagation();
        var v = cp.getAttribute('data-copy');
        try { navigator.clipboard.writeText(v); } catch (x) {
          var ta = document.createElement('textarea'); ta.value = v; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (y) {} ta.remove();
        }
        cp.textContent = '\u2713'; setTimeout(function () { cp.textContent = '\u29C9'; }, 1200);
        return;
      }
      var act = t.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        close();
        if (a === 'manage' && typeof window.showTab === 'function') { try { window.showTab('orgProfileTab'); } catch (x) {} }
        if (a === 'add' && typeof window.acxAddCompany === 'function') window.acxAddCompany();
        return;
      }
      var row = t.closest('.op-row');
      if (row) {
        var cid = row.getAttribute('data-cid'); close();
        if (cid !== cur && typeof window.acxSwitchCompany === 'function') window.acxSwitchCompany(cid);
      }
    };

    /* anchor under the company button, clamp inside the screen */
    var btn = document.getElementById('orgNameHeader');
    var r = btn ? btn.getBoundingClientRect() : { left: 8, bottom: 40 };
    var top = Math.max(0, Math.round(r.bottom + 6));
    p.style.top = top + 'px';
    p.style.left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - Math.min(410, window.innerWidth * 0.96) - 8)) + 'px';
    p.style.maxHeight = (window.innerHeight - top - 8) + 'px';
    p.classList.add('open');
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
  }

  function boot() {
    var orig = window.acxToggleCompanyMenu;
    if (typeof orig !== 'function') return setTimeout(boot, 400);
    if (orig.__panel) return;
    var wrapped = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      var p = document.getElementById('acxOrgPanel');
      if (p && p.classList.contains('open')) return close();
      open(orig, e);
    };
    wrapped.__panel = true;
    window.acxToggleCompanyMenu = wrapped;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
