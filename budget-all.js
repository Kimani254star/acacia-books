/* Acacia Books - Budget module (all budget scripts in one file)
   Sections in load order: governance, cycle graphs, categories, departments, expenditure. */

/* ===== BUDGET-GOVERNANCE ===== */
;try{
(function(){
  'use strict';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v){return 'KES '+(Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
  function renderDepartmentSummary(){var body=document.getElementById('acx-dept-budget-actual-rows');if(!body)return;var bs=[],as=[],ds=[];try{bs=budgets||[];as=actuals||[];ds=JSON.parse(localStorage.getItem('acxBudgetDepartments')||'[]')}catch(e){}var names=[...new Set([].concat(ds.map(function(d){return d.name}),bs.map(function(b){return b.department}),as.map(function(a){return a.department})).filter(Boolean))];var moneyTotal=function(list){return (list||[]).reduce(function(t,r){return t+(r.months||[]).reduce(function(n,m){return n+(Number(m.amount)||0)},0)},0)};body.innerHTML=names.length?names.map(function(n){var b=moneyTotal(bs.filter(function(x){return x.department===n})),a=moneyTotal(as.filter(function(x){return x.department===n}));return '<tr class="border-t"><td class="p-2 font-semibold">'+esc(n)+'</td><td class="p-2 text-right">'+money(b)+'</td><td class="p-2 text-right">'+money(a)+'</td><td class="p-2 text-right">'+money(b-a)+'</td></tr>'}).join(''):'<tr><td colspan="4" class="p-3 text-center text-gray-500">No department budget data yet.</td></tr>'; }
  function render(){renderDepartmentSummary();var body=document.getElementById('acx-budget-approval-rows');if(!body)return;var rows=[];try{rows=typeof budgets!=='undefined'&&Array.isArray(budgets)?budgets:[]}catch(e){}var pending=rows.filter(function(b){return (b.status||'Approved')==='Pending Approval'});var count=document.getElementById('acx-budget-pending-count');if(count)count.textContent=pending.length+' pending';body.innerHTML=rows.length?rows.map(function(b,i){var status=b.status||'Approved',total=(b.months||[]).reduce(function(a,m){return a+(Number(m.amount)||0)},0);return '<tr class="border-t"><td class="p-3 font-semibold">'+esc(b.budgetName||b.name||b.account)+'</td><td class="p-3">'+esc(b.account)+'</td><td class="p-3">'+esc(b.department)+'</td><td class="p-3">'+esc(b.leadName||'—')+'</td><td class="p-3">'+esc(b.period)+'</td><td class="p-3">'+esc(b.year||(b.months&&b.months[0]&&b.months[0].year)||'—')+'</td><td class="p-3 text-right">'+money(total)+'</td><td class="p-3"><span class="font-semibold">'+esc(status)+'</span></td><td class="p-3 whitespace-nowrap">'+(status==='Pending Approval'?'<button class="text-green-700 font-semibold mr-2" onclick="acxBooksBudgetDecision('+i+',\'Approved\')">Approve</button><button class="text-red-600 font-semibold" onclick="acxBooksBudgetDecision('+i+',\'Rejected\')">Reject</button>':'—')+'</td></tr>'}).join(''):'<tr><td colspan="9" class="p-4 text-center text-gray-500">No budgets created yet.</td></tr>';}
  window.acxBooksBudgetDecision=function(index,status){try{if(typeof budgets==='undefined'||!budgets[index])return;budgets[index].status=status;if(typeof saveData==='function')saveData();render();if(typeof renderBudgets==='function')renderBudgets();if(typeof renderComparison==='function')renderComparison();alert('Budget '+status.toLowerCase()+'.');}catch(e){alert('Could not update the budget approval.');}};
  window.acxBooksBudgetApprovalRender=render;
  document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-budget-panel="approvals"]');if(b)setTimeout(render,60)});
  window.addEventListener('storage',function(e){if(e.key==='budgets'||e.key==='actuals'||e.key==='acxBudgetDepartments')render()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
}catch(e){console.error("budget-all: budget-governance.js failed",e)}

/* ===== BUDGET-CYCLE-GRAPHS ===== */
;try{
(function(){
  "use strict";
  var cycles={monthly:{label:"Monthly",names:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]},quarterly:{label:"Quarterly",names:["Q1","Q2","Q3","Q4"]},annual:{label:"Annual",names:["Annual"]}};
  var charts={};
  function read(key){try{return JSON.parse(localStorage.getItem(key)||"[]")}catch(e){return []}}
  function yearOf(x){var y=parseInt(x&&x.year,10);if(y)return y;var m=String(x&&x.month||"");return /^\d{4}$/.test(m)?+m:new Date().getFullYear()}
  function periodOf(x){var m=String(x&&x.month||"").trim();if(/^\d{4}$/.test(m))return "Annual";if(/^Q[1-4]$/i.test(m))return "Quarterly";if(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(m))return "Monthly";return String(x&&x.period||"Monthly")}
  function labelOf(x,cycle){var m=String(x&&x.month||"").trim();if(cycle==="annual")return "FY "+yearOf(x);if(cycle==="quarterly")return (/^Q[1-4]$/i.test(m)?m:"Q"+(Math.floor((new Date(m+" 1, "+yearOf(x)).getMonth())/3)+1))+" "+yearOf(x);return m.slice(0,3)+" "+yearOf(x)}
  function money(n){return "KES "+(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:2})}
  function selectedYear(c){var el=document.getElementById("acx-"+c+"-year");return el?parseInt(el.value,10)||new Date().getFullYear():new Date().getFullYear()}
  function ensureYears(c){var el=document.getElementById("acx-"+c+"-year");if(!el||el.options.length)return;var years=new Set([new Date().getFullYear()]);read("budgets").concat(read("actuals")).forEach(function(r){(r.months||[]).forEach(function(m){years.add(yearOf(m))})});Array.from(years).sort(function(a,b){return b-a}).forEach(function(y){var o=document.createElement("option");o.value=y;o.textContent=y;el.appendChild(o)});el.value=String(new Date().getFullYear());el.addEventListener("change",function(){render(c)})}
  function collect(c,y){var map=new Map();function add(records,key){records.forEach(function(rec){(rec.months||[]).forEach(function(m){if(yearOf(m)!==y||periodOf(m)!==cycles[c].label)return;var label=labelOf(m,c),k=label;var row=map.get(k)||{label:label,budget:0,actual:0};row[key]+=(Number(m.amount)||0);map.set(k,row)})})}
    add(read("budgets"),"budget");add(read("actuals"),"actual");
    var order=cycles[c].names;return Array.from(map.values()).sort(function(a,b){function ix(v){var p=v.label.split(" ")[0];return order.indexOf(p)}return ix(a)-ix(b)||a.label.localeCompare(b.label)})}
  function render(c){var panel=document.getElementById("acxBudgetPanel-"+c);if(!panel)return;ensureYears(c);var y=selectedYear(c),rows=collect(c,y),budget=rows.reduce(function(a,r){return a+r.budget},0),actual=rows.reduce(function(a,r){return a+r.actual},0),variance=budget-actual;
    var set=function(id,v){var e=document.getElementById("acx-"+c+"-"+id);if(e)e.textContent=money(v)};set("planned",budget);set("actual",actual);set("variance",variance);
    var body=document.getElementById("acx-"+c+"-rows");if(body)body.innerHTML=rows.length?rows.map(function(r){return "<tr class='border-t'><td class='p-3'>"+r.label+"</td><td class='p-3 text-right'>"+money(r.budget)+"</td><td class='p-3 text-right'>"+money(r.actual)+"</td><td class='p-3 text-right "+(r.budget-r.actual<0?"text-red-600":"text-green-700")+"'>"+money(r.budget-r.actual)+"</td></tr>"}).join(""):'<tr><td colspan="4" class="p-3 text-center text-gray-500">No '+cycles[c].label.toLowerCase()+' budget data for '+y+'.</td></tr>';
    var canvas=document.getElementById("acx-"+c+"-chart");if(!canvas||typeof window.Chart!=="function")return;if(charts[c])charts[c].destroy();charts[c]=new Chart(canvas.getContext("2d"),{type:"bar",data:{labels:rows.map(function(r){return r.label}),datasets:[{label:"Budget",data:rows.map(function(r){return r.budget}),backgroundColor:"rgba(37,99,235,.65)"},{label:"Actual",data:rows.map(function(r){return r.actual}),backgroundColor:"rgba(147,51,234,.65)"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"top"},tooltip:{callbacks:{label:function(ctx){return ctx.dataset.label+": "+money(ctx.parsed.y)}}}},scales:{y:{beginAtZero:true,ticks:{callback:function(v){return Number(v).toLocaleString()}}}}}})
  }
  function refresh(){["monthly","quarterly","annual"].forEach(function(c){var p=document.getElementById("acxBudgetPanel-"+c);if(p&&!p.hidden)render(c)})}
  document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-budget-panel]");if(b){var c=b.getAttribute("data-budget-panel");if(cycles[c])setTimeout(function(){render(c)},80)}});
  window.addEventListener("load",function(){setTimeout(refresh,500);setTimeout(refresh,1500)});
  window.addEventListener("storage",refresh);
})();
}catch(e){console.error("budget-all: budget-cycle-graphs.js failed",e)}

/* ===== BUDGET-CATEGORIES ===== */
;try{
(function(){
  "use strict";
  var KEY="acxBudgetCategories", editing=null, chart=null;
  function read(){try{var v=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(v)?v:[]}catch(e){return []}}
  function write(rows){localStorage.setItem(KEY,JSON.stringify(rows));}
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function money(v){return "KES "+(Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
  function records(key){try{if(key==="budgets")return typeof budgets!=="undefined"?budgets:[];if(key==="actuals")return typeof actuals!=="undefined"?actuals:[];return []}catch(e){return []}}
  function sum(rows){return (rows||[]).reduce(function(total,r){return total+(r.months||[]).reduce(function(n,m){return n+(Number(m.amount)||0)},0)},0)}
  function fillSelectors(){var cats=read(),ids=["budgetCategory"];ids.forEach(function(id){var el=document.getElementById(id);if(!el)return;var old=el.value;el.innerHTML='<option value="">— Select category —</option>'+cats.slice().sort(function(a,b){return a.name.localeCompare(b.name)}).map(function(c){return '<option value="'+esc(c.name)+'" '+(c.active===false?'disabled':'')+'>'+esc(c.name)+' ('+esc(c.code)+')'+(c.active===false?' — Inactive':'')+'</option>'}).join("");if(cats.some(function(c){return c.name===old}))el.value=old;});}
  function render(){var cats=read(),budgets=records("budgets"),actuals=records("actuals"),search=(document.getElementById("acx-cat-search")||{}).value||"",filter=(document.getElementById("acx-cat-filter")||{}).value||"all";search=search.toLowerCase();
    var count=document.getElementById("acx-cat-count"),active=document.getElementById("acx-cat-active"),total=document.getElementById("acx-cat-budget-total");if(count)count.textContent=cats.length;if(active)active.textContent=cats.filter(function(c){return c.active!==false}).length;if(total)total.textContent=money(sum(budgets.filter(function(b){return !!b.category})));
    var rows=document.getElementById("acx-cat-rows");if(rows){var shown=cats.filter(function(c){return (filter==="all"||(filter==="active"?c.active!==false:c.active===false))&&[c.name,c.code,c.type,c.description].join(" ").toLowerCase().includes(search)});rows.innerHTML=shown.length?shown.map(function(c){var b=sum(budgets.filter(function(x){return x.category===c.name}));return '<tr class="border-t"><td class="p-3"><div class="font-semibold text-gray-900">'+esc(c.name)+'</div><div class="text-xs text-gray-500">'+esc(c.description||"")+'</div></td><td class="p-3 font-mono">'+esc(c.code)+'</td><td class="p-3">'+esc(c.type)+'</td><td class="p-3 text-right tabular-nums">'+money(b)+'</td><td class="p-3"><span class="px-2 py-1 rounded-full text-xs font-semibold '+(c.active===false?'bg-gray-100 text-gray-600':'bg-green-100 text-green-800')+'">'+(c.active===false?'Inactive':'Active')+'</span></td><td class="p-3 text-right whitespace-nowrap"><button type="button" onclick="acxBudgetCategoryEdit(\''+esc(c.id)+'\')" class="text-blue-800 font-semibold mr-2">Edit</button><button type="button" onclick="acxBudgetCategoryToggle(\''+esc(c.id)+'\')" class="text-gray-700 mr-2">'+(c.active===false?'Activate':'Deactivate')+'</button><button type="button" onclick="acxBudgetCategoryDelete(\''+esc(c.id)+'\')" class="text-red-600">Delete</button></td></tr>'}).join(""):'<tr><td colspan="6" class="p-4 text-center text-gray-500">No matching categories. Add a category using the form.</td></tr>'}
    var canvas=document.getElementById("acx-cat-chart");if(canvas&&typeof window.Chart==="function"){if(chart)chart.destroy();var labels=cats.map(function(c){return c.name}),planned=cats.map(function(c){return sum(budgets.filter(function(b){return b.category===c.name}))}),spent=cats.map(function(c){return sum(actuals.filter(function(a){return a.category===c.name}))});chart=new Chart(canvas.getContext("2d"),{type:"bar",data:{labels:labels,datasets:[{label:"Budget",data:planned,backgroundColor:"rgba(37,99,235,.65)"},{label:"Actual",data:spent,backgroundColor:"rgba(147,51,234,.65)"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"top"},tooltip:{callbacks:{label:function(ctx){return ctx.dataset.label+": "+money(ctx.parsed.y)}}}},scales:{y:{beginAtZero:true}}}})}
    fillSelectors();
  }
  function reset(){editing=null;var f=document.getElementById("acx-cat-form");if(f)f.reset();document.getElementById("acx-cat-id").value="";document.getElementById("acx-cat-status").checked=true;document.getElementById("acx-cat-form-title").textContent="Add Budget Category";document.getElementById("acx-cat-save").textContent="Save Category";document.getElementById("acx-cat-cancel").classList.add("hidden")}
  function edit(id){var c=read().find(function(x){return x.id===id});if(!c)return;editing=id;document.getElementById("acx-cat-id").value=c.id;document.getElementById("acx-cat-name").value=c.name;document.getElementById("acx-cat-code").value=c.code;document.getElementById("acx-cat-type").value=c.type;document.getElementById("acx-cat-description").value=c.description||"";document.getElementById("acx-cat-status").checked=c.active!==false;document.getElementById("acx-cat-form-title").textContent="Edit Budget Category";document.getElementById("acx-cat-save").textContent="Update Category";document.getElementById("acx-cat-cancel").classList.remove("hidden");document.getElementById("acx-cat-name").focus()}
  function toggle(id){var cats=read(),c=cats.find(function(x){return x.id===id});if(!c)return;c.active=c.active===false;write(cats);render()}
  function del(id){var cats=read(),c=cats.find(function(x){return x.id===id});if(!c)return;var used=records("budgets").some(function(x){return x.category===c.name})||records("actuals").some(function(x){return x.category===c.name});if(!confirm('Delete category "'+c.name+'"?'+(used?' Existing budget and actual records will be kept, but their category assignment will be cleared.':'')))return;cats=cats.filter(function(x){return x.id!==id});write(cats);if(used){records("budgets").forEach(function(x){if(x.category===c.name)x.category=""});records("actuals").forEach(function(x){if(x.category===c.name)x.category=""});if(typeof saveData==="function")saveData()}if(editing===id)reset();render()}
  function exportCsv(){var cats=read(),lines=[["Category Name","Code","Classification","Description","Status"].join(",")].concat(cats.map(function(c){return [c.name,c.code,c.type,c.description||"",c.active===false?"Inactive":"Active"].map(function(v){return '"'+String(v).replace(/"/g,'""')+'"'}).join(",")}));var blob=new Blob([lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="budget-categories.csv";a.click();URL.revokeObjectURL(a.href)}
  document.addEventListener("DOMContentLoaded",function(){var form=document.getElementById("acx-cat-form");if(form)form.addEventListener("submit",function(e){e.preventDefault();var name=document.getElementById("acx-cat-name").value.trim(),code=document.getElementById("acx-cat-code").value.trim().toUpperCase(),cats=read(),id=document.getElementById("acx-cat-id").value,duplicate=cats.find(function(c){return c.id!==id&&(c.name.toLowerCase()===name.toLowerCase()||c.code.toLowerCase()===code.toLowerCase())});if(!name||!code)return alert("Enter a category name and code.");if(duplicate)return alert("A category with this name or code already exists.");var prior=cats.find(function(c){return c.id===id}),oldName=prior&&prior.name,item={id:id||("cat-"+Date.now()+"-"+Math.random().toString(36).slice(2,7)),name:name,code:code,type:document.getElementById("acx-cat-type").value,description:document.getElementById("acx-cat-description").value.trim(),active:document.getElementById("acx-cat-status").checked,createdAt:prior&&prior.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};if(prior){cats=cats.map(function(c){return c.id===id?item:c})}else cats.push(item);write(cats);if(oldName&&oldName!==name){records("budgets").forEach(function(x){if(x.category===oldName)x.category=name});records("actuals").forEach(function(x){if(x.category===oldName)x.category=name});if(typeof saveData==="function")saveData()}reset();render();});render();});
  window.acxBudgetCategoryRender=render;window.acxBudgetCategoryReset=reset;window.acxBudgetCategoryEdit=edit;window.acxBudgetCategoryToggle=toggle;window.acxBudgetCategoryDelete=del;window.acxBudgetCategoryExport=exportCsv;
  document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest('[data-budget-panel="categories"]');if(b)setTimeout(render,80)});window.addEventListener("storage",function(e){if(e.key===KEY||e.key==="budgets"||e.key==="actuals")render()});
})();
}catch(e){console.error("budget-all: budget-categories.js failed",e)}

/* ===== BUDGET-DEPARTMENTS ===== */
;try{
(function(){
  'use strict';
  var KEY='acxBudgetDepartments', editing=null;
  function read(){try{var a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch(e){return []}}
  function employees(){
    var keys=['employees','payrollEmployees','acaciaPayrollEmployees'];
    for(var i=0;i<keys.length;i++){try{var a=JSON.parse(localStorage.getItem(keys[i])||'null');if(Array.isArray(a)&&a.length)return a;}catch(e){}}
    return [];
  }
  function idOf(e,i){return String(e.id||e.empID||e.employeeId||e.employeeID||e.code||i)}
  function nameOf(e,i){return String(e.name||e.fullName||e.employeeName||[e.firstName,e.lastName].filter(Boolean).join(' ')||e.full_name||('Employee '+(i+1)))}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fillBudgetDepartment(){var el=document.getElementById('budgetDepartment');if(!el)return;var prior=el.value,rows=read();el.innerHTML='<option value="">— Select department —</option>'+rows.map(function(d){return '<option value="'+esc(d.name)+'" '+(prior===d.name?'selected':'')+'>'+esc(d.name)+'</option>'}).join('');var lead=document.getElementById('budgetDepartmentLead');if(lead){var d=rows.find(function(x){return x.name===el.value});lead.value=d?d.leadName||'':'';}if(!el.__acxDeptBound){el.__acxDeptBound=true;el.addEventListener('change',function(){var d=read().find(function(x){return x.name===el.value}),lead=document.getElementById('budgetDepartmentLead');if(lead)lead.value=d?d.leadName||'':'';});}var current=rows.find(function(x){return x.name===el.value}),lead=document.getElementById('budgetDepartmentLead');if(lead)lead.value=current?current.leadName||'':'';}
  function fillEmployees(selected){var el=document.getElementById('acx-dept-lead');if(!el)return;var rows=employees();el.innerHTML='<option value="">— Select Payroll employee —</option>'+rows.map(function(e,i){return '<option value="'+esc(idOf(e,i))+'" '+(String(selected||'')===idOf(e,i)?'selected':'')+'>'+esc(nameOf(e,i))+'</option>'}).join('');var note=document.getElementById('acx-dept-payroll-note');if(note)note.textContent=rows.length?rows.length+' Payroll employee(s) available.':'No Payroll employees were found in this browser session. Open Payroll on the same company account and reload this page.';}
  function reset(){editing=null;var f=document.getElementById('acx-dept-form');if(f)f.reset();document.getElementById('acx-dept-id').value='';document.getElementById('acx-dept-form-title').textContent='Create Department';document.getElementById('acx-dept-save').textContent='Save Department';document.getElementById('acx-dept-cancel').classList.add('hidden');fillEmployees('');}
  function render(){fillBudgetDepartment();var rows=read(),q=(document.getElementById('acx-dept-search')||{}).value||'';q=q.toLowerCase();var body=document.getElementById('acx-dept-rows');if(!body)return;var shown=rows.filter(function(d){return (d.name+' '+(d.leadName||'')).toLowerCase().includes(q)});body.innerHTML=shown.length?shown.map(function(d){return '<tr class="border-t"><td class="p-3 font-semibold">'+esc(d.name)+'</td><td class="p-3">'+esc(d.leadName||'—')+'</td><td class="p-3 text-right whitespace-nowrap"><button type="button" class="text-blue-800 font-semibold mr-3" onclick="acxBudgetDepartmentEdit(\''+esc(d.id)+'\')">Edit</button><button type="button" class="text-red-600" onclick="acxBudgetDepartmentDelete(\''+esc(d.id)+'\')">Delete</button></td></tr>'}).join(''):'<tr><td colspan="3" class="p-4 text-center text-gray-500">No departments created yet.</td></tr>';}
  function edit(id){var d=read().find(function(x){return x.id===id});if(!d)return;editing=id;document.getElementById('acx-dept-id').value=id;document.getElementById('acx-dept-name').value=d.name;fillEmployees(d.leadId);document.getElementById('acx-dept-form-title').textContent='Edit Department';document.getElementById('acx-dept-save').textContent='Update Department';document.getElementById('acx-dept-cancel').classList.remove('hidden');}
  function del(id){var rows=read(),d=rows.find(function(x){return x.id===id});if(!d)return;if(!confirm('Delete department '+d.name+'? Existing budget records will not be deleted.'))return;write(rows.filter(function(x){return x.id!==id}));render();}
  function write(rows){localStorage.setItem(KEY,JSON.stringify(rows));try{window.dispatchEvent(new StorageEvent('storage',{key:KEY,newValue:JSON.stringify(rows)}))}catch(e){}}
  document.addEventListener('DOMContentLoaded',function(){var form=document.getElementById('acx-dept-form');if(!form)return;fillEmployees('');form.addEventListener('submit',function(e){e.preventDefault();var name=document.getElementById('acx-dept-name').value.trim(),leadId=document.getElementById('acx-dept-lead').value,emp=employees(),idx=emp.findIndex(function(x,i){return idOf(x,i)===leadId});if(!name||!leadId){alert('Enter the department name and select its head from Payroll.');return;}if(idx<0){alert('The selected Payroll employee could not be found. Refresh Payroll employees and try again.');return;}var rows=read(),duplicate=rows.some(function(x){return x.id!==editing&&x.name.toLowerCase()===name.toLowerCase()});if(duplicate){alert('A department with this name already exists.');return;}var item={id:editing||('dept-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)),name:name,leadId:leadId,leadName:nameOf(emp[idx],idx),updatedAt:new Date().toISOString()};if(editing)rows=rows.map(function(x){return x.id===editing?Object.assign({},x,item):x});else rows.push(item);write(rows);reset();render();});document.getElementById('acx-dept-cancel').addEventListener('click',reset);render();});
  window.acxBudgetDepartmentRender=render;window.acxBudgetDepartmentEdit=edit;window.acxBudgetDepartmentDelete=del;
  document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-budget-panel="departments"]');if(b)setTimeout(function(){fillEmployees('');render()},80)});
  window.addEventListener('storage',function(e){if(e.key==='employees'||e.key==='payrollEmployees'||e.key==='acxBudgetPayrollEmployees'||e.key===KEY){fillEmployees('');render()}});
})();
}catch(e){console.error("budget-all: budget-departments.js failed",e)}

/* ===== BUDGET-EXPENDITURE ===== */
;try{
/* Acacia Books - Budget > Record Expenditure (Actuals)
   Cascading form: Budget -> Department -> Budget Line, with Period Cycle / Timeframe / Fiscal Year
   auto-filled from the selected budget line. Loaded after app-3.js (overrides its actuals helpers). */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nk(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' '); }
  function B() { try { return Array.isArray(budgets) ? budgets : []; } catch (e) { return []; } }
  function A() { try { return Array.isArray(actuals) ? actuals : []; } catch (e) { return []; } }
  function bname(b) { return String(b.budgetName || b.name || b.account || '').trim(); }
  function dept(b) { return String(b.department || 'General').trim() || 'General'; }
  function approved(b) { return !b.status || b.status === 'Approved'; }

  /* ---- grouping helpers ---- */
  function groupItems(key) {           // indexes of budgets[] that belong to the budget named `key`
    var out = [];
    B().forEach(function (b, i) { if (nk(bname(b)) === key) out.push(i); });
    return out;
  }
  function selectedBudgetKey() { var e = $('actualBudget'); return e ? e.value : ''; }

  /* ---- 1. Budget ---- */
  function fillBudgets() {
    var el = $('actualBudget'); if (!el) return;
    var prior = el.value, seen = {}, rows = [];
    B().forEach(function (b) {
      var n = bname(b), k = nk(n); if (!k) return;
      if (!seen[k]) { seen[k] = { name: n, ok: false }; rows.push(k); }
      if (approved(b)) seen[k].ok = true;
    });
    el.innerHTML = '<option value="">— Select a budget —</option>' + rows.map(function (k) {
      var g = seen[k];
      return '<option value="' + esc(k) + '"' + (g.ok ? '' : ' disabled') + '>' + esc(g.name) + (g.ok ? '' : ' — pending approval') + '</option>';
    }).join('');
    if (prior && seen[prior] && seen[prior].ok) el.value = prior; else el.value = '';
    fillDepartments(true);
  }

  /* ---- 2. Department (only those belonging to the selected budget) ---- */
  function fillDepartments(keep) {
    var el = $('actualCategory'); if (!el) return;
    var key = selectedBudgetKey(), prior = keep ? el.value : '';
    if (!key) { el.innerHTML = '<option value="">— Select a budget first —</option>'; fillLines(false); return; }
    var seen = {}, list = [];
    groupItems(key).forEach(function (i) {
      var b = B()[i]; if (!approved(b)) return;
      var d = dept(b), k = nk(d); if (!seen[k]) { seen[k] = 1; list.push(d); }
    });
    el.innerHTML = '<option value="">— Select department —</option>' + list.map(function (d) { return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('');
    if (prior && list.indexOf(prior) > -1) el.value = prior;
    else if (list.length === 1) el.value = list[0];
    var hid = $('actualDepartment'); if (hid) hid.value = el.value;
    fillLines(keep);
  }

  /* ---- 3. Budget Line (only those in the selected budget + department) ---- */
  function fillLines(keep) {
    var el = $('actualAccount'); if (!el) return;
    var key = selectedBudgetKey(), d = $('actualCategory') ? $('actualCategory').value : '', prior = keep ? el.value : '';
    if (!key || !d) {
      el.innerHTML = '<option value="">— Select a department first —</option>'; clearAuto(); return;
    }
    var items = groupItems(key).filter(function (i) { var b = B()[i]; return approved(b) && nk(dept(b)) === nk(d); });
    var count = {}; items.forEach(function (i) { var k = nk(B()[i].account); count[k] = (count[k] || 0) + 1; });
    el.innerHTML = '<option value="">— Select budget line —</option>' + items.map(function (i) {
      var b = B()[i], extra = count[nk(b.account)] > 1 ? ' · ' + (b.period || 'Monthly') + ' ' + (b.year || '') : '';
      return '<option value="' + i + '">' + esc(b.account) + esc(extra) + '</option>';
    }).join('');
    if (prior && items.some(function (i) { return String(i) === prior; })) { el.value = prior; return; }   // keep user's progress on refresh
    if (items.length === 1) el.value = String(items[0]);
    if (el.value !== '') lineChanged(); else clearAuto();
  }

  /* ---- auto-filled Period Cycle / Timeframe / Fiscal Year ---- */
  function clearAuto() {
    ['actualPeriod', 'actualMonth', 'actualYear'].forEach(function (id) { var e = $(id); if (e) e.value = ''; });
    var q = $('actualQuarter'); if (q) q.innerHTML = '<option value=""></option>';
  }
  function pickEntry(b) {              // the budget period that covers today (or the nearest one)
    var ms = b.months || [], now = new Date(), y = now.getFullYear(), mo = now.getMonth() + 1, best = null, score = 1e9;
    ms.forEach(function (m) {
      var r = periodRange(m); if (!r) return;
      var s = (r.year === y && mo >= r.start && mo <= r.end) ? 0 : Math.abs((y * 12 + mo) - (r.year * 12 + r.start)) + 1;
      if (s < score) { score = s; best = m; }
    });
    return best || ms[0] || null;
  }
  function lineChanged(entry) {
    var b = B()[parseInt($('actualAccount').value, 10)];
    if (!b) { clearAuto(); return; }
    var m = entry || pickEntry(b), per = b.period || 'Monthly';
    var lab = m ? String(m.month || '') : '', yr = m ? entryYear(m) : (b.year || defaultFiscalYear());
    $('actualPeriod').value = per;
    $('actualYear').value = yr;
    var q = $('actualQuarter'); if (q) { q.innerHTML = '<option value="' + esc(lab) + '">' + esc(lab) + '</option>'; q.value = lab; }
    $('actualMonth').value = per === 'Annual' ? 'FY ' + yr : lab;   // Monthly reads this value; Quarterly reads #actualQuarter; Annual reads the year
  }

  /* ---- handlers wired from the form ---- */
  window.acxActualBudgetPicked = function () { fillDepartments(false); };
  window.acxActualDepartmentChanged = function () { var h = $('actualDepartment'); if (h) h.value = $('actualCategory').value; fillLines(false); };
  window.acxActualLineChanged = function () { lineChanged(); };

  /* Select a budget line programmatically (used by "+ Spend" in the ledger and by Edit) */
  function selectLine(idx, entry) {
    var b = B()[idx]; if (!b) return false;
    fillBudgets();
    $('actualBudget').value = nk(bname(b));
    fillDepartments(false);
    $('actualCategory').value = dept(b);
    var h = $('actualDepartment'); if (h) h.value = dept(b);
    fillLines(false);
    $('actualAccount').value = String(idx);
    lineChanged(entry);
    return $('actualAccount').value === String(idx);
  }
  window.fillActualForm = function (account, department, range) {
    var found = -1;
    B().forEach(function (b, i) {
      if (found > -1 || !approved(b) || nk(b.account) !== nk(account) || nk(dept(b)) !== nk(department || 'General')) return;
      found = i;
    });
    if (found < 0) return;
    var entry = null;
    if (range) (B()[found].months || []).forEach(function (m) {
      var r = periodRange(m); if (!entry && r && r.year === range.year && r.start === range.start && r.end === range.end) entry = m;
    });
    selectLine(found, entry);
  };
  window.pickActualLine = function (v) { var i = parseInt(v, 10); if (!isNaN(i)) { selectLine(i); var a = $('actualAmount'); if (a) a.focus(); } };

  /* ---- + Stage ---- */
  window.addActualMonthValue = function () {
    var b = B()[parseInt(($('actualAccount') || {}).value, 10)];
    if (!b) { alert('Select a budget, department and budget line first.'); return false; }
    var amt = parseFloat($('actualAmount').value);
    if (isNaN(amt) || amt <= 0) { alert('Enter a valid actual amount greater than zero.'); return false; }
    var t = readTimeframe('actual');
    if (!t.label) { alert('This budget line has no timeframe to post against.'); return false; }
    actualMonthValues.push({ month: t.label, amount: amt, year: t.year, period: t.period, posted: new Date().toISOString().slice(0, 10), description: ($('actualDescription').value || '').trim() });
    renderActualMonthPreview();
    $('actualAmount').value = '';
    return true;
  };

  /* ---- Post Actual Transaction ---- */
  window.addActuals = function () {
    if (!$('actualBudget').value) return alert('Select a budget.');
    if (!$('actualCategory').value) return alert('Select a department.');
    var b = B()[parseInt($('actualAccount').value, 10)];
    if (!b) return alert('Select a budget line.');
    if (!approved(b)) return alert('This budget is pending approval. Expenditure cannot be recorded until it is approved.');
    var desc = ($('actualDescription').value || '').trim();
    if (!desc) return alert('Enter the description / reason for this expenditure.');
    if ($('actualAmount').value !== '' && !window.addActualMonthValue()) return;   // amount typed but not staged: stage it now
    if (actualMonthValues.length === 0) return alert('Enter the actual amount (then + Stage, or post directly).');
    var months = actualMonthValues.map(function (m) { return Object.assign({}, m, { description: m.description || desc }); });
    /* department spending limit (warn / hard-stop) */
    var skip = editingActualIndex !== null ? actuals[editingActualIndex] : null, byYear = {};
    months.forEach(function (m) { var y = entryYear(m); byYear[y] = (byYear[y] || 0) + (Number(m.amount) || 0); });
    for (var yr in byYear) { if (typeof window.acxCheckSpendingLimit === 'function' && !window.acxCheckSpendingLimit(dept(b), yr, byYear[yr], skip)) return; }
    var key = nk(b.account) + '|' + nk(dept(b));
    var rec = { account: b.account, department: dept(b), category: b.category || '', budgetName: bname(b), period: b.period || 'Monthly', months: months };
    if (editingActualIndex !== null) { rec.id = (actuals[editingActualIndex] || {}).id; actuals[editingActualIndex] = rec; editingActualIndex = null; }
    else {
      var ex = A().find(function (e) { return nk(e.account) + '|' + nk(e.department || 'General') === key; });
      if (ex) { ex.months.push.apply(ex.months, months); if (!ex.budgetName) ex.budgetName = rec.budgetName; } else A().push(rec);
    }
    actualMonthValues = [];
    saveData();
    renderActualMonthPreview();
    if (typeof refreshBudgetViews === 'function') refreshBudgetViews(); else { renderActuals(); renderComparison(); }
    $('actualDescription').value = ''; $('actualAmount').value = '';
    $('actualAccount').value = ''; fillLines(false);      // budget stays selected for the next posting
  };

  /* ---- Edit an existing actuals record ---- */
  window.editActual = function (i) {
    var t = A()[i]; if (!t) return;
    var idx = -1;
    B().forEach(function (b, k) {
      if (nk(b.account) !== nk(t.account) || nk(dept(b)) !== nk(t.department || 'General')) return;
      if (idx < 0 || (t.budgetName && nk(bname(b)) === nk(t.budgetName))) idx = k;
    });
    if (idx < 0) return alert('This entry is not linked to a budget line (it was posted before budgets were required). Delete it and re-post it against a budget.');
    var first = (t.months || [])[0];
    if (!selectLine(idx, first || null)) return alert('The matching budget is not approved, so this entry cannot be edited.');
    $('actualDescription').value = (first && first.description) || '';
    $('actualPeriod').value = t.period || $('actualPeriod').value;
    if (first) $('actualYear').value = entryYear(first);
    actualMonthValues = JSON.parse(JSON.stringify(t.months || []));
    renderActualMonthPreview();
    editingActualIndex = i;
    var el = $('actualAmount'); if (el) { el.scrollIntoView && el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  };

  /* ---- show the description in the posted list ---- */
  var baseRender = window.renderActuals;
  window.renderActuals = function () {
    var box = $('actualsList'); if (!box) return;
    var list = A();
    if (!list.length) { box.innerHTML = "<p class='text-gray-500'>No actual entries saved.</p>"; return; }
    box.innerHTML = list.map(function (e, i) {
      return '<div class="border p-2 mb-1 rounded"><strong>' + esc(e.account) + '</strong> — ' + esc(e.department) + (e.budgetName ? ' · ' + esc(e.budgetName) : '') + ' (' + esc(e.period) + ')' +
        '<div class="text-sm mt-1">' + (e.months || []).map(function (m) {
          return esc(periodText(m)) + ': KES ' + (+m.amount || 0).toLocaleString() + (m.description ? ' <span class="text-gray-500">(' + esc(m.description) + ')</span>' : '');
        }).join('<br>') + '</div>' +
        '<div class="mt-2"><button onclick="editActual(' + i + ')" class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800">Edit</button> ' +
        '<button onclick="deleteActual(' + i + ')" class="border border-blue-900 text-white bg-blue-900 font-bold px-1 py-1 rounded hover:bg-blue-800">Delete</button></div></div>';
    }).join('');
  };

  /* ---- keep the Budget list current ---- */
  var baseBudgets = window.renderBudgets;
  if (typeof baseBudgets === 'function') window.renderBudgets = function () { var r = baseBudgets.apply(this, arguments); try { fillBudgets(); } catch (e) {} return r; };
  function init() { fillBudgets(); if (typeof window.renderActuals === 'function') try { window.renderActuals(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 300); }); else setTimeout(init, 300);
  setTimeout(fillBudgets, 1500);                                   // after cloud/IndexedDB data lands
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-budget-panel]')) setTimeout(fillBudgets, 80); });
  document.addEventListener('mousedown', function (e) { if (e.target && e.target.id === 'actualBudget') fillBudgets(); }, true);
  window.addEventListener('storage', function (e) { if (e.key === 'budgets') fillBudgets(); });
  window.acxActualFormRefresh = fillBudgets;
})();
}catch(e){console.error("budget-all: budget-expenditure.js failed",e)}

/* ===== BUDGET CONTROLS: Transfers, Department Spending Limits, Project Allocations ===== */
;try{
(function () {
  'use strict';
  var KT = 'budgetTransfers', KL = 'spendingLimits', KP = 'projectAllocations';
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nk(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' '); }
  function read(k) { try { var v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function write(k, v) { localStorage.setItem(k, JSON.stringify(v)); try { window.dispatchEvent(new StorageEvent('storage', { key: k })); } catch (e) {} }
  function B() { try { return Array.isArray(budgets) ? budgets : []; } catch (e) { return []; } }
  function A() { try { return Array.isArray(actuals) ? actuals : []; } catch (e) { return []; } }
  function bname(b) { return String(b.budgetName || b.name || b.account || '').trim(); }
  function dept(b) { return String(b.department || 'General').trim() || 'General'; }
  function approved(b) { return !b.status || b.status === 'Approved'; }
  function yearOf(b) { var m = (b.months || [])[0]; return Number(b.year) || (m ? entryYear(m) : new Date().getFullYear()); }
  function lineKey(b) { return [nk(bname(b)), nk(dept(b)), nk(b.account), yearOf(b)].join('|'); }
  function lineTotal(b) { return (b.months || []).reduce(function (n, m) { return n + (Number(m.amount) || 0); }, 0); }
  function money(n) { return 'KES ' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function flag(k, d) { var v = localStorage.getItem(k); return v === null ? d : v === 'true'; }
  function isExec() { try { return /admin|owner|ceo|director|executive/i.test(String((JSON.parse(localStorage.getItem('loggedInUser') || '{}') || {}).role || '')); } catch (e) { return false; } }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(16).slice(2); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function who() { try { var u = JSON.parse(localStorage.getItem('loggedInUser') || '{}') || {}; return u.name || u.username || u.email || ''; } catch (e) { return ''; } }
  function allDepts() {
    var seen = {}, out = [];
    function add(d) { d = String(d || '').trim(); if (d && !seen[nk(d)]) { seen[nk(d)] = 1; out.push(d); } }
    read('acxBudgetDepartments').forEach(function (d) { add(d.name); });
    B().forEach(function (b) { add(b.department); });
    read('projects').forEach(function (p) { add(p.department); });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function budgetDepts() {
    var seen = {}, out = [];
    B().forEach(function (b) { if (approved(b) && !seen[nk(dept(b))]) { seen[nk(dept(b))] = 1; out.push(dept(b)); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function deptLines(d) { var out = []; B().forEach(function (b, i) { if (approved(b) && nk(dept(b)) === nk(d)) out.push(i); }); return out; }
  function pickIdx(b) {
    var ms = b.months || [], now = new Date(), y = now.getFullYear(), mo = now.getMonth() + 1, best = -1, score = 1e9;
    ms.forEach(function (m, i) { var r = periodRange(m); if (!r) return; var s = (r.year === y && mo >= r.start && mo <= r.end) ? 0 : Math.abs((y * 12 + mo) - (r.year * 12 + r.start)) + 1; if (s < score) { score = s; best = i; } });
    return best < 0 ? (ms.length ? 0 : -1) : best;
  }
  function spentOnEntry(b, m) {
    var r = periodRange(m), t = 0; if (!r) return 0;
    A().forEach(function (a) {
      if (nk(a.account) !== nk(b.account) || nk(a.department || 'General') !== nk(dept(b))) return;
      (a.months || []).forEach(function (x) { var q = periodRange(x); if (q && q.year === r.year && q.start >= r.start && q.end <= r.end) t += Number(x.amount) || 0; });
    });
    return t;
  }
  function fillSelect(id, placeholder, rows, keep) {   // rows: [{v,t,disabled}]
    var el = $(id); if (!el) return; var prior = keep ? el.value : '';
    el.innerHTML = '<option value="">' + esc(placeholder) + '</option>' + rows.map(function (r) { return '<option value="' + esc(r.v) + '"' + (r.disabled ? ' disabled' : '') + '>' + esc(r.t) + '</option>'; }).join('');
    if (prior && rows.some(function (r) { return String(r.v) === prior && !r.disabled; })) el.value = prior;
  }
  var LBL = 'block text-sm font-semibold text-gray-700 mb-1', INP = 'w-full border border-gray-300 rounded-lg p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-600';
  var BTN = 'px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 text-sm font-bold transition-colors', CARD = 'bg-white p-5 rounded-xl border border-gray-200 shadow-sm', H3 = 'font-bold text-gray-900 text-sm border-b border-gray-100 pb-3 mb-4';
  function refreshBudgetScreens() { try { saveData(); } catch (e) {} try { renderBudgets(); } catch (e) {} try { renderComparison(); } catch (e) {} try { if (typeof refreshBudgetViews === 'function') refreshBudgetViews(); } catch (e) {} }

  /* =====================================================================
     1. BUDGET TRANSFERS  (department -> budget line -> period, both sides)
     ===================================================================== */
  function trBlock(p, title) {
    return '<div class="p-3 border border-gray-200 rounded-xl bg-gray-50/50 space-y-2.5"><div class="text-sm font-bold text-blue-900 uppercase tracking-wide">' + title + '</div>' +
      '<div><label class="' + LBL + '">Department</label><select id="' + p + 'Dept" class="' + INP + '"></select></div>' +
      '<div><label class="' + LBL + '">Budget</label><select id="' + p + 'Line" class="' + INP + '"></select></div>' +
      '<div><label class="' + LBL + '">Period</label><select id="' + p + 'Per" class="' + INP + '"></select></div>' +
      '<div id="' + p + 'Info" class="text-sm text-gray-600"></div></div>';
  }
  function mountTransfers() {
    var p = $('acxBudgetPanel-transfers'); if (!p || p.getAttribute('data-acx')) return; p.setAttribute('data-acx', '1');
    p.innerHTML = '<div class="grid grid-cols-1 lg:grid-cols-3 gap-6"><div class="' + CARD + ' space-y-3"><h3 class="' + H3 + '">Transfer Between Budgets</h3>' +
      trBlock('acxTrFrom', 'From') + trBlock('acxTrTo', 'To') +
      '<div><label class="' + LBL + '">Amount (KES)</label><input id="acxTrAmount" type="number" min="0" step="0.01" placeholder="0.00" class="' + INP + '"/></div>' +
      '<div><label class="' + LBL + '">Reason</label><input id="acxTrReason" autocomplete="off" placeholder="Why is this being moved?" class="' + INP + '"/></div>' +
      '<button id="acxTrPost" type="button" class="' + BTN + ' w-full">Post Transfer</button></div>' +
      '<div class="lg:col-span-2 ' + CARD + '"><h3 class="' + H3 + '">Transfer History</h3><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-600"><tr><th class="p-2">Date</th><th class="p-2">From (department · budget · period)</th><th class="p-2">To (department · budget · period)</th><th class="p-2 text-right">Amount</th><th class="p-2">Reason</th><th class="p-2">Status</th><th class="p-2"></th></tr></thead><tbody id="acxTrRows"></tbody></table></div></div></div>';
    p.addEventListener('change', function (e) {
      var id = e.target.id || '', pre = id.indexOf('acxTrFrom') === 0 ? 'acxTrFrom' : id.indexOf('acxTrTo') === 0 ? 'acxTrTo' : '';
      if (!pre) return;
      if (/Dept$/.test(id)) trLines(pre, false); else if (/Line$/.test(id)) trPeriods(pre, false); else if (/Per$/.test(id)) trInfo(pre);
    });
    $('acxTrPost').addEventListener('click', postTransfer);
    p.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-tr-rev]'); if (b) reverseTransfer(b.getAttribute('data-tr-rev')); });
  }
  function trDepts() {
    var ds = budgetDepts();
    ['acxTrFrom', 'acxTrTo'].forEach(function (p) {
      fillSelect(p + 'Dept', '— Select department —', ds.map(function (d) { return { v: d, t: d }; }), true);
      trLines(p, true);
    });
  }
  function trLines(p, keep) {
    var d = ($(p + 'Dept') || {}).value, rows = d ? deptLines(d).map(function (i) { var b = B()[i]; return { v: i, t: bname(b) + ' — ' + b.account + ' (' + yearOf(b) + ')' }; }) : [];
    fillSelect(p + 'Line', d ? '— Select budget —' : '— Select a department first —', rows, keep);
    var el = $(p + 'Line'); if (el && !keep && rows.length === 1) el.value = String(rows[0].v);
    trPeriods(p, keep);
  }
  function trPeriods(p, keep) {
    var b = B()[parseInt(($(p + 'Line') || {}).value, 10)], rows = b ? (b.months || []).map(function (m, i) { return { v: i, t: periodText(m) }; }) : [];
    fillSelect(p + 'Per', b ? '— Select period —' : '— Select a budget first —', rows, keep);
    var el = $(p + 'Per'); if (el && b && !(keep && el.value !== '')) el.value = String(pickIdx(b));
    trInfo(p);
  }
  function trInfo(p) {
    var el = $(p + 'Info'); if (!el) return;
    var b = B()[parseInt(($(p + 'Line') || {}).value, 10)], m = b && (b.months || [])[parseInt(($(p + 'Per') || {}).value, 10)];
    if (!b || !m) { el.textContent = ''; return; }
    var amt = Number(m.amount) || 0, sp = spentOnEntry(b, m);
    el.innerHTML = p === 'acxTrFrom' ? 'Allocated ' + money(amt) + ' · Spent ' + money(sp) + ' · <b>Available ' + money(amt - sp) + '</b>' : 'Current allocation ' + money(amt) + ' · Spent ' + money(sp);
  }
  function entryOf(b, label, year) { var f = null; (b.months || []).forEach(function (m) { if (!f && String(m.month) === String(label) && entryYear(m) === Number(year)) f = m; }); return f; }
  function postTransfer() {
    if (window.requirePermission && !window.requirePermission('budgetsTab', 'edit', 'transfer budget funds')) return;
    var fb = B()[parseInt($('acxTrFromLine').value, 10)], tb = B()[parseInt($('acxTrToLine').value, 10)];
    if (!$('acxTrFromDept').value || !fb) return alert('Select the department and budget to transfer FROM.');
    if (!$('acxTrToDept').value || !tb) return alert('Select the department and budget to transfer TO.');
    var fm = (fb.months || [])[parseInt($('acxTrFromPer').value, 10)], tm = (tb.months || [])[parseInt($('acxTrToPer').value, 10)];
    if (!fm || !tm) return alert('Select the period on both sides.');
    if (fm === tm) return alert('The source and destination are the same budget and period.');
    var amt = parseFloat($('acxTrAmount').value);
    if (isNaN(amt) || amt <= 0) return alert('Enter a transfer amount greater than zero.');
    var avail = (Number(fm.amount) || 0) - spentOnEntry(fb, fm);
    if (amt > avail + 0.0001) return alert('Only ' + money(avail) + ' is still available in "' + fb.account + '" (' + periodText(fm) + '). Spent amounts cannot be transferred.');
    var reason = ($('acxTrReason').value || '').trim(); if (!reason) return alert('Enter the reason for the transfer.');
    if (!confirm('Move ' + money(amt) + '\nFROM ' + dept(fb) + ' · ' + fb.account + ' (' + periodText(fm) + ')\nTO ' + dept(tb) + ' · ' + tb.account + ' (' + periodText(tm) + ')?')) return;
    fm.amount = (Number(fm.amount) || 0) - amt; tm.amount = (Number(tm.amount) || 0) + amt;
    var rows = read(KT);
    rows.unshift({ id: uid(), date: today(), by: who(), amount: amt, reason: reason, status: 'Posted',
      fromDepartment: dept(fb), fromBudget: bname(fb), fromLine: fb.account, fromKey: lineKey(fb), fromPeriod: String(fm.month), fromYear: entryYear(fm), fromPeriodText: periodText(fm),
      toDepartment: dept(tb), toBudget: bname(tb), toLine: tb.account, toKey: lineKey(tb), toPeriod: String(tm.month), toYear: entryYear(tm), toPeriodText: periodText(tm) });
    write(KT, rows);
    refreshBudgetScreens();
    $('acxTrAmount').value = ''; $('acxTrReason').value = '';
    renderTransfers(); ['acxTrFrom', 'acxTrTo'].forEach(trInfo);
  }
  function reverseTransfer(id) {
    var rows = read(KT), t = rows.find(function (x) { return x.id === id; }); if (!t || t.status !== 'Posted') return;
    var fb = B().find(function (b) { return lineKey(b) === t.fromKey; }), tb = B().find(function (b) { return lineKey(b) === t.toKey; });
    var fm = fb && entryOf(fb, t.fromPeriod, t.fromYear), tm = tb && entryOf(tb, t.toPeriod, t.toYear);
    if (!fm || !tm) return alert('One of the budgets in this transfer no longer exists, so it cannot be reversed.');
    var avail = (Number(tm.amount) || 0) - spentOnEntry(tb, tm);
    if (t.amount > avail + 0.0001) return alert('The receiving budget has already spent part of this money. Only ' + money(avail) + ' can be returned.');
    if (!confirm('Reverse this transfer of ' + money(t.amount) + '?')) return;
    tm.amount = (Number(tm.amount) || 0) - t.amount; fm.amount = (Number(fm.amount) || 0) + t.amount;
    t.status = 'Reversed'; t.reversedOn = today(); write(KT, rows); refreshBudgetScreens(); renderTransfers(); ['acxTrFrom', 'acxTrTo'].forEach(trInfo);
  }
  function renderTransfers() {
    var body = $('acxTrRows'); if (!body) return; var rows = read(KT);
    body.innerHTML = rows.length ? rows.map(function (t) {
      return '<tr class="border-t align-top"><td class="p-2 whitespace-nowrap">' + esc(t.date) + '</td>' +
        '<td class="p-2"><div class="font-semibold">' + esc(t.fromDepartment) + '</div><div class="text-gray-500 text-xs">' + esc(t.fromBudget) + ' — ' + esc(t.fromLine) + ' · ' + esc(t.fromPeriodText) + '</div></td>' +
        '<td class="p-2"><div class="font-semibold">' + esc(t.toDepartment) + '</div><div class="text-gray-500 text-xs">' + esc(t.toBudget) + ' — ' + esc(t.toLine) + ' · ' + esc(t.toPeriodText) + '</div></td>' +
        '<td class="p-2 text-right whitespace-nowrap">' + money(t.amount) + '</td><td class="p-2">' + esc(t.reason) + '</td>' +
        '<td class="p-2"><span class="text-xs font-semibold px-2 py-0.5 rounded-full ' + (t.status === 'Posted' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600') + '">' + esc(t.status) + '</span></td>' +
        '<td class="p-2">' + (t.status === 'Posted' ? '<button type="button" data-tr-rev="' + esc(t.id) + '" class="px-2 py-0.5 rounded border border-blue-900 text-blue-900 text-xs font-bold hover:bg-blue-900 hover:text-white">Reverse</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="p-4 text-center text-gray-500">No transfers recorded yet.</td></tr>';
  }

  /* =====================================================================
     2. DEPARTMENT SPENDING LIMITS  (per department + fiscal year)
     ===================================================================== */
  function spentDept(d, year, skipRec) {
    var t = 0;
    A().forEach(function (a) {
      if (a === skipRec || nk(a.department || 'General') !== nk(d)) return;
      (a.months || []).forEach(function (m) { if (entryYear(m) === Number(year)) t += Number(m.amount) || 0; });
    });
    return t;
  }
  function effAction(l) { return l.action === 'block' ? 'block' : l.action === 'warn' ? 'warn' : (flag('enforceLimits', false) ? 'block' : 'warn'); }
  function limitFor(d, year) { return read(KL).find(function (l) { return nk(l.department) === nk(d) && Number(l.year) === Number(year) && l.active !== false; }); }
  /* Called before an expenditure is posted. Returns true to go ahead, false to stop. */
  window.acxCheckSpendingLimit = function (department, year, addAmount, skipRec) {
    var lim = limitFor(department, year); if (!lim) return true;
    var limit = Number(lim.limitAmount) || 0; if (limit <= 0) return true;
    var spent = spentDept(department, year, skipRec), after = spent + addAmount, thr = Number(lim.warnAt) || 85;
    var head = 'Department: ' + department + '  (FY ' + year + ')\nSpending limit: ' + money(limit) + '\nAlready spent: ' + money(spent) + '\nThis posting: ' + money(addAmount);
    if (after > limit) {
      var msg = head + '\nOver the limit by: ' + money(after - limit);
      if (effAction(lim) === 'block') {
        if (flag('allowOverrides', true) && isExec()) return confirm('SPENDING LIMIT HARD-STOP\n\n' + msg + '\n\nPost anyway with executive override?');
        alert('SPENDING LIMIT HARD-STOP\n\n' + msg + '\n\nThis expenditure is blocked.' + (flag('allowOverrides', true) ? ' An authorised executive can override it.' : ''));
        return false;
      }
      return confirm('SPENDING LIMIT EXCEEDED\n\n' + msg + '\n\nPost anyway?');
    }
    if (flag('enableAlerts', true) && after >= limit * thr / 100) return confirm('SPENDING LIMIT WARNING\n\n' + head + '\nAfter posting: ' + Math.round(after / limit * 100) + '% of the limit used (alert at ' + thr + '%).\n\nContinue?');
    return true;
  };
  function mountLimits() {
    var p = $('acxBudgetPanel-limits'); if (!p || p.getAttribute('data-acx')) return; p.setAttribute('data-acx', '1');
    var w = document.createElement('div'); w.className = 'grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6';
    w.innerHTML = '<div class="' + CARD + ' space-y-3"><h3 class="' + H3 + '" id="acxLimTitle">Department Spending Limit</h3><input type="hidden" id="acxLimId"/>' +
      '<div><label class="' + LBL + '">Department</label><select id="acxLimDept" class="' + INP + '"></select></div>' +
      '<div class="grid grid-cols-2 gap-3"><div><label class="' + LBL + '">Fiscal Year</label><input id="acxLimYear" type="number" class="' + INP + '"/></div>' +
      '<div><label class="' + LBL + '">Warn at (%)</label><input id="acxLimWarn" type="number" min="1" max="100" value="85" class="' + INP + '"/></div></div>' +
      '<div><label class="' + LBL + '">Spending Limit (KES)</label><input id="acxLimAmount" type="number" min="0" step="0.01" placeholder="0.00" class="' + INP + '"/></div>' +
      '<div><label class="' + LBL + '">When the limit is exceeded</label><select id="acxLimAction" class="' + INP + '"><option value="policy">Follow policy rules (Hard Limit Enforcement)</option><option value="warn">Warn only</option><option value="block">Hard-stop (block posting)</option></select></div>' +
      '<div class="flex gap-2"><button id="acxLimSave" type="button" class="' + BTN + ' flex-1">Save Department Limit</button><button id="acxLimCancel" type="button" class="hidden px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-bold">Cancel</button></div>' +
      '<p class="text-xs text-gray-500">One limit per department per fiscal year. “Follow policy rules” blocks only when Hard Limit Enforcement is on below; warnings need Automated Alerts on.</p></div>' +
      '<div class="lg:col-span-2 ' + CARD + '"><h3 class="' + H3 + '">Limits vs Expenditure</h3><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-600"><tr><th class="p-2">Department</th><th class="p-2">Year</th><th class="p-2 text-right">Limit</th><th class="p-2 text-right">Spent</th><th class="p-2 text-right">Remaining</th><th class="p-2" style="min-width:110px">Used</th><th class="p-2">If exceeded</th><th class="p-2"></th></tr></thead><tbody id="acxLimRows"></tbody></table></div></div>';
    p.insertBefore(w, p.firstChild);
    $('acxLimYear').value = new Date().getFullYear();
    $('acxLimSave').addEventListener('click', saveLimit);
    $('acxLimCancel').addEventListener('click', resetLimitForm);
    w.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-lim]'); if (!b) return;
      var id = b.getAttribute('data-lim'), op = b.getAttribute('data-op'), rows = read(KL), l = rows.find(function (x) { return x.id === id; }); if (!l) return;
      if (op === 'del') { if (confirm('Delete the ' + l.department + ' spending limit for ' + l.year + '?')) { write(KL, rows.filter(function (x) { return x.id !== id; })); renderLimits(); } }
      else { $('acxLimId').value = l.id; $('acxLimDept').value = l.department; $('acxLimYear').value = l.year; $('acxLimAmount').value = l.limitAmount; $('acxLimWarn').value = l.warnAt || 85; $('acxLimAction').value = l.action || 'policy'; $('acxLimTitle').textContent = 'Edit Department Limit'; $('acxLimCancel').classList.remove('hidden'); }
    });
  }
  function resetLimitForm() { ['acxLimId', 'acxLimAmount'].forEach(function (i) { $(i).value = ''; }); $('acxLimDept').value = ''; $('acxLimWarn').value = 85; $('acxLimAction').value = 'policy'; $('acxLimYear').value = new Date().getFullYear(); $('acxLimTitle').textContent = 'Department Spending Limit'; $('acxLimCancel').classList.add('hidden'); }
  function saveLimit() {
    if (window.requirePermission && !window.requirePermission('budgetsTab', $('acxLimId').value ? 'edit' : 'add', 'set spending limits')) return;
    var d = $('acxLimDept').value, y = parseInt($('acxLimYear').value, 10), amt = parseFloat($('acxLimAmount').value), warn = parseInt($('acxLimWarn').value, 10) || 85;
    if (!d) return alert('Select a department.');
    if (!y) return alert('Enter the fiscal year.');
    if (isNaN(amt) || amt <= 0) return alert('Enter a spending limit greater than zero.');
    var rows = read(KL), id = $('acxLimId').value, dup = rows.find(function (x) { return nk(x.department) === nk(d) && Number(x.year) === y && x.id !== id; });
    if (dup) { if (!confirm(d + ' already has a limit for ' + y + '. Replace it?')) return; rows = rows.filter(function (x) { return x.id !== dup.id; }); }
    var rec = rows.find(function (x) { return x.id === id; });
    if (rec) { rec.department = d; rec.year = y; rec.limitAmount = amt; rec.warnAt = warn; rec.action = $('acxLimAction').value; }
    else rows.push({ id: uid(), department: d, year: y, limitAmount: amt, warnAt: warn, action: $('acxLimAction').value, active: true, created: today(), by: who() });
    write(KL, rows); resetLimitForm(); renderLimits();
  }
  var ACT = { policy: 'Policy rules', warn: 'Warn only', block: 'Hard-stop' };
  function limitRows() {
    return read(KL).sort(function (a, b) { return a.department.localeCompare(b.department) || b.year - a.year; }).map(function (l) {
      var limit = Number(l.limitAmount) || 0, spent = spentDept(l.department, l.year), pct = limit ? spent / limit * 100 : 0;
      return { l: l, limit: limit, spent: spent, remaining: limit - spent, pct: pct, status: spent > limit ? 'Over limit' : pct >= (Number(l.warnAt) || 85) ? 'Near limit' : 'Within limit' };
    });
  }
  function renderLimits() {
    fillSelect('acxLimDept', '— Select department —', allDepts().map(function (d) { return { v: d, t: d }; }), true);
    var body = $('acxLimRows'); if (!body) return; var rows = limitRows();
    body.innerHTML = rows.length ? rows.map(function (r) {
      var col = r.status === 'Over limit' ? 'bg-red-500' : r.status === 'Near limit' ? 'bg-amber-500' : 'bg-green-500', tc = r.status === 'Over limit' ? 'text-red-600' : r.status === 'Near limit' ? 'text-amber-700' : 'text-green-700';
      return '<tr class="border-t"><td class="p-2 font-semibold">' + esc(r.l.department) + '</td><td class="p-2">' + esc(r.l.year) + '</td><td class="p-2 text-right whitespace-nowrap">' + money(r.limit) + '</td><td class="p-2 text-right whitespace-nowrap">' + money(r.spent) + '</td>' +
        '<td class="p-2 text-right whitespace-nowrap ' + tc + '">' + money(r.remaining) + '</td>' +
        '<td class="p-2"><div class="h-1.5 bg-gray-200 rounded"><div class="h-1.5 rounded ' + col + '" style="width:' + Math.min(100, r.pct).toFixed(0) + '%"></div></div><div class="text-xs mt-0.5 ' + tc + '">' + r.pct.toFixed(0) + '% · ' + r.status + '</div></td>' +
        '<td class="p-2 text-xs">' + ACT[r.l.action || 'policy'] + (r.l.action ? '' : ' (' + (effAction(r.l) === 'block' ? 'hard-stop' : 'warn') + ')') + '</td>' +
        '<td class="p-2 whitespace-nowrap"><button type="button" data-lim="' + esc(r.l.id) + '" data-op="edit" class="px-2 py-0.5 rounded border border-blue-900 text-blue-900 text-xs font-bold hover:bg-blue-900 hover:text-white">Edit</button> <button type="button" data-lim="' + esc(r.l.id) + '" data-op="del" class="px-2 py-0.5 rounded border border-red-700 text-red-700 text-xs font-bold hover:bg-red-700 hover:text-white">Delete</button></td></tr>';
    }).join('') : '<tr><td colspan="8" class="p-4 text-center text-gray-500">No department limits yet. Pick a department, enter its limit and save.</td></tr>';
  }
  /* The Budget Reports "limit" table reads the same data */
  window.renderBudgetLimitReport = function () {
    var body = $('budgetLimitReportBody'); if (!body) return; var rows = limitRows();
    body.innerHTML = rows.length ? rows.map(function (r) {
      return '<tr class="border-t"><td class="p-2">' + esc(r.l.department) + '</td><td class="p-2">FY ' + esc(r.l.year) + '</td><td class="p-2 text-right">' + money(r.limit).slice(4) + '</td><td class="p-2 text-right">' + money(r.spent).slice(4) + '</td><td class="p-2 text-right">' + money(r.remaining).slice(4) + '</td><td class="p-2">' + (r.status === 'Over limit' ? '<span class="text-red-600 font-semibold">Over limit</span>' : r.status === 'Near limit' ? '<span class="text-amber-700 font-semibold">Near limit</span>' : '<span class="text-green-700">Within limit</span>') + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="p-3 text-center text-gray-500">No department spending limits have been saved yet. Add limits under Budget → Spending Limits.</td></tr>';
  };

  /* =====================================================================
     3. PROJECT ALLOCATIONS  (always filtered by the selected department)
     ===================================================================== */
  function allocated(d) { return read(KP).filter(function (a) { return nk(a.department) === nk(d); }); }
  function mountProjects() {
    var p = $('acxBudgetPanel-project'); if (!p || p.getAttribute('data-acx')) return; p.setAttribute('data-acx', '1');
    p.innerHTML = '<div class="' + CARD + ' mb-6"><label class="' + LBL + '">Department</label><select id="acxPaDept" class="' + INP + '" style="max-width:360px"></select><p class="text-xs text-gray-500 mt-1">Only the selected department’s projects and allocations are shown.</p></div><div id="acxPaBody"></div>';
    $('acxPaDept').addEventListener('change', renderProjects);
    p.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pa-del]'); if (b) { var id = b.getAttribute('data-pa-del'); if (confirm('Remove this project allocation?')) { write(KP, read(KP).filter(function (x) { return x.id !== id; })); renderProjects(); } return; }
      if (e.target.id === 'acxPaSave') savePA();
    });
    p.addEventListener('change', function (e) { if (e.target.id === 'acxPaLine') paAvail(); });
  }
  function paAvail() {
    var el = $('acxPaAvail'), b = B()[parseInt(($('acxPaLine') || {}).value, 10)]; if (!el) return;
    if (!b) { el.textContent = ''; return; }
    var used = read(KP).filter(function (a) { return a.lineKey === lineKey(b); }).reduce(function (n, a) { return n + (Number(a.amount) || 0); }, 0);
    el.innerHTML = 'Budget line total ' + money(lineTotal(b)) + ' · Already allocated to projects ' + money(used) + ' · <b>Unallocated ' + money(lineTotal(b) - used) + '</b>';
  }
  function renderProjects() {
    var sel = $('acxPaDept'); if (!sel) return;
    fillSelect('acxPaDept', '— Select a department —', allDepts().map(function (d) { return { v: d, t: d }; }), true);
    var d = sel.value, body = $('acxPaBody'); if (!body) return;
    if (!d) { body.innerHTML = '<div class="text-sm text-gray-500 py-6 text-center">Select a department to see its projects and allocated project budgets.</div>'; return; }
    var projs = read('projects').filter(function (p) { return nk(p.department) === nk(d); }), allocs = allocated(d), lines = deptLines(d);
    var totalBudget = lines.reduce(function (n, i) { return n + lineTotal(B()[i]); }, 0), totalAlloc = allocs.reduce(function (n, a) { return n + (Number(a.amount) || 0); }, 0);
    var lineOpts = lines.map(function (i) { var b = B()[i]; return '<option value="' + i + '">' + esc(bname(b) + ' — ' + b.account + ' (' + yearOf(b) + ')') + '</option>'; }).join('');
    var projOpts = projs.map(function (p) { return '<option value="' + esc(p.title) + '">' + esc(p.title) + '</option>'; }).join('');
    var perProject = projs.map(function (p) {
      var sum = allocs.filter(function (a) { return nk(a.project) === nk(p.title); }).reduce(function (n, a) { return n + (Number(a.amount) || 0); }, 0);
      return '<tr class="border-t"><td class="p-2 font-semibold">' + esc(p.title) + '</td><td class="p-2">' + esc(p.status || '') + '</td><td class="p-2 text-right">' + (p.budget ? money(p.budget) : '—') + '</td><td class="p-2 text-right">' + money(sum) + '</td></tr>';
    }).join('');
    body.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">' +
      [['Department budget (approved)', totalBudget], ['Allocated to projects', totalAlloc], ['Unallocated', totalBudget - totalAlloc]].map(function (c) { return '<div class="' + CARD + '"><div class="text-sm text-gray-500">' + c[0] + '</div><div class="text-lg font-bold text-gray-900">' + money(c[1]) + '</div></div>'; }).join('') + '</div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-3 gap-6"><div class="' + CARD + ' space-y-3"><h3 class="' + H3 + '">Allocate Budget to a Project</h3>' +
      (projs.length && lines.length ?
        '<div><label class="' + LBL + '">Project</label><select id="acxPaProject" class="' + INP + '"><option value="">— Select project —</option>' + projOpts + '</select></div>' +
        '<div><label class="' + LBL + '">Budget</label><select id="acxPaLine" class="' + INP + '"><option value="">— Select budget —</option>' + lineOpts + '</select><div id="acxPaAvail" class="text-xs text-gray-600 mt-1"></div></div>' +
        '<div><label class="' + LBL + '">Amount (KES)</label><input id="acxPaAmount" type="number" min="0" step="0.01" placeholder="0.00" class="' + INP + '"/></div>' +
        '<div><label class="' + LBL + '">Notes</label><input id="acxPaNotes" autocomplete="off" class="' + INP + '"/></div><button id="acxPaSave" type="button" class="' + BTN + ' w-full">Allocate to Project</button>'
        : '<p class="text-sm text-gray-500">' + (!projs.length ? esc(d) + ' has no projects yet. Add projects with this department under Projects.' : esc(d) + ' has no approved budgets to allocate from.') + '</p>') + '</div>' +
      '<div class="lg:col-span-2 space-y-6"><div class="' + CARD + '"><h3 class="' + H3 + '">' + esc(d) + ' — Projects</h3><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-600"><tr><th class="p-2">Project</th><th class="p-2">Status</th><th class="p-2 text-right">Project budget</th><th class="p-2 text-right">Allocated</th></tr></thead><tbody>' + (perProject || '<tr><td colspan="4" class="p-3 text-center text-gray-500">No projects for this department.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="' + CARD + '"><h3 class="' + H3 + '">Allocation Entries</h3><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-600"><tr><th class="p-2">Date</th><th class="p-2">Project</th><th class="p-2">Budget</th><th class="p-2 text-right">Amount</th><th class="p-2">Notes</th><th class="p-2"></th></tr></thead><tbody>' +
      (allocs.length ? allocs.map(function (a) { return '<tr class="border-t"><td class="p-2 whitespace-nowrap">' + esc(a.date) + '</td><td class="p-2">' + esc(a.project) + '</td><td class="p-2"><div>' + esc(a.budget) + '</div><div class="text-xs text-gray-500">' + esc(a.line) + '</div></td><td class="p-2 text-right whitespace-nowrap">' + money(a.amount) + '</td><td class="p-2">' + esc(a.notes || '') + '</td><td class="p-2"><button type="button" data-pa-del="' + esc(a.id) + '" class="px-2 py-0.5 rounded border border-red-700 text-red-700 text-xs font-bold hover:bg-red-700 hover:text-white">Remove</button></td></tr>'; }).join('') : '<tr><td colspan="6" class="p-3 text-center text-gray-500">Nothing allocated to this department’s projects yet.</td></tr>') +
      '</tbody></table></div></div></div></div>';
  }
  function savePA() {
    if (window.requirePermission && !window.requirePermission('budgetsTab', 'add', 'allocate budgets to projects')) return;
    var d = $('acxPaDept').value, proj = $('acxPaProject').value, b = B()[parseInt($('acxPaLine').value, 10)], amt = parseFloat($('acxPaAmount').value);
    if (!d) return alert('Select a department.'); if (!proj) return alert('Select a project.'); if (!b) return alert('Select the budget to allocate from.');
    if (isNaN(amt) || amt <= 0) return alert('Enter an allocation amount greater than zero.');
    var used = read(KP).filter(function (a) { return a.lineKey === lineKey(b); }).reduce(function (n, a) { return n + (Number(a.amount) || 0); }, 0), free = lineTotal(b) - used;
    if (amt > free + 0.0001) return alert('Only ' + money(free) + ' of "' + b.account + '" is still unallocated.');
    var rows = read(KP); rows.push({ id: uid(), date: today(), by: who(), department: d, project: proj, budget: bname(b), line: b.account, lineKey: lineKey(b), amount: amt, notes: ($('acxPaNotes').value || '').trim() });
    write(KP, rows); renderProjects();
  }

  /* ---- wiring ---- */
  function refreshAll() { try { mountTransfers(); mountLimits(); mountProjects(); trDepts(); renderTransfers(); renderLimits(); renderProjects(); } catch (e) { console.error('budget controls', e); } }
  window.acxBudgetControlsRefresh = refreshAll;
  function init() { refreshAll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 350); }); else setTimeout(init, 350);
  setTimeout(refreshAll, 1600);
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-budget-panel="transfers"],[data-budget-panel="limits"],[data-budget-panel="project"],[data-budget-group]')) setTimeout(refreshAll, 80); });
  window.addEventListener('storage', function (e) { if (!e.key || /^(budgets|actuals|projects|acxBudgetDepartments|budgetTransfers|spendingLimits|projectAllocations)$/.test(e.key)) setTimeout(function () { try { trDepts(); renderTransfers(); renderLimits(); renderProjects(); } catch (x) {} }, 30); });
})();
}catch(e){console.error("budget-all: BUDGET CONTROLS failed",e)}

/* ===== CASH FLOW FORECAST: Current Budget / Actual / Forecast / Variance ===== */
;try{
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nk(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' '); }
  function B() { try { return Array.isArray(budgets) ? budgets : []; } catch (e) { return []; } }
  function A() { try { return Array.isArray(actuals) ? actuals : []; } catch (e) { return []; } }
  function approved(b) { return !b.status || b.status === 'Approved'; }
  function dept(b) { return String(b.department || 'General').trim() || 'General'; }
  function money(n) { return 'KES ' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(n) { return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], chart = null;
  function zeros() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function sum(a) { return a.reduce(function (n, v) { return n + v; }, 0); }

  /* Current Budget: approved allocations (transfers already applied); quarterly/annual amounts are spread evenly */
  function budgetByMonth(Y, d) {
    var out = zeros();
    B().forEach(function (b) {
      if (!approved(b) || (d && nk(dept(b)) !== nk(d))) return;
      (b.months || []).forEach(function (m) {
        var r = periodRange(m); if (!r || r.year !== Y) return;
        var n = r.end - r.start + 1, each = (Number(m.amount) || 0) / n;
        for (var i = r.start; i <= r.end; i++) out[i - 1] += each;
      });
    });
    return out;
  }
  /* Actual: expenditure posted. A quarter/annual posting lands in the month it was posted (or the period's last month) */
  function actualByMonth(Y, d) {
    var out = zeros();
    A().forEach(function (a) {
      if (d && nk(a.department || 'General') !== nk(d)) return;
      (a.months || []).forEach(function (m) {
        var r = periodRange(m); if (!r || r.year !== Y) return;
        var idx = r.end;
        if (r.start === r.end) idx = r.start;
        else if (m.posted && /^\d{4}-\d{2}/.test(m.posted)) { var py = +m.posted.slice(0, 4), pm = +m.posted.slice(5, 7); if (py === Y && pm >= r.start && pm <= r.end) idx = pm; }
        out[idx - 1] += Number(m.amount) || 0;
      });
    });
    return out;
  }
  function compute(Y, d, method) {
    var bud = budgetByMonth(Y, d), act = actualByMonth(Y, d), fc = zeros(), now = new Date(), cy = now.getFullYear(), cm = now.getMonth() + 1;
    var closed = Y < cy ? 12 : Y > cy ? 0 : cm - 1;                 // months that are fully over
    var avg = closed > 0 ? sum(act.slice(0, closed)) / closed : null;
    for (var i = closed; i < 12; i++) {
      var proj = (method === 'budget' || avg === null) ? bud[i] : avg;
      fc[i] = Math.max(0, proj - act[i]);                          // still to be spent in this month
    }
    var upTo = Y < cy ? 12 : Y > cy ? 0 : cm;                       // months counted as "to date"
    return { bud: bud, act: act, fc: fc, closed: closed, budget: sum(bud), actual: sum(act), forecast: sum(fc), budgetToDate: sum(bud.slice(0, upTo)), upTo: upTo };
  }
  function years() {
    var s = {}, cy = new Date().getFullYear(); s[cy] = 1;
    B().forEach(function (b) { (b.months || []).forEach(function (m) { var y = entryYear(m); if (y) s[y] = 1; }); });
    A().forEach(function (a) { (a.months || []).forEach(function (m) { var y = entryYear(m); if (y) s[y] = 1; }); });
    return Object.keys(s).map(Number).sort(function (a, b) { return b - a; });
  }
  function depts() {
    var s = {}, out = [];
    function add(d) { d = String(d || '').trim(); if (d && !s[nk(d)]) { s[nk(d)] = 1; out.push(d); } }
    try { JSON.parse(localStorage.getItem('acxBudgetDepartments') || '[]').forEach(function (d) { add(d.name); }); } catch (e) {}
    B().forEach(function (b) { add(b.department); }); A().forEach(function (a) { add(a.department); });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  var LBL = 'block text-sm font-semibold text-gray-700 mb-1', INP = 'w-full border border-gray-300 rounded-lg p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-600', CARD = 'bg-white p-5 rounded-xl border border-gray-200 shadow-sm';

  function mount() {
    var p = $('acxBudgetPanel-cashflow'); if (!p || p.getAttribute('data-acx')) return; p.setAttribute('data-acx', '1');
    p.innerHTML = '<div class="' + CARD + '"><div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
      '<div><label class="' + LBL + '">Fiscal Year</label><select id="acxCfYear" class="' + INP + '"></select></div>' +
      '<div><label class="' + LBL + '">Department</label><select id="acxCfDept" class="' + INP + '"></select></div>' +
      '<div><label class="' + LBL + '">Forecast method</label><select id="acxCfMethod" class="' + INP + '"><option value="runrate">Run-rate (average of closed months)</option><option value="budget">Follow the budget</option></select></div></div></div>' +
      '<div id="acxCfCards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>' +
      '<div class="' + CARD + '"><h3 class="font-bold text-gray-900 text-sm border-b border-gray-100 pb-3 mb-4">Monthly Cash Flow Forecast</h3><div style="position:relative;height:280px"><canvas id="acxCfChart"></canvas></div></div>' +
      '<div class="' + CARD + '"><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-600"><tr><th class="p-2">Month</th><th class="p-2 text-right">Current Budget</th><th class="p-2 text-right">Actual</th><th class="p-2 text-right">Forecast</th><th class="p-2 text-right">Variance</th></tr></thead><tbody id="acxCfRows"></tbody></table></div>' +
      '<p class="text-xs text-gray-500 mt-3">Current Budget = approved allocations after transfers. Actual = expenditure posted. Forecast = what is still projected to be spent (closed months show —). Variance = Budget − Actual; for the current and coming months it is Budget − (Actual + Forecast), marked <i>proj.</i></p></div>';
    ['acxCfYear', 'acxCfDept', 'acxCfMethod'].forEach(function (id) { $(id).addEventListener('change', render); });
  }
  function fillFilters() {
    var y = $('acxCfYear'), d = $('acxCfDept'); if (!y || !d) return;
    var py = y.value, pd = d.value, ys = years();
    y.innerHTML = ys.map(function (v) { return '<option value="' + v + '">' + v + '</option>'; }).join('');
    y.value = ys.indexOf(Number(py)) > -1 ? py : String(new Date().getFullYear());
    d.innerHTML = '<option value="">All departments</option>' + depts().map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
    d.value = pd;
  }
  function colour(v) { return v < 0 ? 'text-red-600' : 'text-green-700'; }
  function render() {
    if (!$('acxCfRows')) return;
    var Y = parseInt($('acxCfYear').value, 10) || new Date().getFullYear(), d = $('acxCfDept').value, method = $('acxCfMethod').value, r = compute(Y, d, method);
    var variance = r.budgetToDate - r.actual, outlook = r.budget - (r.actual + r.forecast), used = r.budget ? r.actual / r.budget * 100 : 0;
    var cards = [
      ['Current Budget', money(r.budget), 'Planned allocation for ' + Y + (d ? ' · ' + esc(d) : ''), ''],
      ['Actual', money(r.actual), 'Expenditure posted to date · ' + used.toFixed(0) + '% of budget', ''],
      ['Forecast', money(r.forecast), 'Still projected to be spent · year-end ' + money(r.actual + r.forecast), ''],
      ['Variance', money(variance), 'Budget to date − Actual · year-end outlook ' + (outlook >= 0 ? '' : '−') + money(Math.abs(outlook)) + (outlook >= 0 ? ' under' : ' over') + ' budget', colour(variance)]
    ];
    $('acxCfCards').innerHTML = cards.map(function (c) { return '<div class="' + CARD + '"><div class="text-sm text-gray-500">' + c[0] + '</div><div class="text-lg font-bold ' + (c[3] || 'text-gray-900') + '">' + c[1] + '</div><div class="text-xs text-gray-500 mt-1">' + c[2] + '</div></div>'; }).join('');
    var rows = '', tv = 0;
    for (var i = 0; i < 12; i++) {
      var open = i >= r.closed, proj = open && (r.fc[i] > 0 || r.bud[i] > 0 || r.act[i] > 0), v = r.bud[i] - r.act[i] - (open ? r.fc[i] : 0); tv += v;
      var future = Y > new Date().getFullYear() || (Y === new Date().getFullYear() && i + 1 > new Date().getMonth() + 1);
      rows += '<tr class="border-t' + (open ? ' bg-gray-50/60' : '') + '"><td class="p-2">' + MN[i] + ' ' + Y + '</td><td class="p-2 text-right">' + num(r.bud[i]) + '</td><td class="p-2 text-right">' + (future && !r.act[i] ? '—' : num(r.act[i])) + '</td><td class="p-2 text-right">' + (open && r.fc[i] > 0 ? num(r.fc[i]) : '—') + '</td><td class="p-2 text-right ' + colour(v) + '">' + num(v) + (proj ? ' <span class="text-xs text-gray-400 italic">proj.</span>' : '') + '</td></tr>';
    }
    rows += '<tr class="border-t-2 font-bold"><td class="p-2">Total</td><td class="p-2 text-right">' + num(r.budget) + '</td><td class="p-2 text-right">' + num(r.actual) + '</td><td class="p-2 text-right">' + num(r.forecast) + '</td><td class="p-2 text-right ' + colour(tv) + '">' + num(tv) + '</td></tr>';
    $('acxCfRows').innerHTML = rows;
    drawChart(r);
  }
  function drawChart(r) {
    var cv = $('acxCfChart'); if (!cv) return;
    if (chart) { try { chart.destroy(); } catch (e) {} chart = null; }
    if (typeof window.Chart !== 'function') return;
    var proj = r.act.map(function (a, i) { return i >= r.closed ? a + r.fc[i] : null; });
    chart = new window.Chart(cv.getContext('2d'), { type: 'bar', data: { labels: MN, datasets: [
      { label: 'Current Budget', data: r.bud, backgroundColor: 'rgba(30,58,138,.75)' },
      { label: 'Actual', data: r.act, backgroundColor: 'rgba(22,163,74,.75)' },
      { label: 'Actual + Forecast', data: proj, type: 'line', borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderDash: [6, 4], tension: .25, spanGaps: false }
    ] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } });
  }
  function refresh() { try { mount(); fillFilters(); render(); } catch (e) { console.error('cash flow forecast', e); } }
  window.acxCashFlowRefresh = refresh;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(refresh, 350); }); else setTimeout(refresh, 350);
  setTimeout(refresh, 1600);
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-budget-panel="cashflow"],[data-budget-group="forecasting"]')) setTimeout(refresh, 80); });
  window.addEventListener('storage', function (e) { if (!e.key || /^(budgets|actuals|budgetTransfers|acxBudgetDepartments)$/.test(e.key)) setTimeout(function () { try { fillFilters(); render(); } catch (x) {} }, 30); });
})();
}catch(e){console.error("budget-all: CASH FLOW FORECAST failed",e)}
