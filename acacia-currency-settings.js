/* Acacia Books: single, company-scoped currency settings interface. */
(function () {
  'use strict';
  var PRIMARY = '#1e3a8a', BORDER = '#dbe3f5';
  var NAMES = {KES:'Kenyan Shilling',USD:'US Dollar',EUR:'Euro',GBP:'British Pound',AUD:'Australian Dollar',CAD:'Canadian Dollar',CHF:'Swiss Franc',CNY:'Chinese Yuan',JPY:'Japanese Yen',INR:'Indian Rupee',ZAR:'South African Rand',NGN:'Nigerian Naira',UGX:'Ugandan Shilling',TZS:'Tanzanian Shilling'};
  var $ = function (id) { return document.getElementById(id); };
  function parse(v, fallback) { try { var x = JSON.parse(v); return x == null ? fallback : x; } catch (_) { return fallback; } }
  function orgInfo() { var x = parse(localStorage.getItem('orgInfo'), {}); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
  function companyId() { try { var n = window.__companyNS; return n && n.activeCompany ? String(n.activeCompany() || '') : ''; } catch (_) { return ''; } }
  function saveInfo(info) {
    localStorage.setItem('orgInfo', JSON.stringify(info));
    var id = companyId();
    if (id) { try { localStorage.setItem('orgInfo_' + id, JSON.stringify(info)); } catch (_) {} }
    try { if (window.__companySyncKick) window.__companySyncKick(); } catch (_) {}
  }
  function read(key, fallback) {
    var raw = localStorage.getItem(key);
    if (raw != null) return parse(raw, fallback);
    var info = orgInfo(), cfg = info.currencySettings || {};
    if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key];
    if (key === 'exchangeRates' && info.exchangeRates) return info.exchangeRates;
    if (key === 'appBaseCurrency' && info.baseCurrency) return info.baseCurrency;
    return fallback;
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    var info = orgInfo(); info.currencySettings = info.currencySettings || {}; info.currencySettings[key] = value;
    if (key === 'exchangeRates') info.exchangeRates = value;
    if (key === 'appBaseCurrency') info.baseCurrency = String(value || 'KES').toUpperCase();
    saveInfo(info);
  }
  function persistRates(value) {
    var b = base(), existing = parse(localStorage.getItem('currencies'), []); if (!Array.isArray(existing)) existing = [];
    var byCode = {}; existing.forEach(function (x) { if (x && x.code) byCode[String(x.code).toUpperCase()] = x; });
    var catalog = Object.keys(value).map(function (code) { var old = byCode[code] || {}; return Object.assign({}, old, {code:code, name:old.name || NAMES[code] || code + ' Currency', symbol:old.symbol || (code === 'KES' ? 'KSh' : code), rate:Number(value[code]), decimals:old.decimals == null ? '2' : old.decimals, base:code === b, active:true}); });
    write('exchangeRates', value); write('currencies', catalog);
    try { window.__CURRENCY_OPTIONS__ = catalog.map(function (x) { return x.code; }); } catch (_) {}
  }
  function base() { return String(read('appBaseCurrency', orgInfo().baseCurrency || 'KES') || 'KES').replace(/^"|"$/g, '').toUpperCase(); }
  function rates() {
    var r = read('exchangeRates', {}) || {};
    if (!r || typeof r !== 'object' || Array.isArray(r)) r = {};
    var b = base(); r[b] = 1;
    Object.keys(r).forEach(function (k) { var v = Number(r[k]); if (!(v > 0 && isFinite(v))) delete r[k]; else r[k] = v; });
    return r;
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function ensureStyle() {
    if ($('acxCurrencySettingsCss')) return;
    var s = document.createElement('style'); s.id = 'acxCurrencySettingsCss';
    s.textContent = '.acx-cur-wrap{box-sizing:border-box;width:100%;max-width:100%;min-width:0;color:#14234f;font-size:14px}.acx-cur-head{display:flex;align-items:center;gap:12px;margin:0 0 12px}.acx-cur-title{font-size:20px;font-weight:800;color:'+PRIMARY+'}.acx-cur-sub,.acx-cur-muted{font-size:12px;color:#64748b}.acx-cur-card{box-sizing:border-box;width:100%;background:#fff;border:1px solid '+BORDER+';border-radius:12px;padding:14px;margin:0 0 12px}.acx-cur-top{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start;background:#f8faff;border:1px solid '+BORDER+';border-radius:12px;padding:14px;margin-bottom:16px}.acx-cur-field label{display:block;font-weight:700;margin-bottom:6px;color:#172554}.acx-cur-field input,.acx-cur-field select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;background:#fff;color:#172554}.acx-cur-btn{border:1px solid '+PRIMARY+';border-radius:7px;padding:8px 12px;font-weight:700;color:'+PRIMARY+';background:#fff;cursor:pointer}.acx-cur-btn.primary{background:'+PRIMARY+';color:#fff}.acx-cur-btn:disabled{opacity:.55;cursor:wait}.acx-cur-table-wrap{width:100%;overflow-x:auto}.acx-cur-table{width:100%;min-width:620px;border-collapse:collapse}.acx-cur-table th{background:#eef2ff;color:#172554;text-align:left;padding:10px;white-space:nowrap}.acx-cur-table td{border-bottom:1px solid #e5eaf5;padding:8px 10px}.acx-cur-table input{box-sizing:border-box;width:100%;max-width:190px;min-width:100px;border:1px solid #cbd5e1;border-radius:7px;padding:8px}.acx-cur-help{background:#f0f4ff;border:1px solid #cbd8ff;border-radius:10px;padding:13px}.acx-cur-help li{margin:5px 0}.acx-cur-status{font-size:12px;margin-top:8px;color:#475569;overflow-wrap:anywhere}@media(max-width:800px){.acx-cur-top{grid-template-columns:1fr}.acx-cur-head{align-items:flex-start}}';
    document.head.appendChild(s);
  }
  function panel() { return $('currenciesTab'); }
  function render() {
    var p = panel(); if (!p) return false;
    ensureStyle();
    var b = base(), r = rates(), names = Object.assign({}, NAMES), updated = read('acxCurrencyLastUpdated', 'Not updated yet');
    Object.keys(r).forEach(function (c) { if (!names[c]) names[c] = c + ' Currency'; });
    if (!names[b]) names[b] = b + ' Currency';
    var opts = Object.keys(names).sort().map(function (c) { return '<option value="'+esc(c)+'" '+(c === b ? 'selected' : '')+'>'+esc(c+' — '+names[c])+'</option>'; }).join('');
    var rows = Object.keys(r).filter(function (c) { return c !== b; }).sort().map(function (c) { return '<tr><td>'+esc(names[c] || c)+'</td><td><strong>'+esc(c)+'</strong></td><td><input type="number" min="0.00000001" step="any" data-cur-rate="'+esc(c)+'" value="'+esc(r[c])+'" aria-label="Rate for '+esc(c)+'"></td><td>'+esc(updated)+'</td><td><button type="button" class="acx-cur-btn" data-cur-save="'+esc(c)+'">Save</button> <button type="button" class="acx-cur-btn" data-cur-delete="'+esc(c)+'">Delete</button></td></tr>'; }).join('');
    var auto = read('acxCurrencyAutoUpdate', true) !== false, freq = read('acxCurrencyFrequency', 'Daily');
    p.querySelectorAll('[data-acx-settings-content="currencies"]').forEach(function (n) { n.remove(); });
    p.innerHTML = '<div class="acx-cur-wrap"><div class="acx-cur-head"><div style="font-size:28px;color:'+PRIMARY+'">💱</div><div><div class="acx-cur-title">Currencies</div><div class="acx-cur-sub">Company base currency and exchange rates used throughout Acacia Books</div></div></div>'+
      '<div class="acx-cur-top"><div class="acx-cur-field"><label for="acxBaseCurrency">Base Currency *</label><select id="acxBaseCurrency">'+opts+'</select><div class="acx-cur-muted" style="margin-top:6px">Applies to this company only.</div></div>'+
      '<div><label style="font-weight:700;color:#172554"><input type="checkbox" id="acxAutoRates" '+(auto?'checked':'')+'> Auto Update Rates</label><div class="acx-cur-muted" style="margin:5px 0 9px">Automatically refresh configured exchange rates.</div><div class="acx-cur-field"><label for="acxRateFrequency">Update Frequency</label><select id="acxRateFrequency"><option '+(freq==='Daily'?'selected':'')+'>Daily</option><option '+(freq==='Weekly'?'selected':'')+'>Weekly</option><option '+(freq==='Monthly'?'selected':'')+'>Monthly</option></select></div></div>'+
      '<div><button type="button" class="acx-cur-btn primary" id="acxUpdateRates">↻ Update Rates</button><div class="acx-cur-status" id="acxRateStatus">Last updated: '+esc(updated)+'</div><div class="acx-cur-muted">Rates are stored separately for each company.</div></div></div>'+
      '<div class="acx-cur-head" style="justify-content:space-between;flex-wrap:wrap"><div><strong style="font-size:17px;color:'+PRIMARY+'">Exchange Rates</strong><div class="acx-cur-sub">1 unit of foreign currency = value in '+esc(b)+'.</div></div><button type="button" class="acx-cur-btn" id="acxAddRate">＋ Add Rate</button></div>'+
      '<div class="acx-cur-card acx-cur-table-wrap"><table class="acx-cur-table"><thead><tr><th>Currency</th><th>Code</th><th>Rate (1 Unit = '+esc(b)+')</th><th>Last Updated</th><th>Actions</th></tr></thead><tbody>'+(rows || '<tr><td colspan="5" class="acx-cur-muted">No foreign currency rates added yet.</td></tr>')+'</tbody></table></div>'+
      '<div class="acx-cur-help"><strong>How it works</strong><ul><li>Choose the base currency for the selected company.</li><li>Add or update exchange rates for foreign currencies.</li><li>Rates are used by supported Sales, Purchases, Funds, Banking and Reports workflows.</li></ul></div></div>';
    $('acxBaseCurrency').onchange = function () {
      var next = this.value, old = base(); if (next === old) return;
      var current = rates(), divisor = Number(current[next]); if (!(divisor > 0)) divisor = 1;
      Object.keys(current).forEach(function (c) { current[c] = c === next ? 1 : current[c] / divisor; });
      current[next] = 1; write('appBaseCurrency', next); persistRates(current); write('acxCurrencyLastUpdated', new Date().toLocaleString()); notify(); render();
    };
    $('acxAutoRates').onchange = function () { write('acxCurrencyAutoUpdate', this.checked); };
    $('acxRateFrequency').onchange = function () { write('acxCurrencyFrequency', this.value); };
    $('acxAddRate').onclick = function () {
      var code = String(prompt('Currency code (for example USD, EUR or GBP):') || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) { if (code) alert('Enter a valid three-letter currency code.'); return; }
      var current = rates(); if (code === base() || Object.prototype.hasOwnProperty.call(current, code)) return alert('This currency is already listed.');
      var value = Number(prompt('Rate: 1 '+code+' = how many '+base()+'?'));
      if (!(value > 0 && isFinite(value))) return alert('Enter a rate greater than zero.');
      current[code] = value; persistRates(current); write('acxCurrencyLastUpdated', new Date().toLocaleString()); notify(); render();
    };
    p.querySelectorAll('[data-cur-save]').forEach(function (btn) { btn.onclick = function () { var c = btn.getAttribute('data-cur-save'), input = p.querySelector('[data-cur-rate="'+c+'"]'), value = Number(input && input.value); if (!(value > 0 && isFinite(value))) return alert('Enter a rate greater than zero.'); var current = rates(); current[c] = value; persistRates(current); write('acxCurrencyLastUpdated', new Date().toLocaleString()); notify(); render(); }; });
    p.querySelectorAll('[data-cur-delete]').forEach(function (btn) { btn.onclick = function () { var c = btn.getAttribute('data-cur-delete'); if (!confirm('Delete the '+c+' exchange rate?')) return; var current = rates(); delete current[c]; persistRates(current); notify(); render(); }; });
    $('acxUpdateRates').onclick = updateRates;
    return true;
  }
  function notify() {
    try { window.dispatchEvent(new Event('acx-currency-rates-updated')); } catch (_) {}
    ['renderCurrencyAdjustments','renderProfitLoss','renderBalanceSheet','renderBankTable','loadDashboardBanks','renderDashboard'].forEach(function (name) { try { if (typeof window[name] === 'function') window[name](); } catch (_) {} });
    try { if (window.__companySyncKick) window.__companySyncKick(); } catch (_) {}
  }
  function updateRates() {
    var status = $('acxRateStatus'), btn = $('acxUpdateRates'), b = base();
    if (status) status.textContent = 'Fetching latest rates…'; if (btn) btn.disabled = true;
    fetch('https://open.er-api.com/v6/latest/'+encodeURIComponent(b), {cache:'no-store'}).then(function (res) { if (!res.ok) throw new Error('Rate service returned '+res.status); return res.json(); }).then(function (data) {
      if (!data || data.result !== 'success' || !data.rates) throw new Error('The rate service returned no usable rates.');
      var current = rates(), count = 0;
      Object.keys(current).forEach(function (c) { if (c !== b && Number(data.rates[c]) > 0) { current[c] = 1 / Number(data.rates[c]); count++; } });
      if (!count) throw new Error('No matching currencies were returned.');
      current[b] = 1; persistRates(current); write('acxCurrencyLastUpdated', new Date().toLocaleString()); notify(); render();
      var s = $('acxRateStatus'); if (s) s.textContent = 'Rates updated successfully · '+count+' currencies';
    }).catch(function (err) { var s = $('acxRateStatus'); if (s) s.textContent = 'Could not update rates: '+(err.message || 'Check your connection'); var b2 = $('acxUpdateRates'); if (b2) b2.disabled = false; });
  }
  function activeTab() { return !!(panel() && !panel().classList.contains('hidden') && getComputedStyle(panel()).display !== 'none'); }
  function hookNavigation() {
    if (typeof window.showTab === 'function' && !window.showTab.__acxCurrencyHook) {
      var original = window.showTab;
      var wrapped = function (tab) { var result = original.apply(this, arguments); if (tab === 'currenciesTab') setTimeout(render, 0); return result; };
      wrapped.__acxCurrencyHook = true; window.showTab = wrapped;
    }
  }
  var lastCompany = null;
  function boot() {
    hookNavigation();
    var cid = companyId();
    if (lastCompany !== cid) { lastCompany = cid; if (activeTab()) render(); }
    else if (activeTab() && !$('acxBaseCurrency')) render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); setInterval(boot, 700); });
  else { boot(); setInterval(boot, 700); }
  window.acxUpdateCurrencyRates = updateRates;
  window.acxRenderCurrencySettings = render;
})();
