(function(){
  "use strict";
  function drafts(){try{return JSON.parse(localStorage.getItem("acxUniversalDrafts")||"[]")}catch(e){return[]}}
  function addCompleteButtons(){
    document.querySelectorAll('tr[data-acx-draft]').forEach(function(row){
      var actions=row.querySelector('td:last-child');
      if(!actions||actions.querySelector('[data-acx-complete]'))return;
      var edit=actions.querySelector('[data-acx-edit]');
      if(!edit)return;
      var b=document.createElement('button');
      b.type='button';b.textContent='Complete';b.setAttribute('data-acx-complete',edit.getAttribute('data-acx-edit'));
      b.className='bg-blue-900 text-white px-2 py-1 rounded text-xs ml-1';
      actions.appendChild(b);
    });
  }
  document.addEventListener('click',function(ev){
    var b=ev.target.closest&&ev.target.closest('[data-acx-complete]');
    if(!b)return;
    ev.preventDefault();ev.stopPropagation();
    var id=b.getAttribute('data-acx-complete');
    var rec=drafts().find(function(x){return String(x.id)===String(id)});
    if(!rec){alert('This draft could not be found. Refresh the table and try again.');return}
    var edit=document.createElement('button');
    edit.type='button';edit.hidden=true;edit.setAttribute('data-acx-edit',id);
    document.body.appendChild(edit);edit.click();edit.remove();
    window.setTimeout(function(){
      var section=rec.sec?document.getElementById(rec.sec):null;
      var scope=section||document;
      var candidates=Array.prototype.slice.call(scope.querySelectorAll('button,input[type="submit"]'));
      var save=candidates.find(function(x){
        var label=(x.textContent||x.value||'').trim().toLowerCase();
        var handler=(x.getAttribute('onclick')||'').toLowerCase();
        return (label==='save'||label==='save changes'||label==='create'||label==='post'||/save[A-Z_]/.test(x.getAttribute('onclick')||''))&&!/draft/.test(label+' '+handler)&&!x.disabled;
      });
      if(!save){alert('Draft opened for editing. Use the module’s Save or Post button to complete it.');return}
      save.click();
    },180);
  },true);
  var observer=new MutationObserver(addCompleteButtons);
  function start(){addCompleteButtons();observer.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  window.setInterval(addCompleteButtons,1500);
})();