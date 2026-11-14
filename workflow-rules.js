(function (W, D) {
  'use strict';
  if (W.__acxWorkflowRulesLoaded) return;
  W.__acxWorkflowRulesLoaded = true;

  var RULES_KEY = 'acxWorkflowRules';
  var RUNS_KEY = 'acxWorkflowRuns';
  var TASKS_KEY = 'acxWorkflowTasks';
  var REMINDERS_KEY = 'acxWorkflowReminders';
  var NOTICES_KEY = 'acxWorkflowNotifications';
  var REVIEWS_KEY = 'acxWorkflowReviewQueue';
  var currentEdit = null;
  var conditions = [];
  var actions = [];
  var recentEvents = Object.create(null);
  var internalWrite = false;
  var sequence = 0;
  var moduleMap = {
    invoices: 'Invoices', receipts: 'Receipts', customers: 'Customers', quotes: 'Quotations',
    quotations: 'Quotations', supplierBills: 'Supplier Bills', bills: 'Supplier Bills',
    purchaseOrders: 'Purchase Orders', stockActivities: 'Stock Activity', transactions: 'Bank Transactions',
    expenses: 'Expenses', expenseClaims: 'Expenses', payrollRecords: 'Payroll', employees: 'Employees',
    suppliers: 'Suppliers', products: 'Products', inventory: 'Inventory', stock: 'Inventory',
    deliveryOrders: 'Delivery', creditNotes: 'Credit Notes', salesReturns: 'Sales Returns',
    taxPayments: 'Tax Payments', manualJournals: 'Manual Journals', recurringInvoices: 'Recurring Invoices',
    operationalCosts: 'Expenses', banks: 'Banking Accounts', bankAccounts: 'Banking Accounts', deliveries: 'Delivery',
    customerPayments: 'Customer Payments', supplierPayments: 'Supplier Payments', billPayments: 'Supplier Payments',
    payrollPayments: 'Payroll Payments', journalEntries: 'Journals', recurringJournals: 'Recurring Journals',
    bulkInvoices: 'Bulk Invoices', bulkBills: 'Bulk Bills', purchaseReturns: 'Purchase Returns',
    supplierDebitNotes: 'Supplier Debit Notes', supplierQuotes: 'Supplier Quotations',
    taxAdjustments: 'Tax Adjustments', stockCounts: 'Stock Counts'
  };
  var triggerModules = Object.keys(moduleMap).map(function (key) { return { key: key, label: moduleMap[key] }; });
  var operators = [
    ['equals', 'Equals'], ['not_equals', 'Does not equal'], ['contains', 'Contains'],
    ['not_contains', 'Does not contain'], ['greater_than', 'Greater than'],
    ['greater_or_equal', 'Greater than or equal'], ['less_than', 'Less than'],
    ['less_or_equal', 'Less than or equal'], ['is_empty', 'Is empty'], ['is_not_empty', 'Is not empty']
  ];
  var actionTypes = [
    ['task', 'Create follow-up task'], ['reminder', 'Create reminder'],
    ['notification', 'Create in-app notification'], ['review', 'Add to review queue']
  ];

  function read(key, fallback) {
    try { var value = JSON.parse(W.localStorage.getItem(key) || 'null'); return value == null ? fallback : value; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    internalWrite = true;
    try { W.localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error('[Acacia Workflow] Save failed:', e); }
    finally { internalWrite = false; }
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(prefix) { return (prefix || 'WF') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function me() { try { return JSON.parse(W.localStorage.getItem('loggedInUser') || 'null') || {}; } catch (e) { return {}; } }
  function companyId() { var user = me(); return String(user.companyId || user.company_id || ''); }
  function stamp() { return new Date().toISOString(); }
  function toast(message, tone) {
    var host = D.getElementById('acxWorkflowToastHost');
    if (!host) { host = D.createElement('div'); host.id = 'acxWorkflowToastHost'; host.style.cssText = 'position:fixed;right:20px;bottom:22px;z-index:100500;display:grid;gap:8px;max-width:min(390px,calc(100vw - 32px))'; D.body.appendChild(host); }
    var item = D.createElement('div');
    item.style.cssText = 'padding:11px 14px;border-radius:9px;background:' + (tone === 'error' ? '#991b1b' : '#172554') + ';color:#fff;box-shadow:0 8px 24px #0002;font:13px/1.45 Arial,sans-serif';
    item.textContent = message; host.appendChild(item); setTimeout(function () { item.remove(); }, 4200);
  }
  function getPath(object, path) {
    return String(path || '').split('.').reduce(function (value, part) { return value == null ? undefined : value[part]; }, object);
  }
  function compare(actual, operator, expected) {
    var a = actual, b = expected;
    if (operator === 'is_empty') return a == null || String(a).trim() === '';
    if (operator === 'is_not_empty') return !(a == null || String(a).trim() === '');
    if (operator === 'contains') return String(a == null ? '' : a).toLowerCase().indexOf(String(b).toLowerCase()) >= 0;
    if (operator === 'not_contains') return String(a == null ? '' : a).toLowerCase().indexOf(String(b).toLowerCase()) < 0;
    if (operator === 'equals') return String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();
    if (operator === 'not_equals') return String(a == null ? '' : a).toLowerCase() !== String(b == null ? '' : b).toLowerCase();
    var na = Number(String(a == null ? '' : a).replace(/,/g, '')), nb = Number(String(b == null ? '' : b).replace(/,/g, ''));
    if (!isFinite(na) || !isFinite(nb)) return false;
    if (operator === 'greater_than') return na > nb;
    if (operator === 'greater_or_equal') return na >= nb;
    if (operator === 'less_than') return na < nb;
    if (operator === 'less_or_equal') return na <= nb;
    return false;
  }
  function passes(rule, record) {
    if (!rule.conditions || !rule.conditions.length) return true;
    var checks = rule.conditions.map(function (condition) {
      return compare(getPath(record, condition.field), condition.operator, condition.value);
    });
    return rule.conditionMode === 'any' ? checks.some(Boolean) : checks.every(Boolean);
  }
  function interpolate(template, record, moduleName, eventType) {
    return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_, path) {
      if (path === 'module') return moduleName;
      if (path === 'event') return eventType;
      if (path === 'date') return new Date().toLocaleDateString();
      var value = getPath(record, path);
      return value == null ? '' : String(value);
    });
  }
  function pushRun(entry) {
    var runs = read(RUNS_KEY, []);
    runs.unshift(entry);
    write(RUNS_KEY, runs.slice(0, 300));
  }
  function performAction(action, rule, record, moduleName, eventType, dryRun) {
    var title = interpolate(action.title || rule.name, record, moduleName, eventType);
    var description = interpolate(action.description || '', record, moduleName, eventType);
    if (dryRun) return { type: action.type, title: title, description: description, preview: true };
    var base = {
      id: uid('WFA'), ruleId: rule.id, ruleName: rule.name, module: moduleName,
      recordId: record && (record.id || record._id || record.number || record.invoiceNumber) || '',
      event: eventType, createdAt: stamp(), createdBy: me().username || me().email || 'System',
      companyId: companyId(), status: 'Open'
    };
    if (action.type === 'task') {
      var due = new Date(); due.setDate(due.getDate() + Math.max(0, Number(action.dueDays || 1)));
      var tasks = read(TASKS_KEY, []);
      tasks.unshift(Object.assign({}, base, { title: title || 'Workflow follow-up', description: description, dueDate: due.toISOString().slice(0, 10), priority: action.priority || 'Normal', assignedTo: action.assignee || '' }));
      write(TASKS_KEY, tasks.slice(0, 500));
    } else if (action.type === 'reminder') {
      var when = new Date(); when.setDate(when.getDate() + Math.max(0, Number(action.dueDays || 1)));
      var reminders = read(REMINDERS_KEY, []);
      reminders.unshift(Object.assign({}, base, { title: title || 'Workflow reminder', description: description, dueDate: when.toISOString().slice(0, 10), dueTime: action.dueTime || '09:00', status: 'Pending' }));
      write(REMINDERS_KEY, reminders.slice(0, 500));
    } else if (action.type === 'notification') {
      var notices = read(NOTICES_KEY, []);
      notices.unshift(Object.assign({}, base, { title: title || 'Workflow notification', message: description || title, read: false }));
      write(NOTICES_KEY, notices.slice(0, 500));
      toast(title || 'A workflow rule was triggered');
    } else if (action.type === 'review') {
      var queue = read(REVIEWS_KEY, []);
      queue.unshift(Object.assign({}, base, { title: title || 'Review required', description: description, status: 'Awaiting review' }));
      write(REVIEWS_KEY, queue.slice(0, 500));
    }
    return { type: action.type, title: title, success: true };
  }
  function execute(event) {
    if (!event || !event.moduleKey || !event.record) return;
    var rules = read(RULES_KEY, []);
    rules.forEach(function (rule) {
      if (!rule || !rule.enabled || rule.moduleKey !== event.moduleKey || rule.eventType !== event.type) return;
      if (rule.companyId && rule.companyId !== companyId()) return;
      if (!passes(rule, event.record)) return;
      var results = [];
      try {
        (rule.actions || []).forEach(function (action) { results.push(performAction(action, rule, event.record, event.moduleName, event.type, false)); });
        rule.lastRunAt = stamp(); rule.lastRunStatus = 'Success'; rule.runCount = Number(rule.runCount || 0) + 1;
        pushRun({ id: uid('RUN'), ruleId: rule.id, ruleName: rule.name, module: event.moduleName, event: event.type, recordId: event.record.id || '', status: 'Success', createdAt: stamp(), actions: results });
      } catch (error) {
        rule.lastRunAt = stamp(); rule.lastRunStatus = 'Failed';
        pushRun({ id: uid('RUN'), ruleId: rule.id, ruleName: rule.name, module: event.moduleName, event: event.type, recordId: event.record.id || '', status: 'Failed', error: error.message, createdAt: stamp(), actions: results });
        console.error('[Acacia Workflow] Rule execution failed:', error);
      }
    });
    write(RULES_KEY, rules);
    renderIfOpen();
  }
  function emit(moduleKey, type, record, oldRecord) {
    var event = { id: uid('EVT'), moduleKey: moduleKey, moduleName: moduleMap[moduleKey] || moduleKey, type: type, record: record || {}, oldRecord: oldRecord || null, createdAt: stamp() };
    W.dispatchEvent(new CustomEvent('acx:workflow:event', { detail: event }));
    execute(event);
  }
  W.acxWorkflowEmit = emit;

  function parseArray(value) { try { var parsed = JSON.parse(value || 'null'); return Array.isArray(parsed) ? parsed : null; } catch (e) { return null; } }
  function identity(record, index) { return String(record && (record.id || record._id || record.uuid || record.invoiceNumber || record.billNumber || record.number || record.sku || record.name) || ('index-' + index)); }
  function detectStorageChange(key, before, after) {
    var moduleKey = moduleMap[key] ? key : null;
    if (!moduleKey && /^inventory([:_-]|$)/i.test(key)) moduleKey = 'inventory';
    if (!moduleKey && /^stockActivities([:_-]|$)/i.test(key)) moduleKey = 'stockActivities';
    if (!moduleKey) return;
    var oldList = parseArray(before), newList = parseArray(after);
    if (!oldList && !newList) return;
    oldList = oldList || []; newList = newList || [];
    var oldById = Object.create(null), newById = Object.create(null);
    oldList.forEach(function (record, index) { oldById[identity(record, index)] = record; });
    newList.forEach(function (record, index) { newById[identity(record, index)] = record; });
    newList.forEach(function (record, index) {
      var id = identity(record, index), old = oldById[id];
      var type = old ? (JSON.stringify(old) === JSON.stringify(record) ? null : 'updated') : 'created';
      if (!type) return;
      var dedupe = key + ':' + id + ':' + type;
      if (recentEvents[dedupe] && Date.now() - recentEvents[dedupe] < 350) return;
      recentEvents[dedupe] = Date.now(); emit(moduleKey, type, record, old || null);
    });
    oldList.forEach(function (record, index) {
      var id = identity(record, index); if (newById[id]) return;
      var dedupe = key + ':' + id + ':deleted';
      if (recentEvents[dedupe] && Date.now() - recentEvents[dedupe] < 350) return;
      recentEvents[dedupe] = Date.now(); emit(moduleKey, 'deleted', record, record);
    });
  }
  function installStorageWatcher() {
    try {
      var storage = W.localStorage;
      var original = storage.setItem;
      if (original && !original.__acxWorkflowWrapped) {
        var wrapped = function (key, value) {
          var before = null;
          try { before = this.getItem(String(key)); } catch (e) {}
          var result = original.call(this, key, value);
          if (this === storage && !internalWrite) { try { detectStorageChange(String(key), before, String(value)); } catch (e) { console.warn('[Acacia Workflow] Event detection:', e); } }
          return result;
        };
        wrapped.__acxWorkflowWrapped = true;
        var installed = false;
        try { storage.setItem = wrapped; installed = storage.setItem === wrapped; } catch (e) {}
        if (!installed && W.Storage && W.Storage.prototype && !W.Storage.prototype.setItem.__acxWorkflowWrapped) {
          var nativeSet = W.Storage.prototype.setItem;
          var protoWrapped = function (key, value) {
            var before = null;
            try { if (this === W.localStorage) before = this.getItem(String(key)); } catch (e) {}
            var result = nativeSet.call(this, key, value);
            if (this === W.localStorage && !internalWrite) { try { detectStorageChange(String(key), before, String(value)); } catch (e) { console.warn('[Acacia Workflow] Event detection:', e); } }
            return result;
          };
          protoWrapped.__acxWorkflowWrapped = true;
          W.Storage.prototype.setItem = protoWrapped;
        }
      }
    } catch (e) { console.warn('[Acacia Workflow] Storage watcher unavailable:', e); }
    W.addEventListener('storage', function (event) {
      if (event.key && !internalWrite) detectStorageChange(event.key, event.oldValue, event.newValue);
    });
    W.addEventListener('acx:workflow:event', function (event) { if (event.detail && event.detail.__external) execute(event.detail); });
  }

  function css() {
    if (D.getElementById('acxWorkflowStyle')) return;
    var style = D.createElement('style'); style.id = 'acxWorkflowStyle';
    style.textContent = [
      '#workflowRulesTab{color:#172033;background:#f7f8fb;min-height:calc(100vh - 30px);padding:22px!important;font-family:inherit}',
      '#workflowRulesTab .wf-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.035)}',
      '#workflowRulesTab .wf-btn{border:1px solid #d1d5db;border-radius:7px;padding:8px 12px;font-size:12px;font-weight:700;background:#fff;color:#1f2937;cursor:pointer}',
      '#workflowRulesTab .wf-btn.primary{background:#1e3a8a;color:#fff;border-color:#1e3a8a}',
      '#workflowRulesTab .wf-btn.danger{color:#b91c1c;border-color:#fecaca}',
      '#workflowRulesTab .wf-input,#workflowRulesTab .wf-select,#workflowRulesTab .wf-textarea{width:100%;border:1px solid #d1d5db;border-radius:7px;padding:9px 10px;background:#fff;color:#111827;font-size:13px;min-width:0}',
      '#workflowRulesTab .wf-label{display:block;font-size:11px;font-weight:700;color:#4b5563;margin:0 0 5px}',
      '#workflowRulesTab .wf-chip{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700;background:#eff6ff;color:#1d4ed8}',
      '#workflowRulesTab .wf-muted{color:#6b7280;font-size:12px}',
      '#workflowRulesTab .wf-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '#workflowRulesTab .wf-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}',
      '#workflowRulesTab .wf-condition,#workflowRulesTab .wf-action{display:grid;grid-template-columns:minmax(120px,1fr) minmax(140px,1fr) minmax(120px,1fr) auto;gap:8px;align-items:center;margin-top:8px}',
      '#workflowRulesTab .wf-action{grid-template-columns:minmax(140px,.8fr) minmax(160px,1fr) minmax(180px,1.4fr) auto}',
      '#workflowRulesTab .wf-table{width:100%;border-collapse:collapse;font-size:12px}',
      '#workflowRulesTab .wf-table th{background:#f8fafc;color:#64748b;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:10px;border-bottom:1px solid #e5e7eb}',
      '#workflowRulesTab .wf-table td{padding:11px 10px;border-bottom:1px solid #eef0f3;vertical-align:middle}',
      '#workflowRulesTab .wf-switch{width:34px;height:19px;border-radius:20px;background:#cbd5e1;position:relative;cursor:pointer;border:0;padding:0}',
      '#workflowRulesTab .wf-switch:after{content:"";position:absolute;width:15px;height:15px;top:2px;left:2px;background:#fff;border-radius:50%;transition:transform .15s}',
      '#workflowRulesTab .wf-switch.on{background:#15803d}#workflowRulesTab .wf-switch.on:after{transform:translateX(15px)}',
      '#workflowRulesTab .wf-empty{text-align:center;padding:34px 16px;color:#64748b}',
      '#settingsSubmenu2 .acx-wf-nav-group{list-style:none;margin:.35rem 0 .45rem;padding:0;border:1px solid rgba(148,163,184,.24);border-radius:9px;overflow:hidden;background:rgba(255,255,255,.035)}',
      '#settingsSubmenu2 .acx-wf-nav-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;padding:.58rem .65rem;text-align:left;font-size:12px;font-weight:700;color:inherit}',
      '#settingsSubmenu2 .acx-wf-nav-items{padding:.15rem .35rem .35rem .75rem;margin:0;list-style:none}',
      '#settingsSubmenu2 .acx-wf-nav-items button{font-size:12px;padding:.42rem .55rem;border-radius:6px}',
      '@media(max-width:850px){#workflowRulesTab .wf-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#workflowRulesTab .wf-condition,#workflowRulesTab .wf-action{grid-template-columns:1fr 1fr}#workflowRulesTab{padding:12px!important}}',
      '@media(max-width:520px){#workflowRulesTab .wf-grid{grid-template-columns:1fr}#workflowRulesTab .wf-condition,#workflowRulesTab .wf-action{grid-template-columns:1fr}}'
    ].join('\n'); D.head.appendChild(style);
  }
  function ensureTab() {
    var area = D.getElementById('contentArea'); if (!area) return false;
    var tab = D.getElementById('workflowRulesTab');
    if (!tab) { tab = D.createElement('div'); tab.id = 'workflowRulesTab'; tab.className = 'hidden'; area.appendChild(tab); }
    var menu = D.getElementById('settingsSubmenu2');
    if (menu && !menu.querySelector('[data-acx-workflow-nav="1"]')) {
      var li = D.createElement('li'); li.className = 'acx-wf-nav-group'; li.setAttribute('data-acx-workflow-nav', '1');
      var toggle = D.createElement('button'); toggle.type = 'button'; toggle.className = 'acx-wf-nav-toggle'; toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span>⚡ Automation</span><span aria-hidden="true">▶</span>';
      var list = D.createElement('ul'); list.className = 'acx-wf-nav-items hidden';
      var item = D.createElement('li'), button = D.createElement('button'); button.type = 'button';
      button.className = 'w-full text-left p-1 rounded transition-all duration-300 hover:bg-yellow-400 hover:text-black hover:shadow-lg';
      button.textContent = 'Workflow Rules';
      button.addEventListener('click', function () { if (typeof W.showTab === 'function') W.showTab('workflowRulesTab'); else { D.querySelectorAll('#contentArea > div').forEach(function (node) { node.classList.add('hidden'); }); tab.classList.remove('hidden'); } });
      item.appendChild(button); list.appendChild(item);
      toggle.addEventListener('click', function () { var opening = list.classList.contains('hidden'); list.classList.toggle('hidden', !opening); toggle.setAttribute('aria-expanded', opening ? 'true' : 'false'); });
      li.appendChild(toggle); li.appendChild(list); menu.appendChild(li);
    }
    return true;
  }
  function optionList(options, selected) { return options.map(function (option) { return '<option value="' + esc(option[0]) + '"' + (option[0] === selected ? ' selected' : '') + '>' + esc(option[1]) + '</option>'; }).join(''); }
  function statusPill(status) { return '<span class="wf-chip" style="' + (status === 'Failed' ? 'background:#fef2f2;color:#b91c1c' : status === 'Disabled' ? 'background:#f1f5f9;color:#64748b' : 'background:#ecfdf5;color:#047857') + '">' + esc(status) + '</span>'; }
  function metric(label, value, note) { return '<div class="wf-card" style="padding:14px"><div class="wf-muted">' + esc(label) + '</div><div style="font-size:24px;font-weight:800;margin-top:5px">' + esc(value) + '</div><div class="wf-muted" style="margin-top:3px">' + esc(note) + '</div></div>'; }
  function render() {
    var tab = D.getElementById('workflowRulesTab'); if (!tab) return;
    var rules = read(RULES_KEY, []), runs = read(RUNS_KEY, []), tasks = read(TASKS_KEY, []), reminders = read(REMINDERS_KEY, []), notices = read(NOTICES_KEY, []), reviews = read(REVIEWS_KEY, []);
    var active = rules.filter(function (rule) { return rule.enabled; }).length;
    var failed = runs.filter(function (run) { return run.status === 'Failed'; }).length;
    var lastRun = runs[0] ? new Date(runs[0].createdAt).toLocaleString() : 'No executions yet';
    tab.innerHTML = '<div style="max-width:1500px;margin:0 auto">' +
      '<div class="wf-row" style="justify-content:space-between;margin-bottom:18px"><div><div style="font-size:22px;font-weight:800;color:#111827">Workflow Rules</div><div class="wf-muted" style="margin-top:4px">Automate routine work across Acacia Books using event triggers, conditions and actions.</div></div><button class="wf-btn primary" data-wf="new">＋ Create Workflow</button></div>' +
      '<div class="wf-grid" style="margin-bottom:16px">' + metric('Total workflows', rules.length, 'Saved rules') + metric('Active workflows', active, 'Currently enabled') + metric('Tasks & reminders', tasks.length + reminders.length, 'Created by workflows') + metric('Execution failures', failed, lastRun) + '</div>' +
      '<div class="wf-card" style="padding:15px;margin-bottom:15px"><div class="wf-row" style="justify-content:space-between"><div><div style="font-weight:800;font-size:14px">How automation works</div><div class="wf-muted" style="margin-top:4px">When a record is created, updated or deleted, Acacia checks matching rules, evaluates conditions and runs the selected actions.</div></div><span class="wf-chip">Company-scoped rules</span></div><div class="wf-row" style="margin-top:12px;gap:8px"><span class="wf-chip">1. Trigger</span><span class="wf-muted">→</span><span class="wf-chip">2. Conditions</span><span class="wf-muted">→</span><span class="wf-chip">3. Actions</span><span class="wf-muted">→</span><span class="wf-chip">4. Execution log</span></div></div>' +
      '<div class="wf-card" style="overflow:hidden;margin-bottom:15px"><div class="wf-row" style="justify-content:space-between;padding:14px 15px"><div><div style="font-weight:800;font-size:14px">Your workflows</div><div class="wf-muted">Manage, test and monitor automation rules</div></div><div class="wf-row"><input id="wfSearch" class="wf-input" style="width:210px" placeholder="Search workflows"><select id="wfFilter" class="wf-select" style="width:140px"><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option></select></div></div><div style="overflow:auto"><table class="wf-table"><thead><tr><th>Workflow</th><th>Trigger</th><th>Actions</th><th>Last run</th><th>Status</th><th>Manage</th></tr></thead><tbody id="wfRulesBody"></tbody></table></div></div>' +
      '<div class="wf-card" style="padding:15px;margin-bottom:15px"><div class="wf-row" style="justify-content:space-between"><div><div style="font-weight:800;font-size:14px">Workflow-created work</div><div class="wf-muted">Tasks, reminders, notifications and review items generated by your rules.</div></div><span class="wf-chip">' + (tasks.length + reminders.length + notices.length + reviews.length) + ' items</span></div><div class="wf-grid" style="margin-top:12px"><div><div class="wf-muted">Follow-up tasks</div><b>' + tasks.length + '</b></div><div><div class="wf-muted">Reminders</div><b>' + reminders.length + '</b></div><div><div class="wf-muted">Notifications</div><b>' + notices.length + '</b></div><div><div class="wf-muted">Review queue</div><b>' + reviews.length + '</b></div></div><div class="wf-row" style="margin-top:12px"><button class="wf-btn" data-wf="tasks">View tasks</button><button class="wf-btn" data-wf="reminders">View reminders</button><button class="wf-btn" data-wf="reviews">View review queue</button><button class="wf-btn" data-wf="notifications">View notifications</button></div></div>' +
      '<div class="wf-card" style="overflow:hidden"><div style="padding:14px 15px;border-bottom:1px solid #eef0f3"><div style="font-weight:800;font-size:14px">Recent execution history</div><div class="wf-muted">Every matched rule execution is recorded here.</div></div><div style="overflow:auto"><table class="wf-table"><thead><tr><th>Time</th><th>Workflow</th><th>Module</th><th>Event</th><th>Record</th><th>Result</th></tr></thead><tbody id="wfRunsBody"></tbody></table></div></div>' +
      '</div>';
    renderRulesTable(); renderRunsTable();
  }
  function renderRulesTable() {
    var body = D.getElementById('wfRulesBody'); if (!body) return;
    var rules = read(RULES_KEY, []), search = (D.getElementById('wfSearch') || {}).value || '', filter = (D.getElementById('wfFilter') || {}).value || 'all';
    var shown = rules.filter(function (rule) {
      var matches = (rule.name + ' ' + (moduleMap[rule.moduleKey] || rule.moduleKey)).toLowerCase().indexOf(search.toLowerCase()) >= 0;
      return matches && (filter === 'all' || (filter === 'active' ? rule.enabled : !rule.enabled));
    });
    if (!shown.length) { body.innerHTML = '<tr><td colspan="6"><div class="wf-empty"><div style="font-size:26px;margin-bottom:7px">⚡</div><b>No workflows found</b><div class="wf-muted" style="margin-top:5px">Create a workflow to automate a repeatable business process.</div></div></td></tr>'; return; }
    body.innerHTML = shown.map(function (rule) {
      var trigger = (moduleMap[rule.moduleKey] || rule.moduleKey) + ' · ' + rule.eventType;
      var last = rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : 'Never';
      return '<tr><td><b>' + esc(rule.name) + '</b><div class="wf-muted">' + esc(rule.description || 'No description') + '</div></td><td>' + esc(trigger) + '</td><td>' + esc((rule.actions || []).map(function (a) { return (actionTypes.filter(function (x) { return x[0] === a.type; })[0] || [a.type, a.type])[1]; }).join(', ')) + '</td><td>' + esc(last) + '</td><td>' + statusPill(rule.enabled ? 'Active' : 'Disabled') + '</td><td><div class="wf-row" style="gap:5px;flex-wrap:nowrap"><button class="wf-btn" data-rule-edit="' + esc(rule.id) + '">Edit</button><button class="wf-btn" data-rule-test="' + esc(rule.id) + '">Test</button><button class="wf-switch ' + (rule.enabled ? 'on' : '') + '" title="' + (rule.enabled ? 'Pause workflow' : 'Enable workflow') + '" data-rule-toggle="' + esc(rule.id) + '"></button><button class="wf-btn" data-rule-more="' + esc(rule.id) + '">•••</button></div></td></tr>';
    }).join('');
  }
  function renderRunsTable() {
    var body = D.getElementById('wfRunsBody'); if (!body) return;
    var runs = read(RUNS_KEY, []).slice(0, 30);
    body.innerHTML = runs.length ? runs.map(function (run) {
      return '<tr><td>' + esc(new Date(run.createdAt).toLocaleString()) + '</td><td><b>' + esc(run.ruleName) + '</b></td><td>' + esc(run.module) + '</td><td>' + esc(run.event) + '</td><td>' + esc(run.recordId || '—') + '</td><td>' + statusPill(run.status) + (run.error ? '<div class="wf-muted">' + esc(run.error) + '</div>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="6"><div class="wf-empty">No workflow executions have been recorded yet.</div></td></tr>';
  }
  function renderIfOpen() { var tab = D.getElementById('workflowRulesTab'); if (tab && !tab.classList.contains('hidden')) render(); }
  function conditionMarkup(condition, index) {
    condition = condition || { field: 'status', operator: 'equals', value: '' };
    return '<div class="wf-condition" data-condition="' + index + '"><input class="wf-input" data-cond-field="' + index + '" placeholder="Field, e.g. status" value="' + esc(condition.field) + '"><select class="wf-select" data-cond-op="' + index + '">' + optionList(operators, condition.operator) + '</select><input class="wf-input" data-cond-value="' + index + '" placeholder="Value" value="' + esc(condition.value || '') + '"><button class="wf-btn danger" data-cond-remove="' + index + '">Remove</button></div>';
  }
  function actionMarkup(action, index) {
    action = action || { type: 'notification', title: '', description: '', dueDays: 1, priority: 'Normal' };
    return '<div class="wf-action" data-action="' + index + '"><select class="wf-select" data-action-type="' + index + '">' + optionList(actionTypes, action.type) + '</select><input class="wf-input" data-action-title="' + index + '" placeholder="Action title" value="' + esc(action.title || '') + '"><input class="wf-input" data-action-description="' + index + '" placeholder="Description / message" value="' + esc(action.description || '') + '"><button class="wf-btn danger" data-action-remove="' + index + '">Remove</button></div>' +
      (action.type === 'task' || action.type === 'reminder' ? '<div class="wf-row" style="margin:5px 0 10px 0;padding-left:4px"><label class="wf-muted">Due in days <input class="wf-input" style="width:75px;display:inline-block" type="number" min="0" max="365" data-action-days="' + index + '" value="' + esc(action.dueDays == null ? 1 : action.dueDays) + '"></label>' + (action.type === 'task' ? '<label class="wf-muted">Priority <select class="wf-select" style="width:110px;display:inline-block" data-action-priority="' + index + '">' + optionList([['Low', 'Low'], ['Normal', 'Normal'], ['High', 'High']], action.priority || 'Normal') + '</select></label>' : '') + '</div>' : '');
  }
  function openBuilder(rule) {
    currentEdit = rule ? rule.id : null;
    conditions = rule ? JSON.parse(JSON.stringify(rule.conditions || [])) : [];
    actions = rule ? JSON.parse(JSON.stringify(rule.actions || [])) : [{ type: 'notification', title: 'Review {{module}} record', description: 'A record was {{event}}. Reference: {{id}}', dueDays: 1 }];
    var tab = D.getElementById('workflowRulesTab'); if (!tab) return;
    var existing = D.getElementById('wfBuilder'); if (existing) existing.remove();
    var builder = D.createElement('div'); builder.id = 'wfBuilder'; builder.className = 'wf-card'; builder.style.cssText = 'padding:18px;margin-bottom:16px;border:1px solid #93c5fd';
    var selectedModule = rule ? rule.moduleKey : 'invoices';
    var selectedEvent = rule ? rule.eventType : 'created';
    builder.innerHTML = '<div class="wf-row" style="justify-content:space-between;margin-bottom:14px"><div><div style="font-size:17px;font-weight:800">' + (rule ? 'Edit workflow' : 'Create workflow') + '</div><div class="wf-muted">Define when this rule runs and what Acacia should do.</div></div><button class="wf-btn" data-wf="cancel-builder">Close</button></div>' +
      '<div class="wf-grid"><div style="grid-column:span 2"><label class="wf-label">Workflow name *</label><input id="wfName" class="wf-input" maxlength="100" placeholder="e.g. Follow up overdue invoices" value="' + esc(rule && rule.name || '') + '"></div><div style="grid-column:span 2"><label class="wf-label">Description</label><input id="wfDescription" class="wf-input" maxlength="240" placeholder="What should this workflow achieve?" value="' + esc(rule && rule.description || '') + '"></div><div><label class="wf-label">When this happens</label><select id="wfModule" class="wf-select">' + optionList(triggerModules.map(function (m) { return [m.key, m.label]; }), selectedModule) + '</select></div><div><label class="wf-label">Event</label><select id="wfEvent" class="wf-select">' + optionList([['created', 'Record is created'], ['updated', 'Record is updated'], ['deleted', 'Record is deleted']], selectedEvent) + '</select></div><div><label class="wf-label">Condition matching</label><select id="wfConditionMode" class="wf-select">' + optionList([['all', 'All conditions must match'], ['any', 'Any condition can match']], rule && rule.conditionMode || 'all') + '</select></div><div><label class="wf-label">Initial status</label><select id="wfEnabled" class="wf-select">' + optionList([['true', 'Enabled after saving'], ['false', 'Save as paused']], rule && rule.enabled === false ? 'false' : 'true') + '</select></div></div>' +
      '<div style="margin-top:18px"><div class="wf-row" style="justify-content:space-between"><div><b style="font-size:13px">Conditions</b><div class="wf-muted">Optional. Use field names from the selected record, such as status, total, balance or customer.</div></div><button class="wf-btn" data-wf="add-condition">＋ Add condition</button></div><div id="wfConditions">' + conditions.map(conditionMarkup).join('') + '</div><div class="wf-muted" style="margin-top:7px">No conditions means the workflow runs for every matching event.</div></div>' +
      '<div style="margin-top:18px"><div class="wf-row" style="justify-content:space-between"><div><b style="font-size:13px">Actions</b><div class="wf-muted">Choose what Acacia should create when all trigger conditions are met.</div></div><button class="wf-btn" data-wf="add-action">＋ Add action</button></div><div id="wfActions">' + actions.map(actionMarkup).join('') + '</div></div>' +
      '<div style="padding:12px;background:#f8fafc;border-radius:8px;margin-top:16px"><b style="font-size:12px">Available placeholders</b><div class="wf-muted" style="margin-top:4px">Use {{name}}, {{id}}, {{status}}, {{customer}}, {{total}}, {{balance}}, {{number}}, {{module}} and {{date}} in action titles and descriptions. The exact fields available depend on the selected module.</div></div>' +
      '<div class="wf-row" style="justify-content:flex-end;margin-top:16px"><button class="wf-btn" data-wf="cancel-builder">Cancel</button><button class="wf-btn" data-wf="save-rule">Save workflow</button></div>';
    var heading = tab.querySelector('.wf-row'); if (heading && heading.parentNode) heading.parentNode.insertBefore(builder, heading.nextSibling); else tab.prepend(builder);
    builder.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function collectBuilder() {
    collectCurrentConditions();
    var name = (D.getElementById('wfName') || {}).value || '';
    if (!name.trim()) { toast('Enter a workflow name before saving.', 'error'); return null; }
    var moduleKey = D.getElementById('wfModule').value;
    var conds = conditions.map(function (_, index) {
      return { field: (D.querySelector('[data-cond-field="' + index + '"]') || {}).value || '', operator: (D.querySelector('[data-cond-op="' + index + '"]') || {}).value || 'equals', value: (D.querySelector('[data-cond-value="' + index + '"]') || {}).value || '' };
    }).filter(function (condition) { return condition.field.trim(); });
    var acts = actions.map(function (action, index) {
      var type = (D.querySelector('[data-action-type="' + index + '"]') || {}).value || action.type;
      return { type: type, title: (D.querySelector('[data-action-title="' + index + '"]') || {}).value || '', description: (D.querySelector('[data-action-description="' + index + '"]') || {}).value || '', dueDays: Number((D.querySelector('[data-action-days="' + index + '"]') || {}).value || 1), priority: (D.querySelector('[data-action-priority="' + index + '"]') || {}).value || 'Normal' };
    });
    if (!acts.length) { toast('Add at least one action.', 'error'); return null; }
    return { name: name.trim(), description: (D.getElementById('wfDescription').value || '').trim(), moduleKey: moduleKey, eventType: D.getElementById('wfEvent').value, conditionMode: D.getElementById('wfConditionMode').value, conditions: conds, actions: acts, enabled: D.getElementById('wfEnabled').value === 'true' };
  }
  function saveRule() {
    var data = collectBuilder(); if (!data) return;
    var rules = read(RULES_KEY, []), existing = rules.filter(function (rule) { return rule.id === currentEdit; })[0];
    if (existing) Object.assign(existing, data, { updatedAt: stamp() });
    else rules.unshift(Object.assign({ id: uid('WF'), createdAt: stamp(), createdBy: me().username || me().email || 'System', companyId: companyId(), runCount: 0 }, data));
    write(RULES_KEY, rules); toast(existing ? 'Workflow updated.' : 'Workflow created.'); render();
  }
  function testRule(id) {
    var rule = read(RULES_KEY, []).filter(function (item) { return item.id === id; })[0]; if (!rule) return;
    var records = read(rule.moduleKey, []);
    if (!Array.isArray(records) && rule.moduleKey === 'inventory') records = [];
    if (!Array.isArray(records)) records = [];
    var sample = records[0] || { id: 'SAMPLE-001', name: 'Sample record', status: 'Open', total: 1000, balance: 500, customer: 'Sample Customer' };
    var matched = passes(rule, sample);
    var previews = matched ? (rule.actions || []).map(function (action) { return performAction(action, rule, sample, moduleMap[rule.moduleKey], rule.eventType, true); }) : [];
    var result = matched ? 'Conditions match. No data was changed.\n\nPlanned actions:\n' + previews.map(function (action) { return '• ' + action.type + ': ' + action.title; }).join('\n') : 'The sample record does not match this workflow’s conditions. No data was changed.';
    alert('Workflow test — ' + rule.name + '\n\n' + result);
  }
  function showCollection(type) {
    var map = {
      tasks: [TASKS_KEY, 'Workflow-created tasks', 'Completed'],
      reminders: [REMINDERS_KEY, 'Workflow-created reminders', 'Done'],
      reviews: [REVIEWS_KEY, 'Workflow review queue', 'Resolved'],
      notifications: [NOTICES_KEY, 'Workflow notifications', 'Read']
    };
    var item = map[type]; if (!item) return;
    var list = read(item[0], []);
    var modal = D.getElementById('acxWorkflowCollectionModal');
    if (!modal) { modal = D.createElement('div'); modal.id = 'acxWorkflowCollectionModal'; modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:100400;display:flex;align-items:center;justify-content:center;padding:16px'; D.body.appendChild(modal); }
    modal.dataset.collectionType = type;
    modal.innerHTML = '<div style="width:min(850px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:13px;box-shadow:0 18px 55px #0003;color:#172033"><div style="padding:16px 18px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between"><div><b style="font-size:16px">' + esc(item[1]) + '</b><div style="font-size:11px;color:#64748b;margin-top:3px">' + list.length + ' items · Generated by Workflow Rules</div></div><button class="wf-btn" data-work-close>Close</button></div><div style="overflow:auto"><table class="wf-table"><thead><tr><th>Item</th><th>Workflow</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + (list.length ? list.map(function (entry) { return '<tr><td><b>' + esc(entry.title || 'Untitled') + '</b><div class="wf-muted">' + esc(entry.description || entry.message || '') + '</div></td><td>' + esc(entry.ruleName || 'Workflow') + '</td><td>' + esc(entry.dueDate || new Date(entry.createdAt).toLocaleDateString()) + '</td><td>' + esc(entry.status || (entry.read ? 'Read' : 'Open')) + '</td><td><div class="wf-row" style="gap:5px;flex-wrap:nowrap"><button class="wf-btn" data-work-done="' + esc(entry.id) + '">' + (type === 'notifications' ? 'Mark read' : item[2]) + '</button><button class="wf-btn danger" data-work-delete="' + esc(entry.id) + '">Delete</button></div></td></tr>'; }).join('') : '<tr><td colspan="5"><div class="wf-empty">No items have been created yet.</div></td></tr>') + '</tbody></table></div></div>';
  }
  function handleClick(event) {
    var target = event.target.closest('[data-wf],[data-rule-edit],[data-rule-test],[data-rule-toggle],[data-rule-more],[data-cond-remove],[data-action-remove],[data-work-done],[data-work-delete],[data-work-close]');
    if (!target) return;
    if (target.hasAttribute('data-work-close')) { var closeModal = D.getElementById('acxWorkflowCollectionModal'); if (closeModal) closeModal.remove(); return; }
    if (target.hasAttribute('data-work-done') || target.hasAttribute('data-work-delete')) {
      var modal = D.getElementById('acxWorkflowCollectionModal'), collectionType = modal && modal.dataset.collectionType;
      var collectionMap = { tasks: TASKS_KEY, reminders: REMINDERS_KEY, reviews: REVIEWS_KEY, notifications: NOTICES_KEY };
      var collectionKey = collectionMap[collectionType]; if (!collectionKey) return;
      var collection = read(collectionKey, []), workId = target.getAttribute('data-work-done') || target.getAttribute('data-work-delete');
      if (target.hasAttribute('data-work-delete')) collection = collection.filter(function (entry) { return entry.id !== workId; });
      else collection.forEach(function (entry) { if (entry.id === workId) { if (collectionType === 'notifications') entry.read = true; else entry.status = collectionType === 'tasks' ? 'Completed' : collectionType === 'reminders' ? 'Done' : 'Resolved'; entry.completedAt = stamp(); } });
      write(collectionKey, collection); showCollection(collectionType); renderIfOpen(); return;
    }
    if (target.hasAttribute('data-rule-edit')) { var id = target.getAttribute('data-rule-edit'); openBuilder(read(RULES_KEY, []).filter(function (rule) { return rule.id === id; })[0]); return; }
    if (target.hasAttribute('data-rule-test')) { testRule(target.getAttribute('data-rule-test')); return; }
    if (target.hasAttribute('data-rule-toggle')) {
      var toggleId = target.getAttribute('data-rule-toggle'), rules = read(RULES_KEY, []), rule = rules.filter(function (item) { return item.id === toggleId; })[0];
      if (rule) { rule.enabled = !rule.enabled; rule.updatedAt = stamp(); write(RULES_KEY, rules); render(); toast(rule.enabled ? 'Workflow enabled.' : 'Workflow paused.'); } return;
    }
    if (target.hasAttribute('data-rule-more')) {
      var moreId = target.getAttribute('data-rule-more');
      var choice = prompt('Type DUPLICATE to copy this workflow, or DELETE to remove it.');
      var all = read(RULES_KEY, []), original = all.filter(function (item) { return item.id === moreId; })[0];
      if (!original) return;
      if (String(choice).toUpperCase() === 'DUPLICATE') { var copy = JSON.parse(JSON.stringify(original)); copy.id = uid('WF'); copy.name += ' (Copy)'; copy.enabled = false; copy.createdAt = stamp(); copy.runCount = 0; delete copy.lastRunAt; all.unshift(copy); write(RULES_KEY, all); render(); toast('Workflow duplicated as a paused copy.'); }
      else if (String(choice).toUpperCase() === 'DELETE' && confirm('Delete workflow "' + original.name + '"? Its execution history will remain.')) { write(RULES_KEY, all.filter(function (item) { return item.id !== moreId; })); render(); toast('Workflow deleted.'); }
      return;
    }
    if (target.hasAttribute('data-cond-remove')) { conditions.splice(Number(target.getAttribute('data-cond-remove')), 1); refreshBuilderSections(); return; }
    if (target.hasAttribute('data-action-remove')) { actions.splice(Number(target.getAttribute('data-action-remove')), 1); refreshBuilderSections(); return; }
    var action = target.getAttribute('data-wf');
    if (action === 'new') openBuilder(null);
    else if (action === 'cancel-builder') { var builder = D.getElementById('wfBuilder'); if (builder) builder.remove(); currentEdit = null; }
    else if (action === 'save-rule') saveRule();
    else if (action === 'add-condition') { collectCurrentConditions(); conditions.push({ field: 'status', operator: 'equals', value: '' }); refreshBuilderSections(); }
    else if (action === 'add-action') { collectCurrentActions(); actions.push({ type: 'notification', title: '', description: '' }); refreshBuilderSections(); }
    else if (action === 'tasks' || action === 'reminders' || action === 'reviews' || action === 'notifications') showCollection(action);
  }
  function collectCurrentConditions() {
    conditions = conditions.map(function (_, index) { return { field: (D.querySelector('[data-cond-field="' + index + '"]') || {}).value || '', operator: (D.querySelector('[data-cond-op="' + index + '"]') || {}).value || 'equals', value: (D.querySelector('[data-cond-value="' + index + '"]') || {}).value || '' }; });
  }
  function collectCurrentActions() {
    actions = actions.map(function (action, index) { return { type: (D.querySelector('[data-action-type="' + index + '"]') || {}).value || action.type, title: (D.querySelector('[data-action-title="' + index + '"]') || {}).value || '', description: (D.querySelector('[data-action-description="' + index + '"]') || {}).value || '', dueDays: Number((D.querySelector('[data-action-days="' + index + '"]') || {}).value || 1), priority: (D.querySelector('[data-action-priority="' + index + '"]') || {}).value || 'Normal' }; });
  }
  function refreshBuilderSections() {
    var condHost = D.getElementById('wfConditions'), actionHost = D.getElementById('wfActions');
    if (condHost) condHost.innerHTML = conditions.map(conditionMarkup).join('');
    if (actionHost) actionHost.innerHTML = actions.map(actionMarkup).join('');
  }
  function handleInput(event) {
    if (event.target && (event.target.id === 'wfSearch' || event.target.id === 'wfFilter')) renderRulesTable();
    if (event.target && event.target.matches('[data-action-type]')) { collectCurrentActions(); refreshBuilderSections(); }
  }
  function init() {
    css();
    if (!ensureTab()) { setTimeout(init, 300); return; }
    installStorageWatcher();
    var tab = D.getElementById('workflowRulesTab');
    tab.addEventListener('click', handleClick);
    tab.addEventListener('input', handleInput);
    tab.addEventListener('change', handleInput);
    render();
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
