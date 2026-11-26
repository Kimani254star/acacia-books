/* Permission coverage completion: include every tab discovered from the live sidebar
   in User Management's module/action matrix, including newly-added tabs. */
(function(){
  'use strict';
  function discovered(){
    var ids=new Set();
    document.querySelectorAll('#sidebar button[onclick],#sidebar a[onclick]').forEach(function(el){
      var raw=el.getAttribute('onclick')||'';
      var m=raw.match(/showTab\(\s*['\"]([^'\"]+)['\"]/)||raw.match(/openTab\(\s*['\"]([^'\"]+)['\"]/)||raw.match(/navigateTo\(\s*['\"]([^'\"]+)['\"]/) ;
      if(m&&m[1]&&m[1]!=='homeTab')ids.add(m[1]);
    });
    return Array.from(ids);
  }
  function extend(){
    try{
      if(!Array.isArray(ALL_MODULES)||!Array.isArray(MODULE_GROUPS))return;
      var extra=discovered().filter(function(id){return ALL_MODULES.indexOf(id)<0;});
      extra.forEach(function(id){ALL_MODULES.push(id);});
      if(extra.length){
        var group=MODULE_GROUPS.find(function(g){return g.label==='Additional Modules (Auto-discovered)';});
        if(!group){group={label:'Additional Modules (Auto-discovered)',modules:[]};MODULE_GROUPS.push(group);}
        extra.forEach(function(id){if(group.modules.indexOf(id)<0)group.modules.push(id);});
      }
      /* Also refresh the list when navigation modules are added dynamically. */
      var userTab=document.getElementById('userManagementTab');
      if(userTab&&!userTab.__acxPermissionDiscoveryObserver){
        userTab.__acxPermissionDiscoveryObserver=new MutationObserver(function(){extend();});
        userTab.__acxPermissionDiscoveryObserver.observe(userTab,{childList:true,subtree:true});
      }
    }catch(e){console.warn('[permission coverage discovery]',e);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',extend);else extend();
  window.addEventListener('load',extend);
  setTimeout(extend,1200);setTimeout(extend,3500);
})();
