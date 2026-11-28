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
