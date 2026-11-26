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
