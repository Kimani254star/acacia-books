/* Acacia Books permissions completion (v2).
   Adds ONLY what the built-in Module Access list lacks: the connected-app
   checkboxes (app_*) and the Mail note. It no longer injects duplicate or
   invented module IDs - those never matched the live navigation IDs, so they
   showed as unticked when a user was opened and could never grant access.
   Report access is handled separately by the Report Access list.
   Supabase authorization enforcement must still be wired to these assignments. */
(function(){
  'use strict';
  var APPS=[['app_budget','Acacia Budget'],['app_crm','Acacia CRM'],['app_expenses','Acacia Expenses'],['app_inventory','Acacia Inventory'],['app_meet','Acacia Meet'],['app_payroll','Acacia Payroll'],['app_plans','Acacia Plans'],['app_pos','Acacia POS'],['app_sell','Acacia Sell'],['app_stock','Acacia Stock']];
  function addCheckbox(body,value,label){
    if(document.querySelector('#moduleAccessList input[type="checkbox"][value="'+value+'"]'))return;
    var lab=document.createElement('label');
    lab.style.cssText='display:flex;align-items:center;gap:6px;padding:3px 5px;margin:2px 0;font-size:13px';
    var cb=document.createElement('input');cb.type='checkbox';cb.value=value;
    lab.appendChild(cb);lab.appendChild(document.createTextNode(label));body.appendChild(lab);
  }
  function extend(){
    try{
      var list=document.getElementById('moduleAccessList');if(!list)return;
      var body=list.querySelector('[data-group-body="custom"]')||list;
      if(!body.querySelector('#acx-master-group-apps')){
        var h=document.createElement('div');h.id='acx-master-group-apps';
        h.textContent='Connected Apps (Subscription + API controlled)';
        h.style.cssText='font-weight:700;padding:7px 5px 3px;border-top:1px solid #ddd;margin-top:5px';
        body.appendChild(h);
      }
      APPS.forEach(function(a){addCheckbox(body,a[0],a[1]);});
      if(!body.querySelector('#acx-mail-access-note')){
        var n=document.createElement('div');n.id='acx-mail-access-note';
        n.textContent='Acacia Mail: available to every authenticated Books user (no paid app toggle).';
        n.style.cssText='padding:8px;color:#166534;font-size:12px';body.appendChild(n);
      }
      if(typeof refreshModuleAccessGroupStates==='function')refreshModuleAccessGroupStates();
    }catch(e){console.warn('[Acacia permission completion]',e);}
  }
  function init(){extend();setTimeout(extend,500);setTimeout(extend,1800);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  window.addEventListener('load',init);
})();
