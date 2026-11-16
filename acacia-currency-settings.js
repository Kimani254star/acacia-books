/* Acacia Books: unified currency settings and Developer landing page. */
(function () {
  'use strict';
  var PRIMARY = '#1e3a8a', ACCENT = '#facc15', BORDER = '#dbe3f5';
  var CURRENCIES = {
    KES: 'Kenyan Shilling', USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound',
    AUD: 'Australian Dollar', CAD: 'Canadian Dollar', CHF: 'Swiss Franc',
    CNY: 'Chinese Yuan', JPY: 'Japanese Yen', INR: 'Indian Rupee',
    ZAR: 'South African Rand', NGN: 'Nigerian Naira', UGX: 'Ugandan Shilling', TZS: 'Tanzanian Shilling'
  };
  var $ = function (id) { return document.getElementById(id); };
  function read(key, fallback) { try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function base() { try { return String(localStorage.getItem('appBaseCurrency') || 'KES').replace(/^\"|\"$/g, '').toUpperCase(); } catch (_) { return 'KES'; } }
  function rates() { var r = read('exchangeRates', {}) || {}; if (typeof r !== 'object' || Array.isArray(r)) r = {}; r[base()] = 1; return r; }
  function notifyRates() {
    try { window.dispatchEvent(new Event('acx-currency-rates-updated')); } catch (_) {}
    try { window.dispatchEvent(new StorageEvent('storage', { key: 'exchangeRates', newValue: JSON.stringify(rates()) })); } catch (_) {}
    ['renderCurrencyAdjustments','renderProfitLoss','renderBalanceSheet','renderBankTable','loadDashboardBanks','renderDashboard'].forEach(function (name) { try { if (typeof window[name] === 'function') window[name](); } catch (_) {} });
    try { if (window.__companySyncKick) window.__companySyncKick(); } catch (_) {}
  }
  function contentHost(panel, key) { var host = panel.querySelector('[data-acx-settings-content=\"'+key+'\"]'); if (!host) { host = document.createElement('div'); host.setAttribute('data-acx-settings-content', key); panel.appendChild(host); } return host; }
  function style() {
    if ($('acxCurrencySettingsCss')) return;
    var s = document.createElement('style'); s.id = 'acxCurrencySettingsCss';
    s.textContent = '.acx-cur-wrap{color:#14234f;font-size:14px}.acx-cur-head{display:flex;align-items:center;gap:12px;margin:0 0 12px}.acx-cur-head .ico{font-size:30px;color:'+PRIMARY+'}.acx-cur-title{font-size:20px;font-weight:800;color:'+PRIMARY+'}.acx-cur-sub{font-size:12px;color:#475569}.acx-cur-card{background:#fff;border:1px solid '+BORDER+';border-radius:12px;box-shadow:0 2px 8px rgba(30,58,138,.06);padding:14px;margin-bottom:12px}.acx-cur-top{display:grid;grid-template-columns:minmax(220px,1.2fr) minmax(220px,1fr) auto;gap:16px;align-items:center;background:linear-gradient(110deg,#f8faff,#fff);border:1px solid '+BORDER+';border-radius:12px;padding:14px;margin-bottom:14px}.acx-cur-field label{display:block;font-weight:700;margin-bottom:6px;color:#172554}.acx-cur-field input,.acx-cur-field select{width:100%;min-height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;background:white;color:#172554}.acx-cur-btn{border:1px solid '+PRIMARY+';border-radius:8px;padding:8px 12px;font-weight:700;color:'+PRIMARY+';background:#fff;cursor:pointer}.acx-cur-btn.primary{background:'+PRIMARY+';color:#fff}.acx-cur-btn.gold{background:'+ACCENT+';border-color:'+ACCENT+';color:#172554}.acx-cur-btn.danger{border-color:#ef4444;color:#dc2626}.acx-cur-table{width:100%;border-collapse:collapse}.acx-cur-table th{background:#eef2ff;color:#172554;text-align:left;padding:10px}.acx-cur-table td{border-bottom:1px solid #e5eaf5;padding:8px 10px}.acx-cur-table input{width:100%;max-width:190px;border:1px solid #cbd5e1;border-radius:7px;padding:7px 9px;color:#172554}.acx-cur-help{background:#f0f4ff;border:1px solid #cbd8ff;border-radius:11px;padding:13px;color:#172554}.acx-cur-help li{margin:4px 0}.acx-cur-muted{font-size:12px;color:#64748b}.acx-dev-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.acx-dev-link{display:block;text-align:left;border:1px solid '+BORDER+';background:#fff;border-radius:12px;padding:15px;cursor:pointer;color:#172554}.acx-dev-link:hover{border-color:'+PRIMARY+';box-shadow:0 3px 12px rgba(30,58,138,.1)}.acx-dev-link strong{display:block;color:'+PRIMARY+';margin:5px 0}.acx-cur-status{font-size:12px;margin-top:8px;color:#475569}@media(max-width:700px){.acx-cur-top{grid-template-columns:1fr}.acx-cur-table{min-width:680px}.acx-cur-table-wrap{overflow-x:auto}}';
    document.head.appendChild(s);
  }
  function buildCurrencies() {
    var panel = $('currenciesTab'); if (!panel) return false;
    style();
    var currentRates = rates(), b = base();
    var names = Object.assign({}, CURRENCIES);
    Object.keys(currentRates).forEach(function (c) { if (!names[c]) names[c] = c + ' Currency'; });
    var auto = read('acxCurrencyAutoUpdate', true) !== false;
    var freq = read('acxCurrencyFrequency', 'Daily') || 'Daily';
    var updated = read('acxCurrencyLastUpdated', 'Not updated yet');
    var baseOptions = Object.keys(names).map(function (c) { return '<option value="'+esc(c)+'" '+(c===b?'selected':'')+'>'+esc(c+' - '+names[c])+'</option>'; }).join('');
    var rows = Object.keys(currentRates).filter(function(c){return c!==b;}).sort().map(function(c){
      return '<tr data-cur-row="'+esc(c)+'"><td>'+esc(c+' - '+(names[c]||c))+'</td><td><strong>'+esc(c)+'</strong></td><td><input type="number" min="0.00000001" step="any" data-cur-rate="'+esc(c)+'" value="'+esc(Number(currentRates[c])||'')+'" aria-label="Rate for '+esc(c)+'"></td><td class="acx-cur-muted">'+esc(updated)+'</td><td><button class="acx-cur-btn" type="button" data-cur-save="'+esc(c)+'">Save</button> <button class="acx-cur-btn danger" type="button" data-cur-delete="'+esc(c)+'">Delete</button></td></tr>';
    }).join('');
    panel.hidden = false;
    contentHost(panel, 'currencies').innerHTML = '<div class="acx-cur-wrap"><div class="acx-cur-head"><div class="ico">◉</div><div><div class="acx-cur-title">Currencies</div><div class="acx-cur-sub">Set your base currency and manage exchange rates across Acacia Books</div></div></div>'+
      '<div class="acx-cur-top"><div class="acx-cur-field"><label>Base Currency <span style="color:#dc2626">*</span></label><select id="acxBaseCurrency">'+baseOptions+'</select><div class="acx-cur-muted" style="margin-top:6px">All transactions and reports use this company base currency.</div></div>'+
      '<div><label style="font-weight:700;color:#172554"><input type="checkbox" id="acxAutoRates" '+(auto?'checked':'')+'> Auto Update Rates</label><div class="acx-cur-muted" style="margin:5px 0 9px">Fetch latest exchange rates automatically</div><div class="acx-cur-field"><label for="acxRateFrequency">Update Frequency</label><select id="acxRateFrequency"><option '+(freq==='Daily'?'selected':'')+'>Daily</option><option '+(freq==='Weekly'?'selected':'')+'>Weekly</option><option '+(freq==='Monthly'?'selected':'')+'>Monthly</option></select></div></div>'+
      '<div style="text-align:center"><button type="button" class="acx-cur-btn primary" id="acxUpdateRates">↻ Update Rates</button><div class="acx-cur-muted" style="margin-top:8px">Get latest rates from a public exchange-rate source</div><div class="acx-cur-status" id="acxRateStatus">Last updated: '+esc(updated)+'</div></div></div>'+
      '<div class="acx-cur-head" style="justify-content:space-between"><div><strong style="font-size:17px;color:'+PRIMARY+'">↗ Exchange Rates</strong><div class="acx-cur-sub">Rates are expressed as 1 unit of foreign currency = value in '+esc(b)+'.</div></div><button type="button" class="acx-cur-btn gold" id="acxAddRate">＋ Add Rate</button></div>'+
      '<div class="acx-cur-card acx-cur-table-wrap"><table class="acx-cur-table"><thead><tr><th>Currency</th><th>Code</th><th>Rate (1 Unit = '+esc(b)+')</th><th>Last Updated</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" class="acx-cur-muted">No foreign currency rates added yet.</td></tr>')+'</tbody></table></div>'+
      '<div class="acx-cur-help"><strong>ⓘ &nbsp;How it works?</strong><ul><li>Choose your company base currency.</li><li>Add or update exchange rates for other currencies.</li><li>Acacia Books uses these rates across Sales, Purchases, Funds, Banking and Reports.</li></ul></div></div>';
    $('acxBaseCurrency').onchange = function () {
      var next = this.value, old = base(), r = rates(); if (next === old) return;
      var divisor = Number(r[next]); if (!(divisor > 0)) divisor = 1;
      Object.keys(r).forEach(function (c) { r[c] = c === next ? 1 : Number(r[c]) / divisor; });
      localStorage.setItem('appBaseCurrency', next); write('exchangeRates', r); write('acxCurrencyLastUpdated', new Date().toLocaleString()); notifyRates(); buildCurrencies();
    };
    $('acxAutoRates').onchange = function(){ write('acxCurrencyAutoUpdate', this.checked); };
    $('acxRateFrequency').onchange = function(){ write('acxCurrencyFrequency', this.value); };
    $('acxAddRate').onclick = function(){
      var code = String(prompt('Currency code (for example USD, EUR or GBP):')||'').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) { if(code) alert('Enter a valid three-letter currency code.'); return; }
      if (code === base() || Object.prototype.hasOwnProperty.call(rates(),code)) { alert('This currency is already listed.'); return; }
      var rate = Number(prompt('Rate: 1 '+code+' = how many '+base()+'?'));
      if (!(rate > 0 && isFinite(rate))) { alert('Enter a rate greater than zero.'); return; }
      var r = rates(); r[code] = rate; write('exchangeRates',r); write('acxCurrencyLastUpdated',new Date().toLocaleString()); notifyRates(); buildCurrencies();
    };
    panel.querySelectorAll('[data-cur-save]').forEach(function(btn){btn.onclick=function(){var c=btn.getAttribute('data-cur-save'),v=Number(panel.querySelector('[data-cur-rate="'+c+'"]')&&panel.querySelector('[data-cur-rate="'+c+'"]').value);if(!(v>0&&isFinite(v)))return alert('Enter a rate greater than zero.');var r=rates();r[c]=v;write('exchangeRates',r);write('acxCurrencyLastUpdated',new Date().toLocaleString());notifyRates();buildCurrencies();};});
    panel.querySelectorAll('[data-cur-delete]').forEach(function(btn){btn.onclick=function(){var c=btn.getAttribute('data-cur-delete');if(!confirm('Delete the '+c+' exchange rate?'))return;var r=rates();delete r[c];write('exchangeRates',r);notifyRates();buildCurrencies();};});
    $('acxUpdateRates').onclick = updateRates;
    return true;
  }
  function updateRates() {
    var status = $('acxRateStatus'), btn = $('acxUpdateRates'), b = base();
    if (status) status.textContent = 'Fetching latest rates…'; if (btn) btn.disabled = true;
    fetch('https://open.er-api.com/v6/latest/'+encodeURIComponent(b), {cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('Rate service returned '+r.status);return r.json();}).then(function(data){
      if (!data || data.result !== 'success' || !data.rates) throw new Error('The rate service did not return usable rates.');
      var r = rates(), changed = 0;
      Object.keys(r).forEach(function(c){if(c!==b && Number(data.rates[c])>0){r[c]=1/Number(data.rates[c]);changed++;}});
      if (!changed) throw new Error('No matching currencies were returned.');
      r[b]=1; write('exchangeRates',r); var stamp = new Date().toLocaleString(); write('acxCurrencyLastUpdated',stamp); notifyRates(); buildCurrencies();
      var s=$('acxRateStatus'); if(s)s.textContent='Updated '+stamp+' · '+changed+' currencies';
    }).catch(function(err){if(status)status.textContent='Could not update rates: '+(err.message||'Check your connection');if(btn)btn.disabled=false;});
  }
  function buildDeveloper() {
    var panel = $('integrationsHubTab'); if (!panel) return false;
    style(); panel.hidden = false;
    contentHost(panel, 'currencies').innerHTML = '<div class="acx-cur-wrap"><div class="acx-cur-head"><div class="ico">🔌</div><div><div class="acx-cur-title">Developer</div><div class="acx-cur-sub">Manage connections, API access and webhooks for Acacia Books.</div></div></div><div class="acx-cur-card"><strong style="color:'+PRIMARY+'">Developer tools</strong><p class="acx-cur-muted" style="margin:5px 0 12px">Choose a tool below to configure your integrations and data connections.</p><div class="acx-dev-grid">'+[
      ['connectionsTab','🔌','Connections','Connect third-party apps and services.'],['apiKeysTab','🔑','API Keys','Create and manage API access keys.'],['incomingWebhooksTab','📥','Incoming Webhooks','Receive events from external systems.'],['outgoingWebhooksTab','📤','Outgoing Webhooks','Send Acacia events to other systems.'],['webFormsTab','📝','Web Forms','Manage public forms and submissions.'],['dataManagementTab','🗄️','Data Management','Import, export and manage business data.']
    ].map(function(x){return '<button type="button" class="acx-dev-link" data-dev-go="'+x[0]+'"><span>'+x[1]+'</span><strong>'+x[2]+'</strong><span class="acx-cur-muted">'+x[3]+'</span></button>';}).join('')+'</div></div></div>';
    panel.querySelectorAll('[data-dev-go]').forEach(function(btn){btn.onclick=function(){if(typeof window.showTab==='function')window.showTab(btn.getAttribute('data-dev-go'));};});
    return true;
  }
  function maybeAutoUpdate(){if(read('acxCurrencyAutoUpdate',true)===false)return;var freq=read('acxCurrencyFrequency','Daily'),days=freq==='Weekly'?7:freq==='Monthly'?30:1,last=read('acxCurrencyLastUpdated',''),stamp=Date.parse(last);if(!stamp||Date.now()-stamp>days*86400000)updateRates();}
  function boot(){var a=buildCurrencies(),b=buildDeveloper();if(a&&b){if(!window.__acxCurrencyAutoTimer){window.__acxCurrencyAutoTimer=true;setTimeout(maybeAutoUpdate,1800);setInterval(maybeAutoUpdate,3600000);}return true;}return false;}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){var n=0,t=setInterval(function(){n++;if(boot()||n>40)clearInterval(t);},250);});
  else {var n=0,t=setInterval(function(){n++;if(boot()||n>40)clearInterval(t);},250);}
  window.acxUpdateCurrencyRates = updateRates;
})();
