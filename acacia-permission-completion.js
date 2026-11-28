/* Acacia Books permissions completion: adds only the connected apps missing from User Management (no duplicates).
   Adds missing entries to User Management's module-access checkbox list.
   Values are stored in the user's existing modules array for compatibility.
   Supabase authorization enforcement must still be wired to these assignments. */
(function(){
  'use strict';
  /* Only modules that do NOT already exist in app-3.js MODULE_GROUPS are added here.
     Everything else (Inventory, Sales, Purchases, Accountant, Payroll, Reports, Settings...)
     is already defined there, so re-adding it under new IDs created duplicate rows.
     Connected apps that already have a Hub entry (Mail, CRM, Project, Inventory, Sell,
     Expenses, Payroll, Plans) are NOT repeated - only the apps with no entry yet. */
  var MASTER_GROUPS = [
    {label:'Acacia Apps',items:[['app_budget','Acacia Budget'],['app_meet','Acacia Meet'],['app_pos','Acacia POS'],['app_stock','Acacia Stock']]}
  ];
  var APPS = ['budget','meet','pos','stock'];
  function discovered(){var ids=new Set();document.querySelectorAll('#sidebar button[onclick],#sidebar a[onclick]').forEach(function(el){var raw=el.getAttribute('onclick')||'';var m=raw.match(/showTab\(\s*['\"]([^'\"]+)['\"]/)||raw.match(/openTab\(\s*['\"]([^'\"]+)['\"]/)||raw.match(/navigateTo\(\s*['\"]([^'\"]+)['\"]/) ;if(m&&m[1]&&m[1]!=='homeTab')ids.add(m[1]);});return Array.from(ids);}
  function addCheckbox(container,value,label,group){if(container.querySelector('input[type=checkbox][value="'+value.replace(/"/g,'\\"')+'"]'))return;var lab=document.createElement('label');lab.className='acx-permission-master-item';lab.style.cssText='display:flex;align-items:center;gap:6px;padding:3px 5px;margin:2px 0;font-size:13px';var cb=document.createElement('input');cb.type='checkbox';cb.value=value;cb.setAttribute('data-acx-master','1');lab.appendChild(cb);lab.appendChild(document.createTextNode(label));container.appendChild(lab);}
  function extend(){try{var list=document.getElementById('moduleAccessList');if(list){var body=list.querySelector('[data-group-body="custom"]')||list;MASTER_GROUPS.forEach(function(g){var gid='acx-master-group-'+g.label.replace(/[^a-z0-9]/gi,'-');if(!body.querySelector('#'+gid)){var heading=document.createElement('div');heading.id=gid;heading.textContent=g.label;heading.style.cssText='font-weight:700;padding:7px 5px 3px;border-top:1px solid #ddd;margin-top:5px';body.appendChild(heading);}g.items.forEach(function(it){addCheckbox(body,it[0],it[1],g.label);});});if(!body.querySelector('#acx-mail-access-note')){var mailNote=document.createElement('div');mailNote.id='acx-mail-access-note';mailNote.textContent='Acacia Mail: available to every authenticated Books user (no paid app toggle).';mailNote.style.cssText='padding:8px;color:#166534;font-size:12px';body.appendChild(mailNote);}}
      if(Array.isArray(ALL_MODULES)){MASTER_GROUPS.forEach(function(g){g.items.forEach(function(it){if(ALL_MODULES.indexOf(it[0])<0)ALL_MODULES.push(it[0]);});});discovered().forEach(function(id){if(ALL_MODULES.indexOf(id)<0)ALL_MODULES.push(id);});}
      if(Array.isArray(MODULE_GROUPS)){MASTER_GROUPS.forEach(function(g){var target=MODULE_GROUPS.find(function(x){return x.label===g.label;});if(!target){target={label:g.label,modules:[]};MODULE_GROUPS.push(target);}g.items.forEach(function(it){if(target.modules.indexOf(it[0])<0)target.modules.push(it[0]);});});}
    }catch(e){console.warn('[Acacia permission master inventory]',e);}}
  function init(){extend();setTimeout(extend,500);setTimeout(extend,1800);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();window.addEventListener('load',init);
})();

/* Acacia Books - User Management with 3 navigation tabs
   👥 Users        Add, invite, edit, deactivate and manage users
   🛡️ Roles        Create roles, assign users and manage role responsibilities
   🔐 Permissions  Control module access and individual permissions (role or user)
   Reuses the existing users table, role editor and permission data (localStorage "users",
   acxRolesV2_<company>, acxRolesV2_builtin_<company>). */
(function () {
  'use strict';
  if (window.__acxUMTabs) return;
  window.__acxUMTabs = true;

  var TAB_KEY = 'acxUMActiveTab';
  var TABS = [['users', '👥 Users'], ['roles', '🛡️ Roles'], ['perms', '🔐 Permissions']];
  var panes = {}, bar = null, active = 'users';
  var P = { type: 'role', id: '', perms: null, dirty: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function me() { return jget('loggedInUser', {}) || {}; }
  function cid() { return String(me().companyId || ''); }
  function allUsers() { return jget('users', []); }
  function saveUsers(a) {
    localStorage.setItem('users', JSON.stringify(a));
    try { if (window.uploadLocalStorage) window.uploadLocalStorage(); } catch (e) {}
  }
  function API() { return window.__acxRoles || null; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function actions() { return typeof PERMISSION_ACTIONS !== 'undefined' ? PERMISSION_ACTIONS : []; }
  function groups() { return typeof MODULE_GROUPS !== 'undefined' ? MODULE_GROUPS : []; }
  function fmt(m) { return typeof formatModuleName === 'function' ? formatModuleName(m) : m; }
  function blankSet() { var o = {}; actions().forEach(function (a) { o[a.key] = false; }); return o; }
  function modsOf(p) { return Object.keys(p || {}).filter(function (k) { return p[k] && p[k].view; }); }
  function sameEmail(a, b) { return a && b && String(a).toLowerCase() === String(b).toLowerCase(); }
  function isSelf(u) { var c = me(); return sameEmail(u.email, c.email) || (u.username && u.username === c.username && String(u.companyId || '') === cid()); }
  function activeAdmins(list, exclude) {
    return list.filter(function (x) {
      return x !== exclude && String(x.companyId || '') === cid() && String(x.role || '').toLowerCase() === 'admin' && x.status !== 'inactive';
    }).length;
  }
  function log(action, desc) { try { if (typeof logActivity === 'function') logActivity({ action: action, module: 'User Management', description: desc }); } catch (e) {} }
  function refreshUsers() { try { if (typeof renderUserTable === 'function') renderUserTable(); } catch (e) {} }
  function moduleIds() {
    var seen = {}, out = [];
    groups().forEach(function (g) { g.modules.forEach(function (m) { if (!seen[m]) { seen[m] = 1; out.push(m); } }); });
    try { if (typeof ALL_MODULES !== 'undefined') ALL_MODULES.forEach(function (m) { if (!seen[m]) { seen[m] = 1; out.push(m); } }); } catch (e) {}
    return out;
  }
  function normalise(p) {
    var o = {};
    moduleIds().forEach(function (m) { o[m] = Object.assign(blankSet(), (p && p[m]) || {}); });
    return o;
  }

  /* ---------- styles ---------- */
  function addStyle() {
    if ($('acxUMStyle')) return;
    var st = document.createElement('style');
    st.id = 'acxUMStyle';
    st.textContent =
      '#acxUMBar{display:flex;gap:6px;flex-wrap:wrap;border-bottom:2px solid #1e3a8a;margin:8px 0 14px}' +
      '#acxUMBar button{padding:7px 16px;border:1px solid #1e3a8a;border-bottom:none;border-radius:6px 6px 0 0;background:#fff;color:#1e3a8a;font-weight:700;font-size:13px;cursor:pointer}' +
      '#acxUMBar button.on{background:#1e3a8a;color:#fff}' +
      '.acxum-btn{border:1px solid #1e3a8a;background:#1e3a8a;color:#fff;font-weight:700;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:13px}' +
      '.acxum-btn:hover{background:#1e40af}.acxum-btn.alt{background:#fff;color:#1e3a8a}' +
      '.acxum-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}' +
      '.acxum-badge.ok{background:#dcfce7;color:#166534}.acxum-badge.off{background:#fee2e2;color:#991b1b}' +
      '#acxumMatrixWrap{overflow:auto;max-height:68vh;border:1px solid #d1d5db;border-radius:6px}' +
      '#acxumMatrix{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}' +
      '#acxumMatrix th,#acxumMatrix td{border:1px solid #e5e7eb;padding:4px 8px;white-space:nowrap}' +
      '#acxumMatrix thead th{position:sticky;top:0;background:#1e3a8a;color:#fff;z-index:2;text-align:center}' +
      '#acxumMatrix thead th:first-child{text-align:left;left:0;z-index:3}' +
      '#acxumMatrix td:first-child{position:sticky;left:0;background:#fff;z-index:1}' +
      '#acxumMatrix tr.grp td{background:#eff6ff;font-weight:700;color:#1e3a8a}' +
      '#acxumMatrix td.c{text-align:center}' +
      '#acxUMAssign{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '#acxUMAssign .box{background:#fff;border-radius:10px;width:520px;max-width:100%;max-height:88vh;display:flex;flex-direction:column}';
    document.head.appendChild(st);
  }

  /* ---------- tab shell ---------- */
  function build() {
    var root = $('userManagementTab');
    if (!root || root.getAttribute('data-acx-tabs')) return;
    root.setAttribute('data-acx-tabs', '1');
    addStyle();
    bar = document.createElement('div');
    bar.id = 'acxUMBar';
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-acxum-tab', t[0]);
      b.textContent = t[1];
      bar.appendChild(b);
    });
    var h2 = root.querySelector(':scope > h2');
    root.insertBefore(bar, h2 ? h2.nextSibling : root.firstChild);
    TABS.forEach(function (t) {
      var d = document.createElement('div');
      d.id = 'acxUMPane_' + t[0];
      d.style.display = 'none';
      panes[t[0]] = d;
      root.appendChild(d);
    });
    route();
    new MutationObserver(route).observe(root, { childList: true });
    buildUsersToolbar();
    buildPerms();
    var saved = '';
    try { saved = sessionStorage.getItem(TAB_KEY) || ''; } catch (e) {}
    setTab(panes[saved] ? saved : 'users');
  }

  /* anything the app appends to the page later (roles table, buy-more-users box, invites) is routed to the right tab */
  function route() {
    var root = $('userManagementTab');
    if (!root) return;
    var h2 = root.querySelector(':scope > h2');
    Array.prototype.slice.call(root.children).forEach(function (k) {
      if (k === h2 || k === bar || k.id.indexOf('acxUMPane_') === 0) return;
      if (k.id === 'acxRolesV2') {
        panes.roles.appendChild(k);
        watchRoles(k);
        decorateRoles();
      } else {
        panes.users.appendChild(k);
      }
    });
  }

  function setTab(name) {
    if (!panes[name]) name = 'users';
    active = name;
    try { sessionStorage.setItem(TAB_KEY, name); } catch (e) {}
    TABS.forEach(function (t) { panes[t[0]].style.display = t[0] === name ? '' : 'none'; });
    Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) {
      b.className = b.getAttribute('data-acxum-tab') === name ? 'on' : '';
    });
    if (name === 'users') decorateUsers();
    if (name === 'roles') { try { if (API()) API().renderRoles(); } catch (e) {} decorateRoles(); }
    if (name === 'perms') renderPerms(true);
  }

  /* ---------- USERS tab ---------- */
  function buildUsersToolbar() {
    if ($('acxumUserSearch')) return;
    var tb = document.createElement('div');
    tb.style.cssText = 'display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap';
    tb.innerHTML = '<input id="acxumUserSearch" class="p-2 border rounded" style="min-width:240px" placeholder="Search users by name, email or role">' +
      '<select id="acxumUserStatus" class="p-2 border rounded"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Deactivated</option></select>' +
      '<span id="acxumUserCount" class="text-sm text-gray-600"></span>';
    var tc = $('userTableContainer');
    if (tc && tc.parentNode) tc.parentNode.insertBefore(tb, tc);
    else panes.users.insertBefore(tb, panes.users.firstChild);
  }

  function badge(u) {
    return u.status === 'inactive'
      ? '<span class="acxum-badge off">Deactivated</span>'
      : '<span class="acxum-badge ok">Active</span>';
  }

  function decorateUsers() {
    var body = $('userTableBody');
    if (!body) return;
    var table = body.closest('table');
    var hr = table && table.querySelector('thead tr');
    if (hr && !hr.querySelector('.acxum-sth')) {
      var th = document.createElement('th');
      th.className = 'border p-2 text-left acxum-sth';
      th.textContent = 'Status';
      hr.insertBefore(th, hr.children[4] || null);
    }
    var list = allUsers();
    Array.prototype.forEach.call(body.children, function (tr) {
      if (tr.classList.contains('permission-preview-row')) {
        var c = tr.firstElementChild;
        if (c && c.getAttribute('colspan') === '4') c.setAttribute('colspan', '5');
        return;
      }
      if (tr.getAttribute('data-acx-um')) return;
      var eb = tr.querySelector('button[onclick^="openCreateUserModal("]');
      var m = eb && eb.getAttribute('onclick').match(/\((\d+)\)/);
      if (!m) return;
      var idx = +m[1], u = list[idx];
      if (!u) return;
      tr.setAttribute('data-acx-um', '1');
      var td = document.createElement('td');
      td.className = 'border p-2';
      td.innerHTML = badge(u);
      tr.insertBefore(td, tr.children[4] || null);
      if (u.status === 'inactive') tr.style.opacity = '.65';
      var acts = tr.lastElementChild;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = eb.className;
      b.setAttribute('data-acxum-toggle', idx);
      b.textContent = u.status === 'inactive' ? 'Activate' : 'Deactivate';
      var del = acts.querySelector('button[onclick^="deleteUser("]');
      acts.insertBefore(b, del || null);
      tr.setAttribute('data-acx-status', u.status === 'inactive' ? 'inactive' : 'active');
    });
    filterUsers();
  }

  function filterUsers() {
    var body = $('userTableBody');
    if (!body) return;
    var q = ($('acxumUserSearch') && $('acxumUserSearch').value || '').toLowerCase().trim();
    var st = $('acxumUserStatus') && $('acxumUserStatus').value;
    var shown = 0, total = 0;
    Array.prototype.forEach.call(body.children, function (tr) {
      if (tr.classList.contains('permission-preview-row')) return;
      total++;
      var ok = (!q || tr.textContent.toLowerCase().indexOf(q) > -1) && (!st || tr.getAttribute('data-acx-status') === st);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    var c = $('acxumUserCount');
    if (c) c.textContent = shown + ' of ' + total + ' user(s)';
  }

  function toggleActive(idx) {
    var list = allUsers(), u = list[idx];
    if (!u) return;
    var going = u.status !== 'inactive';
    if (going) {
      if (isSelf(u)) { alert('🚫 You cannot deactivate your own account.'); return; }
      if (String(u.role || '').toLowerCase() === 'admin' && !activeAdmins(list, u)) { alert('🚫 A company must keep at least one active Admin.'); return; }
      if (!confirm('Deactivate "' + (u.username || u.email) + '"?\n\nThey will not be able to sign in until you activate them again. Their data and history are kept.')) return;
      u.status = 'inactive';
      u.deactivatedAt = new Date().toISOString();
    } else {
      u.status = 'active';
      delete u.deactivatedAt;
    }
    saveUsers(list);
    log(going ? 'Deactivate' : 'Activate', (going ? 'Deactivated ' : 'Activated ') + (u.username || u.email));
    refreshUsers();
    if (active === 'perms') renderPerms(true);
  }

  /* a deactivated user who is already signed in is signed out on the next load */
  function enforceSession() {
    try {
      var c = me();
      if (!c || !c.email) return;
      var rec = allUsers().filter(function (u) { return sameEmail(u.email, c.email) && String(u.companyId || '') === String(c.companyId || ''); })[0];
      if (rec && rec.status === 'inactive') {
        alert('🚫 This account has been deactivated. Please contact your administrator.');
        if (typeof logout === 'function') logout();
      }
    } catch (e) {}
  }

  /* ---------- ROLES tab ---------- */
  var rolesObs = null;
  function watchRoles(el) {
    if (rolesObs) rolesObs.disconnect();
    rolesObs = new MutationObserver(decorateRoles);
    rolesObs.observe(el, { childList: true });
  }

  function decorateRoles() {
    var el = $('acxRolesV2');
    if (!el) return;
    var h = el.querySelector('h3');
    if (h && h.textContent.indexOf('Permissions') > -1) h.textContent = '🛡️ Roles';
    var p = el.querySelector('p');
    if (p && !p.getAttribute('data-acxum')) {
      p.setAttribute('data-acxum', '1');
      p.textContent = 'Create roles, assign users to them and manage what each role is responsible for. Use the Permissions tab to fine-tune module access for a role or an individual user.';
    }
    Array.prototype.forEach.call(el.querySelectorAll('button[data-acx-role="view"]'), function (eb) {
      var cell = eb.parentNode;
      if (cell.querySelector('[data-acxum-assign]')) return;
      var id = eb.getAttribute('data-id');
      var a = document.createElement('button');
      a.type = 'button';
      a.className = eb.className;
      a.setAttribute('data-acxum-assign', id);
      a.textContent = '👥 Assign';
      cell.insertBefore(a, eb.nextSibling);
      var pm = document.createElement('button');
      pm.type = 'button';
      pm.className = eb.className;
      pm.setAttribute('data-acxum-roleperms', id);
      pm.textContent = '🔐 Permissions';
      cell.insertBefore(pm, a.nextSibling);
    });
  }

  function closeAssign() { var m = $('acxUMAssign'); if (m) m.remove(); }

  function openAssign(roleId) {
    var api = API();
    var role = api && api.findRole(roleId);
    if (!role) { alert('Role not found.'); return; }
    closeAssign();
    var list = allUsers(), rows = [];
    list.forEach(function (u, i) { if (String(u.companyId || '') === cid()) rows.push({ u: u, i: i }); });
    var m = document.createElement('div');
    m.id = 'acxUMAssign';
    var items = rows.map(function (r) {
      var cur = String(r.u.role || '').toLowerCase() === String(role.id).toLowerCase();
      var self = isSelf(r.u);
      var curName = (api.findRole(r.u.role) || {}).name || (r.u.role === 'custom' ? r.u.customRole : r.u.role) || '';
      return '<label class="acxum-row" data-t="' + esc((r.u.username + ' ' + (r.u.email || '') + ' ' + curName).toLowerCase()) + '" style="display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid #f3f4f6">' +
        '<input type="checkbox" data-i="' + r.i + '"' + (cur ? ' checked disabled' : '') + (self && !cur ? ' disabled title="You cannot change your own role"' : '') + '>' +
        '<span style="flex:1"><b>' + esc(r.u.username) + '</b><br><span style="font-size:12px;color:#6b7280">' + esc(r.u.email || '') + '</span></span>' +
        '<span style="font-size:12px;color:#6b7280">' + (cur ? 'In this role' : esc(curName)) + '</span></label>';
    }).join('') || '<div style="padding:12px;color:#6b7280">No users in this company yet.</div>';
    m.innerHTML = '<div class="box"><div style="padding:14px 18px;border-bottom:1px solid #e5e7eb"><h3 class="text-sm font-bold">👥 Assign users to ' + esc(role.name) + '</h3>' +
      '<p style="font-size:12px;color:#6b7280;margin:4px 0 8px">Ticked users get this role and its permissions. A user has one role, so assigning moves them out of their current role. To take someone out of this role, assign them to another role.</p>' +
      '<input id="acxumAssignSearch" class="p-2 border rounded w-full" placeholder="Search users"></div>' +
      '<div id="acxumAssignList" style="padding:6px 18px;overflow:auto;flex:1">' + items + '</div>' +
      '<div style="padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" class="acxum-btn alt" data-acxum-assign-close>Close</button>' +
      '<button type="button" class="acxum-btn" data-acxum-assign-save="' + esc(role.id) + '">Assign selected</button></div></div>';
    document.body.appendChild(m);
  }

  function saveAssign(roleId) {
    var api = API(), role = api && api.findRole(roleId);
    if (!role) return;
    var list = allUsers(), n = 0, blocked = [];
    Array.prototype.forEach.call(document.querySelectorAll('#acxumAssignList input[type=checkbox]:checked:not(:disabled)'), function (cb) {
      var u = list[+cb.getAttribute('data-i')];
      if (!u) return;
      var wasAdmin = String(u.role || '').toLowerCase() === 'admin';
      if (wasAdmin && String(role.id).toLowerCase() !== 'admin' && !activeAdmins(list, u)) { blocked.push(u.username); return; }
      u.role = role.id;
      u.customRole = null;
      u.permissions = clone(role.permissions);
      u.modules = modsOf(role.permissions);
      n++;
    });
    if (n) {
      saveUsers(list);
      log('Assign Role', 'Assigned ' + n + ' user(s) to role ' + role.name);
      refreshUsers();
      try { api.renderRoles(); } catch (e) {}
    }
    closeAssign();
    if (blocked.length) alert('Not moved (a company must keep at least one Admin): ' + blocked.join(', '));
    else if (!n) alert('No users were selected.');
  }

  /* ---------- PERMISSIONS tab ---------- */
  function buildPerms() {
    var pane = panes.perms;
    pane.innerHTML =
      '<h3 class="text-sm font-bold mb-1">🔐 Permissions</h3>' +
      '<p class="text-xs text-gray-600 mb-2">Control which modules open and what can be done in each. Edit a whole role (everyone in it is updated) or a single user (overrides their role).</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
      '<select id="acxumPType" class="p-2 border rounded"><option value="role">Role</option><option value="user">Individual user</option></select>' +
      '<select id="acxumPTarget" class="p-2 border rounded" style="min-width:220px"></select>' +
      '<input id="acxumPSearch" class="p-2 border rounded" placeholder="Filter modules" style="min-width:180px">' +
      '<button type="button" class="acxum-btn" data-acxum-psave>💾 Save</button>' +
      '<button type="button" class="acxum-btn alt" data-acxum-pdiscard>Discard changes</button>' +
      '<button type="button" class="acxum-btn alt" data-acxum-preset style="display:none">Reset to role defaults</button>' +
      '<span id="acxumPState" class="text-sm text-gray-600"></span></div>' +
      '<div id="acxumPSummary" class="text-sm mb-2"></div>' +
      '<div id="acxumMatrixWrap"></div>';
  }

  function targets() {
    var api = API(), out = [];
    if (P.type === 'role') {
      (api ? api.allRoles() : []).forEach(function (r) { out.push([String(r.id), r.name + (r.builtin ? ' (built-in)' : '')]); });
    } else {
      allUsers().forEach(function (u, i) {
        if (String(u.companyId || '') === cid()) out.push([String(i), (u.username || u.email) + (u.status === 'inactive' ? ' (deactivated)' : '')]);
      });
    }
    return out;
  }

  function loadTarget() {
    var api = API(), list = targets();
    var sel = $('acxumPTarget');
    if (!sel) return;
    if (!list.some(function (t) { return t[0] === P.id; })) P.id = list[0] ? list[0][0] : '';
    sel.innerHTML = list.map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === P.id ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('');
    P.perms = null;
    if (P.type === 'role') {
      var r = api && api.findRole(P.id);
      P.perms = normalise(r ? r.permissions : {});
    } else {
      var u = allUsers()[+P.id];
      var base = u && u.permissions;
      if (u && (!base || !Object.keys(base).length)) {
        var rr = api && api.findRole(u.role);
        base = rr ? rr.permissions : {};
        if (!rr && u.modules) { base = {}; u.modules.forEach(function (m) { base[m] = Object.assign(blankSet(), { view: true }); }); }
      }
      P.perms = normalise(base || {});
    }
    P.dirty = false;
  }

  function renderPerms(reload) {
    if (!$('acxumPType')) return;
    $('acxumPType').value = P.type;
    if (reload || !P.perms) loadTarget();
    $('acxumPTarget').value = P.id;
    var rbtn = document.querySelector('[data-acxum-preset]');
    if (rbtn) rbtn.style.display = P.type === 'user' ? '' : 'none';
    drawMatrix();
  }

  function drawMatrix() {
    var wrap = $('acxumMatrixWrap');
    if (!wrap) return;
    if (!P.id || !P.perms) { wrap.innerHTML = '<div style="padding:14px;color:#6b7280">Nothing to show yet.</div>'; $('acxumPSummary').innerHTML = ''; return; }
    var acts = actions(), q = ($('acxumPSearch').value || '').toLowerCase().trim();
    var admin = P.type === 'role' && String(P.id).toLowerCase() === 'admin';
    var h = '<table id="acxumMatrix"><thead><tr><th><label><input type="checkbox" class="acxum-all" data-a="all"> Module</label></th>';
    acts.forEach(function (a) { h += '<th><input type="checkbox" class="acxum-all" data-a="' + a.key + '"><br>' + esc(a.label) + '</th>'; });
    h += '</tr></thead><tbody>';
    groups().forEach(function (g, gi) {
      var mods = g.modules.filter(function (m) { return !q || fmt(m).toLowerCase().indexOf(q) > -1 || g.label.toLowerCase().indexOf(q) > -1; });
      if (!mods.length) return;
      h += '<tr class="grp"><td colspan="' + (acts.length + 1) + '"><label><input type="checkbox" class="acxum-grp" data-g="' + gi + '"> 📁 ' + esc(g.label) + '</label></td></tr>';
      mods.forEach(function (m) {
        h += '<tr data-m="' + esc(m) + '"><td><label><input type="checkbox" class="acxum-row" data-m="' + esc(m) + '"> ' + esc(fmt(m)) + '</label></td>';
        acts.forEach(function (a) {
          var on = P.perms[m] && P.perms[m][a.key];
          h += '<td class="c"><input type="checkbox" class="acxum-cell" data-m="' + esc(m) + '" data-a="' + a.key + '"' + (on ? ' checked' : '') + '></td>';
        });
        h += '</tr>';
      });
    });
    h += '</tbody></table>';
    wrap.innerHTML = h;
    if (admin) $('acxumPState').textContent = 'Admin keeps full access. Edits to this role are allowed but take care.';
    syncChecks();
    summary();
  }

  function visibleCells(sel) { return $('acxumMatrixWrap').querySelectorAll(sel); }

  function syncChecks() {
    var wrap = $('acxumMatrixWrap');
    if (!wrap) return;
    function state(list) {
      var on = 0;
      list.forEach(function (c) { if (c.checked) on++; });
      return [list.length && on === list.length, on > 0 && on < list.length];
    }
    function set(el, st) { el.checked = !!st[0]; el.indeterminate = !!st[1]; }
    Array.prototype.forEach.call(wrap.querySelectorAll('.acxum-row'), function (r) {
      set(r, state(Array.prototype.slice.call(wrap.querySelectorAll('.acxum-cell[data-m="' + r.getAttribute('data-m') + '"]'))));
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('.acxum-grp'), function (g) {
      var mods = groups()[+g.getAttribute('data-g')].modules, cells = [];
      mods.forEach(function (m) { Array.prototype.forEach.call(wrap.querySelectorAll('.acxum-cell[data-m="' + m + '"]'), function (c) { cells.push(c); }); });
      set(g, state(cells));
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('.acxum-all'), function (c) {
      var a = c.getAttribute('data-a');
      set(c, state(Array.prototype.slice.call(wrap.querySelectorAll(a === 'all' ? '.acxum-cell' : '.acxum-cell[data-a="' + a + '"]'))));
    });
  }

  function summary() {
    var el = $('acxumPSummary');
    if (!el || !P.perms) return;
    var mods = modsOf(P.perms).length, total = moduleIds().length;
    el.innerHTML = '<b>' + mods + '</b> of ' + total + ' modules can be opened.' + (P.dirty ? ' <span style="color:#b45309;font-weight:600">● Unsaved changes</span>' : '');
  }

  function setCell(m, a, v) {
    if (!P.perms[m]) P.perms[m] = blankSet();
    P.perms[m][a] = !!v;
    if (v && a !== 'view') P.perms[m].view = true;       /* any action needs the module to open */
    if (!v && a === 'view') actions().forEach(function (x) { P.perms[m][x.key] = false; });
  }

  function onMatrixChange(t) {
    var wrap = $('acxumMatrixWrap');
    var v = t.checked, ms;
    if (t.classList.contains('acxum-cell')) {
      setCell(t.getAttribute('data-m'), t.getAttribute('data-a'), v);
    } else if (t.classList.contains('acxum-row')) {
      var m = t.getAttribute('data-m');
      actions().forEach(function (a) { setCell(m, a.key, v); });
    } else if (t.classList.contains('acxum-grp')) {
      groups()[+t.getAttribute('data-g')].modules.forEach(function (m) {
        if (!wrap.querySelector('tr[data-m="' + m + '"]')) return;       /* only rows currently shown */
        actions().forEach(function (a) { setCell(m, a.key, v); });
      });
    } else if (t.classList.contains('acxum-all')) {
      var key = t.getAttribute('data-a');
      Array.prototype.forEach.call(wrap.querySelectorAll('tr[data-m]'), function (tr) {
        var m = tr.getAttribute('data-m');
        if (key === 'all') actions().forEach(function (a) { setCell(m, a.key, v); });
        else setCell(m, key, v);
      });
    } else return;
    P.dirty = true;
    /* reflect forced changes (view auto-on/off) in the visible cells */
    Array.prototype.forEach.call(wrap.querySelectorAll('.acxum-cell'), function (c) {
      var on = !!(P.perms[c.getAttribute('data-m')] && P.perms[c.getAttribute('data-m')][c.getAttribute('data-a')]);
      if (c.checked !== on) c.checked = on;
    });
    syncChecks();
    summary();
  }

  function savePerms() {
    var api = API();
    if (!P.id || !P.perms) return;
    var perms = clone(P.perms), mods = modsOf(perms), list = allUsers();
    if (P.type === 'role') {
      var role = api && api.findRole(P.id);
      if (!role) { alert('Role not found.'); return; }
      var count = api.roleUserCount(role.id);
      if (count && !confirm('Save permissions for "' + role.name + '"?\n\n' + count + ' user(s) in this role will be updated. Any individual permission changes on them will be replaced.')) return;
      if (role.builtin) {
        var o = api.builtinOverrides();
        o[role.id] = { description: role.description, permissions: perms };
        api.saveBuiltinOverrides(o);
      } else {
        api.saveCustom(api.customRoles().map(function (r) {
          return String(r.id).toLowerCase() === String(role.id).toLowerCase() ? Object.assign({}, r, { permissions: perms }) : r;
        }));
      }
      list.forEach(function (u) {
        if (String(u.companyId || '') === cid() && String(u.role || '').toLowerCase() === String(role.id).toLowerCase()) {
          u.permissions = clone(perms);
          u.modules = mods.slice();
        }
      });
      saveUsers(list);
      log('Edit Permissions', 'Updated permissions for role ' + role.name);
      try { api.renderRoles(); api.syncDropdown(); } catch (e) {}
    } else {
      var u = list[+P.id];
      if (!u) return;
      u.permissions = perms;
      u.modules = mods;
      saveUsers(list);
      log('Edit Permissions', 'Updated permissions for user ' + (u.username || u.email));
      /* if this is the signed-in user, keep the live session in step */
      try { if (isSelf(u)) { var cu = me(); cu.permissions = clone(perms); cu.modules = mods.slice(); localStorage.setItem('loggedInUser', JSON.stringify(cu)); } } catch (e) {}
    }
    refreshUsers();
    P.dirty = false;
    summary();
    var st = $('acxumPState');
    if (st) { st.textContent = '✅ Saved'; setTimeout(function () { if (st.textContent === '✅ Saved') st.textContent = ''; }, 2500); }
  }

  function resetUserToRole() {
    var api = API(), u = allUsers()[+P.id];
    var r = u && api && api.findRole(u.role);
    if (!r) { alert('This user has no matching role to copy from.'); return; }
    if (!confirm('Replace this user\'s permissions with the "' + r.name + '" role defaults? (Not saved until you click Save.)')) return;
    P.perms = normalise(r.permissions);
    P.dirty = true;
    drawMatrix();
  }

  function guardLeave() {
    if (P.dirty && !confirm('You have unsaved permission changes. Discard them?')) return false;
    P.dirty = false;
    return true;
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-acxum-tab],[data-acxum-toggle],[data-acxum-assign],[data-acxum-roleperms],[data-acxum-assign-close],[data-acxum-assign-save],[data-acxum-psave],[data-acxum-pdiscard],[data-acxum-preset]') : null;
    if (!t) return;
    if (t.hasAttribute('data-acxum-tab')) {
      var next = t.getAttribute('data-acxum-tab');
      if (active === 'perms' && next !== 'perms' && !guardLeave()) return;
      setTab(next);
    } else if (t.hasAttribute('data-acxum-toggle')) toggleActive(+t.getAttribute('data-acxum-toggle'));
    else if (t.hasAttribute('data-acxum-assign')) openAssign(t.getAttribute('data-acxum-assign'));
    else if (t.hasAttribute('data-acxum-roleperms')) {
      if (!guardLeave()) return;
      P.type = 'role'; P.id = t.getAttribute('data-acxum-roleperms');
      setTab('perms'); renderPerms(true);
    } else if (t.hasAttribute('data-acxum-assign-close')) closeAssign();
    else if (t.hasAttribute('data-acxum-assign-save')) saveAssign(t.getAttribute('data-acxum-assign-save'));
    else if (t.hasAttribute('data-acxum-psave')) savePerms();
    else if (t.hasAttribute('data-acxum-pdiscard')) { P.dirty = false; renderPerms(true); }
    else if (t.hasAttribute('data-acxum-preset')) resetUserToRole();
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.id && !t.classList) return;
    if (t.id === 'acxumPType') {
      if (!guardLeave()) { t.value = P.type; return; }
      P.type = t.value; P.id = ''; renderPerms(true);
    } else if (t.id === 'acxumPTarget') {
      if (!guardLeave()) { t.value = P.id; return; }
      P.id = t.value; renderPerms(true);
    } else if (t.id === 'acxumUserStatus') filterUsers();
    else if (t.classList && t.closest && t.closest('#acxumMatrixWrap')) onMatrixChange(t);
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'acxumUserSearch') filterUsers();
    else if (t.id === 'acxumPSearch') drawMatrix();
    else if (t.id === 'acxumAssignSearch') {
      var q = t.value.toLowerCase().trim();
      Array.prototype.forEach.call(document.querySelectorAll('#acxumAssignList .acxum-row'), function (r) {
        r.style.display = !q || r.getAttribute('data-t').indexOf(q) > -1 ? 'flex' : 'none';
      });
    }
  });

  /* ---------- boot ---------- */
  function boot() {
    build();
    var body = $('userTableBody');
    if (body && !body.getAttribute('data-acx-um-obs')) {
      body.setAttribute('data-acx-um-obs', '1');
      new MutationObserver(decorateUsers).observe(body, { childList: true });
      decorateUsers();
    }
    var root = $('userManagementTab');
    if (root && !root.getAttribute('data-acx-um-vis')) {
      root.setAttribute('data-acx-um-vis', '1');
      new MutationObserver(function () {
        if (!root.classList.contains('hidden')) {
          if (active === 'users') decorateUsers();
          if (active === 'roles') decorateRoles();
          if (active === 'perms' && !P.dirty) renderPerms(true);
        }
      }).observe(root, { attributes: true, attributeFilter: ['class'] });
    }
  }
  function init() { boot(); setTimeout(boot, 600); setTimeout(boot, 2000); setTimeout(enforceSession, 2500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();

/* Acacia Books - Data Center with 3 navigation tabs
   💾 Backup & Restore   existing backup, restore, storage usage and backup history
   📋 User Activity      the audit trail (moved in from the old User Activity page)
   📊 Activity Analytics activity reports, user statistics, trends and usage analytics */
(function () {
  'use strict';
  if (window.__acxDCTabs) return;
  window.__acxDCTabs = true;

  var KEY = 'acxDCActiveTab';
  var TABS = [['backup', '💾 Backup & Restore'], ['activity', '📋 User Activity'], ['analytics', '📊 Activity Analytics']];
  var panes = {}, bar = null, active = 'backup', pending = null, anBuilt = false;
  var A = { period: '30', user: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function acts() {
    try { if (typeof userActivities !== 'undefined' && Array.isArray(userActivities)) return userActivities; } catch (e) {}
    return jget('userActivities', []);
  }
  function isAdmin() { try { return String((jget('loggedInUser', {}) || {}).role || '').toLowerCase() === 'admin'; } catch (e) { return false; } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }

  function addStyle() {
    if ($('acxDCStyle')) return;
    var st = document.createElement('style');
    st.id = 'acxDCStyle';
    st.textContent =
      '#acxDCBar{display:flex;gap:6px;flex-wrap:wrap;border-bottom:2px solid #1e3a8a;margin:8px 0 14px}' +
      '#acxDCBar button{padding:7px 16px;border:1px solid #1e3a8a;border-bottom:none;border-radius:6px 6px 0 0;background:#fff;color:#1e3a8a;font-weight:700;font-size:13px;cursor:pointer}' +
      '#acxDCBar button.on{background:#1e3a8a;color:#fff}' +
      '.acxdc-btn{border:1px solid #1e3a8a;background:#1e3a8a;color:#fff;font-weight:700;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:13px}' +
      '.acxdc-btn.alt{background:#fff;color:#1e3a8a}.acxdc-btn:hover{opacity:.9}' +
      '.acxdc-cards{display:flex;gap:10px;flex-wrap:wrap}' +
      '.acxdc-card{border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;background:#fff;min-width:150px;flex:1}' +
      '.acxdc-card .l{font-size:12px;color:#6b7280}.acxdc-card .v{font-size:20px;font-weight:700;color:#1e3a8a;margin-top:2px;word-break:break-word}' +
      '.acxdc-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}' +
      '.acxdc-sec{border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;margin-top:12px}' +
      '.acxdc-sec h4{font-size:13px;font-weight:700;color:#1e3a8a;margin-bottom:8px}' +
      '.acxdc-hb{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px}' +
      '.acxdc-hb .n{width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.acxdc-hb .t{flex:1;background:#f3f4f6;border-radius:4px;height:14px;overflow:hidden}' +
      '.acxdc-hb .t i{display:block;height:100%;background:#1e3a8a}' +
      '.acxdc-hb .c{width:42px;text-align:right;color:#374151}' +
      '#acxDCUsers{width:100%;border-collapse:collapse;font-size:13px}' +
      '#acxDCUsers th,#acxDCUsers td{border:1px solid #e5e7eb;padding:5px 8px;text-align:left}' +
      '#acxDCUsers th{background:#f3f4f6}#acxDCUsers td.n{text-align:right}';
    document.head.appendChild(st);
  }

  /* ---------- tab shell ---------- */
  function build() {
    var root = $('DatacenterTab');
    if (!root || root.getAttribute('data-acx-dc')) return;
    root.setAttribute('data-acx-dc', '1');
    addStyle();
    bar = document.createElement('div');
    bar.id = 'acxDCBar';
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-acxdc-tab', t[0]);
      b.textContent = t[1];
      bar.appendChild(b);
    });
    var h2 = root.querySelector(':scope > h2');
    root.insertBefore(bar, h2 ? h2.nextSibling : root.firstChild);
    TABS.forEach(function (t) {
      var d = document.createElement('div');
      d.id = 'acxDCPane_' + t[0];
      d.style.display = 'none';
      panes[t[0]] = d;
      root.appendChild(d);
    });
    function sweep() {
      Array.prototype.slice.call(root.children).forEach(function (k) {
        if (k === h2 || k === bar || k.id.indexOf('acxDCPane_') === 0) return;
        panes.backup.appendChild(k);
      });
    }
    sweep();
    new MutationObserver(sweep).observe(root, { childList: true });

    /* the old User Activity page moves in here, ids kept so its code keeps working */
    var ua = $('userActivityTab');
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px';
    head.innerHTML = '<h3 class="text-sm font-bold">📋 User Activity Audit Trail</h3><div style="display:flex;gap:8px">' +
      '<button type="button" class="acxdc-btn alt" data-acxdc-act="export">⬇️ Export CSV</button>' +
      (isAdmin() ? '<button type="button" class="acxdc-btn alt" data-acxdc-act="clear">🗑️ Clear log</button>' : '') + '</div>';
    panes.activity.appendChild(head);
    if (ua) Array.prototype.slice.call(ua.children).forEach(function (k) {
      if (k.tagName === 'H2') return;
      panes.activity.appendChild(k);
    });

    buildAnalytics();
    var saved = '';
    try { saved = sessionStorage.getItem(KEY) || ''; } catch (e) {}
    setDC(panes[saved] ? saved : 'backup');
  }

  function setDC(name) {
    if (!panes[name]) name = 'backup';
    active = name;
    try { sessionStorage.setItem(KEY, name); } catch (e) {}
    TABS.forEach(function (t) { panes[t[0]].style.display = t[0] === name ? '' : 'none'; });
    Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) {
      b.className = b.getAttribute('data-acxdc-tab') === name ? 'on' : '';
    });
    if (name === 'backup') { try { if (typeof renderBackupHistory === 'function') renderBackupHistory(); } catch (e) {} }
    if (name === 'activity') { fillActionFilter(); try { if (typeof loadUserActivity === 'function') loadUserActivity(); } catch (e) {} }
    if (name === 'analytics') renderAnalytics();
  }

  function onShow() {
    build();
    if (!bar) return;
    var want = pending;
    pending = null;
    setDC(want || active);
  }

  /* the old sidebar entry now opens Data Center on its User Activity tab */
  function wrapShowTab() {
    if (window.__acxDCWrapped || typeof window.showTab !== 'function') return;
    var orig = window.showTab;
    window.showTab = function (t) {
      var a = arguments;
      if (t === 'userActivityTab') { pending = 'activity'; a = ['DatacenterTab']; }
      var r = orig.apply(this, a);
      if (String(a[0]) === 'DatacenterTab') setTimeout(onShow, 0);
      return r;
    };
    window.__acxDCWrapped = true;
  }
  function hideOldEntry() {
    Array.prototype.forEach.call(document.querySelectorAll('button[onclick*="userActivityTab"]'), function (b) {
      var li = b.closest('li');
      if (li) li.style.display = 'none';
    });
  }

  /* ---------- User Activity tab helpers ---------- */
  function fillActionFilter() {
    var sel = $('actionFilter');
    if (!sel) return;
    var have = {};
    Array.prototype.forEach.call(sel.options, function (o) { have[o.value] = 1; });
    var seen = {};
    acts().forEach(function (r) { if (r.action && !have[r.action]) seen[r.action] = 1; });
    Object.keys(seen).sort().forEach(function (a) {
      var o = document.createElement('option');
      o.value = a; o.textContent = a;
      sel.appendChild(o);
    });
  }

  /* ---------- Activity Analytics tab ---------- */
  function buildAnalytics() {
    var p = panes.analytics;
    p.innerHTML =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">' +
      '<h3 class="text-sm font-bold" style="margin-right:8px">📊 Activity Analytics</h3>' +
      '<select id="acxdcPeriod" class="p-1 border rounded text-sm"><option value="today">Today</option><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="year">This year</option><option value="all">All time</option></select>' +
      '<select id="acxdcUser" class="p-1 border rounded text-sm"><option value="">All users</option></select>' +
      '<button type="button" class="acxdc-btn alt" data-acxdc-act="csv-users">⬇️ User summary CSV</button>' +
      '<button type="button" class="acxdc-btn alt" data-acxdc-act="csv-trend">⬇️ Trend CSV</button>' +
      '<button type="button" class="acxdc-btn" data-acxdc-act="print">🖨️ Print report</button></div>' +
      '<div id="acxdcAnBody"></div>';
    anBuilt = true;
  }

  function periodStart() {
    var now = new Date(), p = A.period;
    if (p === 'all') return null;
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (p === 'year') return new Date(now.getFullYear(), 0, 1);
    if (p === 'today') return d;
    d.setDate(d.getDate() - (+p - 1));
    return d;
  }

  function category(a) {
    a = String(a || '').toLowerCase();
    if (/log ?out|sign ?out/.test(a)) return 'logout';
    if (/log ?in|sign ?in/.test(a)) return 'login';
    if (/delet|remov|clear/.test(a)) return 'deleted';
    if (/approv/.test(a)) return 'approved';
    if (/creat|add|new|post/.test(a)) return 'created';
    if (/edit|updat|modif|chang/.test(a)) return 'edited';
    return 'other';
  }

  function compute() {
    var from = periodStart(), all = acts(), rows = [];
    var userSel = $('acxdcUser');
    all.forEach(function (r) {
      var d = new Date(r.dateTime);
      if (isNaN(d)) return;
      if (from && d < from) return;
      if (A.user && (r.employee || '') !== A.user) return;
      rows.push({ r: r, d: d });
    });
    var S = { rows: rows, total: rows.length, users: {}, actions: {}, modules: {}, days: {}, hours: [], wdays: [], first: null };
    for (var i = 0; i < 24; i++) S.hours.push(0);
    for (i = 0; i < 7; i++) S.wdays.push(0);
    rows.forEach(function (x) {
      var r = x.r, u = r.employee || 'Unknown';
      var U = S.users[u] || (S.users[u] = { name: u, role: r.role || '', total: 0, login: 0, created: 0, edited: 0, deleted: 0, approved: 0, other: 0, logout: 0, last: null });
      U.total++;
      U[category(r.action)]++;
      if (!U.last || x.d > U.last) { U.last = x.d; U.role = r.role || U.role; }
      S.actions[r.action || 'Unknown'] = (S.actions[r.action || 'Unknown'] || 0) + 1;
      S.modules[r.module || 'Unknown'] = (S.modules[r.module || 'Unknown'] || 0) + 1;
      S.days[dayKey(x.d)] = (S.days[dayKey(x.d)] || 0) + 1;
      S.hours[x.d.getHours()]++;
      S.wdays[x.d.getDay()]++;
      if (!S.first || x.d < S.first) S.first = x.d;
    });
    var start = from || S.first || new Date();
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var today = new Date();
    S.spanDays = Math.max(1, Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - start) / 864e5) + 1);
    var trend = [];
    if (S.spanDays > 92) {
      var m = new Date(start.getFullYear(), start.getMonth(), 1), counts = {};
      rows.forEach(function (x) { counts[monKey(x.d)] = (counts[monKey(x.d)] || 0) + 1; });
      while (m <= today) { trend.push([monKey(m), counts[monKey(m)] || 0]); m.setMonth(m.getMonth() + 1); }
      S.trendUnit = 'month';
    } else {
      var d0 = new Date(start);
      for (i = 0; i < S.spanDays; i++) { trend.push([dayKey(d0), S.days[dayKey(d0)] || 0]); d0.setDate(d0.getDate() + 1); }
      S.trendUnit = 'day';
    }
    S.trend = trend;
    return S;
  }

  function topList(map, n) {
    return Object.keys(map).map(function (k) { return [k, map[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 10);
  }

  function hbars(list) {
    if (!list.length) return '<div style="color:#6b7280;font-size:13px">No data.</div>';
    var max = Math.max.apply(null, list.map(function (x) { return x[1]; })) || 1;
    return list.map(function (x) {
      return '<div class="acxdc-hb"><span class="n" title="' + esc(x[0]) + '">' + esc(x[0]) + '</span><span class="t"><i style="width:' + Math.max(2, Math.round(100 * x[1] / max)) + '%"></i></span><span class="c">' + x[1] + '</span></div>';
    }).join('');
  }

  function barSvg(vals, labels) {
    var W = 700, H = 170, pl = 30, pb = 22, pt = 10, n = vals.length || 1;
    var max = Math.max.apply(null, vals.concat([1])), bw = (W - pl) / n, ch = H - pb - pt;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto"><line x1="' + pl + '" y1="' + (H - pb) + '" x2="' + W + '" y2="' + (H - pb) + '" stroke="#d1d5db"/>' +
      '<text x="' + (pl - 4) + '" y="' + (pt + 8) + '" font-size="10" text-anchor="end" fill="#6b7280">' + max + '</text>' +
      '<text x="' + (pl - 4) + '" y="' + (H - pb) + '" font-size="10" text-anchor="end" fill="#6b7280">0</text>';
    var step = Math.ceil(n / 8);
    vals.forEach(function (v, i) {
      var h = ch * v / max, x = pl + i * bw;
      s += '<rect x="' + (x + bw * 0.1).toFixed(1) + '" y="' + (H - pb - h).toFixed(1) + '" width="' + Math.max(1, bw * 0.8).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="#1e3a8a" rx="1"><title>' + esc(labels[i]) + ': ' + v + '</title></rect>';
      if (i % step === 0) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="#6b7280">' + esc(String(labels[i]).slice(-5)) + '</text>';
    });
    return s + '</svg>';
  }

  function fmtDT(d) { return d ? d.toLocaleString() : '-'; }

  function renderAnalytics() {
    if (!anBuilt) return;
    var sel = $('acxdcUser');
    if (sel) {
      var names = {};
      acts().forEach(function (r) { if (r.employee) names[r.employee] = 1; });
      var cur = A.user;
      sel.innerHTML = '<option value="">All users</option>' + Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    }
    $('acxdcPeriod').value = A.period;
    var S = compute(), body = $('acxdcAnBody');
    if (!S.total) { body.innerHTML = '<div class="acxdc-sec" style="color:#6b7280">No activity recorded for this period.</div>'; panes.analytics._S = S; return; }
    var users = Object.keys(S.users).map(function (k) { return S.users[k]; }).sort(function (a, b) { return b.total - a.total; });
    var topMod = topList(S.modules, 1)[0], peak = S.hours.indexOf(Math.max.apply(null, S.hours));
    var changes = users.reduce(function (n, u) { return n + u.created + u.edited + u.deleted; }, 0);
    var logins = users.reduce(function (n, u) { return n + u.login; }, 0);
    function card(l, v) { return '<div class="acxdc-card"><div class="l">' + l + '</div><div class="v">' + esc(v) + '</div></div>'; }
    var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hl = S.hours.map(function (_, i) { return pad(i) + 'h'; });
    var h = '<div class="acxdc-cards">' +
      card('Total actions', S.total) + card('Active users', users.length) +
      card('Avg actions / day', (S.total / S.spanDays).toFixed(1)) + card('Most active user', users[0].name + ' (' + users[0].total + ')') +
      card('Top module', topMod ? topMod[0] + ' (' + topMod[1] + ')' : '-') + card('Peak hour', pad(peak) + ':00 - ' + pad((peak + 1) % 24) + ':00') +
      card('Changes (created, edited, deleted)', changes) + card('Logins', logins) + '</div>' +
      '<div class="acxdc-sec"><h4>Activity trend (' + (S.trendUnit === 'month' ? 'per month' : 'per day') + ')</h4>' + barSvg(S.trend.map(function (t) { return t[1]; }), S.trend.map(function (t) { return t[0]; })) + '</div>' +
      '<div class="acxdc-grid2"><div class="acxdc-sec"><h4>Actions breakdown</h4>' + hbars(topList(S.actions, 10)) + '</div>' +
      '<div class="acxdc-sec"><h4>Module usage</h4>' + hbars(topList(S.modules, 10)) + '</div></div>' +
      '<div class="acxdc-grid2"><div class="acxdc-sec"><h4>Usage by hour of day</h4>' + barSvg(S.hours, hl) + '</div>' +
      '<div class="acxdc-sec"><h4>Usage by day of week</h4>' + barSvg(S.wdays, wd) + '</div></div>' +
      '<div class="acxdc-sec"><h4>User statistics</h4><div style="overflow:auto"><table id="acxDCUsers"><thead><tr><th>User</th><th>Role</th><th>Total</th><th>Logins</th><th>Created</th><th>Edited</th><th>Deleted</th><th>Approved</th><th>Other</th><th>Last active</th></tr></thead><tbody>' +
      users.map(function (u) {
        return '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.role) + '</td><td class="n"><b>' + u.total + '</b></td><td class="n">' + u.login + '</td><td class="n">' + u.created + '</td><td class="n">' + u.edited + '</td><td class="n">' + u.deleted + '</td><td class="n">' + u.approved + '</td><td class="n">' + (u.other + u.logout) + '</td><td>' + esc(fmtDT(u.last)) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    body.innerHTML = h;
    panes.analytics._S = S;
  }

  /* ---------- downloads / print ---------- */
  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stamp() { return dayKey(new Date()); }
  function csvUsers() {
    var S = compute();
    var users = Object.keys(S.users).map(function (k) { return S.users[k]; }).sort(function (a, b) { return b.total - a.total; });
    var out = 'User,Role,Total,Logins,Created,Edited,Deleted,Approved,Other,Last active\n';
    users.forEach(function (u) { out += [u.name, u.role, u.total, u.login, u.created, u.edited, u.deleted, u.approved, u.other + u.logout, fmtDT(u.last)].map(csvCell).join(',') + '\n'; });
    download('user-activity-summary-' + stamp() + '.csv', out);
  }
  function csvTrend() {
    var S = compute(), out = (S.trendUnit === 'month' ? 'Month' : 'Date') + ',Actions\n';
    S.trend.forEach(function (t) { out += csvCell(t[0]) + ',' + t[1] + '\n'; });
    download('activity-trend-' + stamp() + '.csv', out);
  }
  function printReport() {
    renderAnalytics();
    var w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to print the report.'); return; }
    var label = $('acxdcPeriod').options[$('acxdcPeriod').selectedIndex].text;
    var st = $('acxDCStyle') ? $('acxDCStyle').textContent : '';
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Activity Analytics</title><style>body{font-family:Arial,sans-serif;padding:16px}' + st + '</style></head><body><h2>Activity Analytics report</h2><p>' + esc(label) + (A.user ? ' - ' + esc(A.user) : ' - all users') + ' - generated ' + esc(new Date().toLocaleString()) + '</p>' + $('acxdcAnBody').innerHTML + '</body></html>');
    w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 300);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-acxdc-tab],[data-acxdc-act]') : null;
    if (!t) return;
    if (t.hasAttribute('data-acxdc-tab')) { setDC(t.getAttribute('data-acxdc-tab')); return; }
    var a = t.getAttribute('data-acxdc-act');
    if (a === 'export') { try { exportUserActivity(); } catch (err) { alert('Could not export the activity log.'); } }
    else if (a === 'clear') { try { clearUserActivity(); } catch (err) {} }
    else if (a === 'csv-users') csvUsers();
    else if (a === 'csv-trend') csvTrend();
    else if (a === 'print') printReport();
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'acxdcPeriod') { A.period = t.value; renderAnalytics(); }
    else if (t.id === 'acxdcUser') { A.user = t.value; renderAnalytics(); }
    else if (t.id === 'actionFilter' || t.id === 'fromDate' || t.id === 'toDate') { try { loadUserActivity(); } catch (err) {} }
  });
  var searchTimer = null;
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'activitySearch') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { try { loadUserActivity(); } catch (err) {} }, 300);
    }
  });

  /* ---------- boot ---------- */
  function boot() {
    wrapShowTab();
    hideOldEntry();
    build();
  }
  function init() { boot(); setTimeout(boot, 600); setTimeout(boot, 2000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
