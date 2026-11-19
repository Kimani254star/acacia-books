(function(){"use strict";var norm=function(s){return String(s==null?"":s).trim().replace(/\s+/g," ").toLowerCase()};var num=function(v){return parseFloat(v)||0};var note=function(m,t){return typeof showNotification==="function"?showNotification(m,t):alert(m)};function syncVisibility(){var mrg=document.getElementById("bulkMergeBtn");if(mrg)mrg.classList.remove("hidden")}function watch(){var del=document.getElementById("bulkDeleteBtn");if(!del)return setTimeout(watch,500);syncVisibility();new MutationObserver(syncVisibility).observe(del,{attributes:true,attributeFilter:["class"]})}function mergeGroup(list){var first=list[0];var merged=Object.assign({},first);var totalQty=0,totalCost=0,batchMap={},batchOrder=[],hist=[];list.forEach(function(it){var q=num(it.qty);totalQty+=q;totalCost+=q*num(it.buyPrice);(it.batches||[]).forEach(function(b){var k=norm(b.batchNo)+"|"+(b.expiryDate||"");if(batchMap[k])batchMap[k].qty=num(batchMap[k].qty)+num(b.qty);else{batchMap[k]=Object.assign({},b,{qty:num(b.qty)});batchOrder.push(k)}});hist=hist.concat(Array.isArray(it.history)?it.history:[])});merged.batches=batchOrder.map(function(k){return batchMap[k]});merged.qty=merged.batches.length?merged.batches.reduce(function(a,b){return a+num(b.qty)},0):totalQty;if(totalQty>0)merged.buyPrice=+(totalCost/totalQty).toFixed(4);merged.active=list.some(function(it){return it.active!==false});var user="-";try{var me=JSON.parse(localStorage.getItem("loggedInUser")||"null");if(me&&me.username)user=me.username}catch(e){}hist.push({date:(new Date).toISOString().slice(0,10),type:"Merged",qty:merged.qty,ref:"Merged "+list.length+" duplicate items",user:user,buyPrice:merged.buyPrice});merged.history=hist;return merged}window.bulkMergeInventory=function(){var run=function(){var sel=document.getElementById("warehouseSelect");var whFilter=sel?sel.value:"";var checked=Array.from(document.querySelectorAll(".itemCheckbox:checked"));var scope={};if(checked.length){checked.forEach(function(cb){var wh=cb.getAttribute("data-wh")||whFilter;if(!wh)return;(scope[wh]=scope[wh]||new Set).add(parseInt(cb.dataset.index))})}else if(whFilter){scope[whFilter]=null}else{(typeof __invWarehouseNames==="function"?__invWarehouseNames():[]).forEach(function(w){scope[w]=null})}var plans=[];Object.keys(scope).forEach(function(wh){var items=getInventory(wh);var groups={};items.forEach(function(it,i){if(!it||scope[wh]&&!scope[wh].has(i))return;var k=norm(it.name)+"||"+norm(it.sku);(groups[k]=groups[k]||[]).push(i)});var dup=Object.keys(groups).filter(function(k){return groups[k].length>1});if(dup.length)plans.push({wh:wh,items:items,groups:dup.map(function(k){return groups[k]})})});if(!plans.length){return note(checked.length?"Selected items have no duplicates (same name + SKU) to merge.":"No duplicate items found (same name + SKU).","error")}var count=0,lines=[];plans.forEach(function(p){p.groups.forEach(function(g){count+=g.length;var it=p.items[g[0]];lines.push("• "+(it.name||"-")+" ["+(it.sku||"no SKU")+"] — "+g.length+" lines ("+p.wh+")")})});var shown=lines.slice(0,15).join("\n")+(lines.length>15?"\n…and "+(lines.length-15)+" more":"");if(!confirm("Merge "+count+" items into "+lines.length+" item(s)?\n\n"+shown+"\n\nQuantities and batches are added together; buying price becomes the weighted average."))return;plans.forEach(function(p){var drop=new Set,replace={};p.groups.forEach(function(g){replace[g[0]]=mergeGroup(g.map(function(i){return p.items[i]}));g.slice(1).forEach(function(i){drop.add(i)})});var out=[];p.items.forEach(function(it,i){if(drop.has(i))return;out.push(replace[i]||it)});saveInventory(p.wh,out)});if(typeof __invRefreshCaches==="function"){try{__invRefreshCaches()}catch(e){}}if(typeof syncInventoryBalancesToCOA==="function"){try{syncInventoryBalancesToCOA()}catch(e){}}if(typeof renderInventoryTable==="function")renderInventoryTable();["renderProfitMargin","renderAccounts","renderBalanceSheet","renderSimpleWarehouseMovement","renderStockReports"].forEach(function(fn){if(typeof window[fn]==="function"){try{window[fn]()}catch(e){}}});note("🔗 Merged "+count+" items into "+lines.length,"success")};if(typeof guardAction==="function")guardAction("canEdit",run,"🚫 Only Admin or Account can merge items.");else run()};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",watch);else watch()})();(function(){"use strict";var norm=function(s){return String(s==null?"":s).trim().replace(/\s+/g," ").toLowerCase()};var pinKey=function(s){var p=String(s==null?"":s).replace(/\s+/g,"").toUpperCase();return p.length<5||["N/A","NONE","NULL","-","--"].indexOf(p)>-1?"":p};var cur=function(r){return String(r.currency||"KES").trim().toUpperCase()};var empty=function(v){return v===""||v==null};var num=function(v){return parseFloat(v)||0};var note=function(m,t){return typeof showNotification==="function"?showNotification(m,t):alert(m)};var read=function(k){try{var a=JSON.parse(localStorage.getItem(k)||"[]");return Array.isArray(a)?a:[]}catch(e){return[]}};var CFG={customers:{key:"customers",pin:"kraPin",label:"customer",perm:"customersTab",amount:"receivables",limit:"creditLimit",nameFields:["customer","customerName"],idFields:["customerId"],render:"renderCustomers",docs:["invoices","quotes","orders","receipts","creditNotes","salesReturns","deliveries","recurringInvoices","bulkInvoices","customerPayments","creditNoteApplications","invoiceDrafts","creditNoteDrafts","salesReturnDrafts","deliveryDrafts","bulkInvoiceDrafts"]},suppliers:{key:"suppliers",pin:"krapin",label:"supplier",perm:"supplierTab",amount:"balance",limit:"debitLimit",nameFields:["supplier","supplierName"],idFields:["supplierId"],render:"renderSuppliers",docs:["bills","billPayments","bulkBills","purchaseOrders","grns","supplierDebitNotes","purchaseReturns","supplierQuotes","supplierDrafts","billWriteOffs","debitNoteApplications","purchaseReturnDrafts","recurringPayments","recurringBills"]}};function selectedIndexes(kind,list){if(kind==="customers"){var ids=Array.from(document.querySelectorAll(".customerCheck:checked")).map(function(c){return c.dataset.id});if(!ids.length)return null;var out=new Set;list.forEach(function(c,i){if(ids.indexOf(c.id)>-1)out.add(i)});return out}var sel=Array.from(document.querySelectorAll(".supplier-checkbox:checked")).map(function(c){return parseInt(c.value)});return sel.length?new Set(sel):null}function cluster(list,idxs,c){var parent={};var find=function(x){while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x]}return x};var union=function(a,b){a=find(a);b=find(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b)};var byName={},byPin={};idxs.forEach(function(i){parent[i]=i;var n=norm(list[i].name),p=pinKey(list[i][c.pin]);if(n){if(byName[n]!=null)union(i,byName[n]);else byName[n]=i}if(p){if(byPin[p]!=null)union(i,byPin[p]);else byPin[p]=i}});var g={};idxs.forEach(function(i){(g[find(i)]=g[find(i)]||[]).push(i)});return Object.keys(g).map(function(k){return g[k].sort(function(a,b){return a-b})})}function mergeRecs(recs,c){var base=Object.assign({},recs[0]);var amount=0,limit=0;recs.forEach(function(r,i){amount+=num(r[c.amount]);limit=Math.max(limit,num(r[c.limit]));if(i===0)return;Object.keys(r).forEach(function(k){if(empty(base[k])&&!empty(r[k]))base[k]=r[k]});if(empty(base.secondaryEmail)&&r.primaryEmail&&norm(r.primaryEmail)!==norm(base.primaryEmail))base.secondaryEmail=r.primaryEmail});base[c.amount]=amount;if(limit>0)base[c.limit]=String(limit);return base}function remapDocs(c,nameMap,idMap){var changed=0;c.docs.forEach(function(k){var raw=localStorage.getItem(k);if(!raw)return;var arr;try{arr=JSON.parse(raw)}catch(e){return}if(!Array.isArray(arr))return;var dirty=false;arr.forEach(function(d){if(!d||typeof d!=="object")return;c.nameFields.forEach(function(f){if(typeof d[f]==="string"&&nameMap[norm(d[f])]!=null&&d[f]!==nameMap[norm(d[f])]){d[f]=nameMap[norm(d[f])];dirty=true;changed++}});c.idFields.forEach(function(f){if(d[f]!=null&&idMap[String(d[f])]!=null){d[f]=idMap[String(d[f])];dirty=true;changed++}})});if(dirty)localStorage.setItem(k,JSON.stringify(arr))});return changed}function run(kind){var c=CFG[kind];var list=read(c.key);var sel=selectedIndexes(kind,list);var scope=[];list.forEach(function(r,i){if(r&&(!sel||sel.has(i)))scope.push(i)});var byCur={};scope.forEach(function(i){(byCur[cur(list[i])]=byCur[cur(list[i])]||[]).push(i)});var groups=[];Object.keys(byCur).forEach(function(k){cluster(list,byCur[k],c).forEach(function(g){if(g.length>1)groups.push(g)})});var split=cluster(list,scope,c).filter(function(g){return g.length>1&&new Set(g.map(function(i){return cur(list[i])})).size>1}).length;var splitMsg=split?"\n\n"+split+" name/PIN match(es) have different currencies and will be kept separate.":"";if(!groups.length){return note("No duplicate "+c.label+"s found (same name or PIN, same currency)."+(split?" "+split+" match(es) kept separate because currencies differ.":""),"error")}var total=groups.reduce(function(a,g){return a+g.length},0);var lines=groups.map(function(g){return"• "+(list[g[0]].name||"-")+" ["+cur(list[g[0]])+"] — "+g.length+" records"});var shown=lines.slice(0,15).join("\n")+(lines.length>15?"\n…and "+(lines.length-15)+" more":"");if(!confirm("Merge "+total+" "+c.label+"s into "+groups.length+"?\n\n"+shown+"\n\nBlank details are filled from duplicates, balances are added, and existing invoices/bills are re-pointed to the kept "+c.label+"."+splitMsg))return;try{localStorage.setItem("__mergeBackup_"+kind,JSON.stringify({at:(new Date).toISOString(),data:list}))}catch(e){}var drop=new Set,replace={},nameMap={},idMap={};groups.forEach(function(g){var keeper=list[g[0]];replace[g[0]]=mergeRecs(g.map(function(i){return list[i]}),c);g.slice(1).forEach(function(i){drop.add(i);var d=list[i];if(norm(d.name)!==norm(keeper.name))nameMap[norm(d.name)]=keeper.name;if(d.id!=null&&keeper.id!=null)idMap[String(d.id)]=keeper.id})});var out=[];list.forEach(function(r,i){if(!drop.has(i))out.push(replace[i]||r)});localStorage.setItem(c.key,JSON.stringify(out));var re=remapDocs(c,nameMap,idMap);if(typeof window[c.render]==="function"){try{window[c.render]()}catch(e){}}note("🔗 Merged "+total+" "+c.label+"s into "+groups.length+(re?" · "+re+" linked record(s) updated":"")+(split?" · "+split+" kept separate (currency)":""),"success")}function guarded(kind){var c=CFG[kind];if(typeof window.requirePermission==="function"&&!window.requirePermission(c.perm,"edit","merge "+c.label+"s"))return;run(kind)}window.mergeCustomers=function(){guarded("customers")};window.mergeSuppliers=function(){guarded("suppliers")}})();(function(){"use strict";var norm=function(s){return String(s==null?"":s).trim().replace(/\s+/g," ").toLowerCase()};var num=function(v){return parseFloat(v)||0};var empty=function(v){return v===""||v==null};var note=function(m,t){return typeof showNotification==="function"?showNotification(m,t):alert(m)};var read=function(k){try{var a=JSON.parse(localStorage.getItem(k)||"[]");return Array.isArray(a)?a:[]}catch(e){return[]}};var SYSTEM=["customer receivables","supplier payments","accounts receivable","accounts payable","undeposited funds","vat payable","inventory","cost of goods sold","sales revenue","retained earnings"];var isSystem=function(a){return!!a&&(a.system===true||SYSTEM.indexOf(norm(a.name))>-1)};var catOf=function(a){try{if(typeof window.getCOACategory==="function")return norm(window.getCOACategory(a))}catch(e){}return norm(a.category)};var KEYS=["journalEntries","manualJournals","recurringJournals","manualJournalDraft","recurringJournalDraft","manualTransactions","banks","bankMappings","bankAccounts","bankDrafts","operationalCosts","equityRecords","currentAccounts","directorAccount","budgets","budgetHistory","budgetVariance","taxAdjustments","taxPayments","currencyAdjustments","invoices","quotes","bills","bulkBills","bulkInvoices","creditNotes","supplierDebitNotes","purchaseReturns","salesReturns","receipts","customerPayments","billPayments","purchaseOrders","recurringInvoices","recurringBills","recurringPayments","chartOfAccountsDrafts"];var NAME_FIELDS=["account","accountName","debitAccount","creditAccount","expenseAccount","chartAccount","chartOfAccount","bankAccount"];var CODE_FIELDS=["accountCode","debitCode","creditCode","debitAccountCode","creditAccountCode"];function remap(node,nameMap,codeMap){var changed=0;if(Array.isArray(node)){node.forEach(function(x){changed+=remap(x,nameMap,codeMap)});return changed}if(!node||typeof node!=="object")return 0;var hadAccountName=false;NAME_FIELDS.forEach(function(f){if(typeof node[f]==="string"){var to=nameMap[norm(node[f])];if(to!=null&&node[f]!==to){node[f]=to;changed++}hadAccountName=true}});CODE_FIELDS.forEach(function(f){if(node[f]!=null&&codeMap[String(node[f])]!=null&&String(node[f])!==codeMap[String(node[f])]){node[f]=codeMap[String(node[f])];changed++}});if(hadAccountName&&node.code!=null&&codeMap[String(node.code)]!=null&&String(node.code)!==codeMap[String(node.code)]){node.code=codeMap[String(node.code)];changed++}Object.keys(node).forEach(function(k){if(node[k]&&typeof node[k]==="object")changed+=remap(node[k],nameMap,codeMap)});return changed}function selectedIdx(){var s=Array.from(document.querySelectorAll(".account-select:checked")).map(function(c){return Number(c.dataset.index)});return s.length?s:null}function order(list,g){var sys=g.filter(function(i){return isSystem(list[i])});if(sys.length>=1)return[sys[0]].concat(g.filter(function(i){return i!==sys[0]}));return g.slice()}window.mergeAccounts=function(){if(typeof window.requirePermission==="function"&&!window.requirePermission("chartOfAccountsTab","edit","merge accounts"))return;var list=read("chartOfAccounts");var sel=selectedIdx();var groups=[];if(sel){sel=sel.filter(function(i){return list[i]});if(sel.length<2)return note("Tick at least 2 accounts to merge (or tick none to find duplicates automatically).","error");var cats={};sel.forEach(function(i){cats[catOf(list[i])]=1});if(Object.keys(cats).length>1)return note("Selected accounts are in different categories (Asset and Expense). Only accounts of the same category can be merged.","error");var g=order(list,sel.slice().sort(function(a,b){return a-b}));groups.push(g)}else{var by={};list.forEach(function(a,i){if(!a||!norm(a.name))return;var k=norm(a.name)+"||"+norm(a.type);(by[k]=by[k]||[]).push(i)});Object.keys(by).forEach(function(k){if(by[k].length<2)return;var g2=order(list,by[k]);if(g2)groups.push(g2)});if(!groups.length)return note("No duplicate accounts found (same name and type). Tick 2 or more accounts to merge them manually.","error")}var sysCount=0;groups.forEach(function(g){g.slice(1).forEach(function(i){if(isSystem(list[i]))sysCount++})});var total=groups.reduce(function(a,g){return a+g.length},0);var lines=groups.map(function(g){var k=list[g[0]];return'• Keep "'+(k.name||"-")+'" ['+(k.code||"-")+"] ← "+g.slice(1).map(function(i){return(list[i].name||"-")+" ["+(list[i].code||"-")+"]"}).join(", ")});var shown=lines.slice(0,15).join("\n")+(lines.length>15?"\n…and "+(lines.length-15)+" more":"");if(!confirm("Merge "+total+" accounts into "+groups.length+"?\n\n"+shown+(sysCount?"\n\n⚠ "+sysCount+" system account(s) will be merged into the kept account.":"")+"\n\nOpening balances are added, blank details are filled, and all transactions, journals, banks and budgets using the merged accounts are moved to the kept account. A backup is saved first."))return;var backup={at:(new Date).toISOString(),chartOfAccounts:JSON.stringify(list),keys:{}};KEYS.forEach(function(k){var v=localStorage.getItem(k);if(v)backup.keys[k]=v});try{localStorage.setItem("__mergeBackup_accounts",JSON.stringify(backup))}catch(e){try{localStorage.setItem("__mergeBackup_accounts",JSON.stringify({at:backup.at,chartOfAccounts:backup.chartOfAccounts,keys:{}}))}catch(e2){}}var drop=new Set,nameMap={},codeMap={},replace={};groups.forEach(function(g){var keeper=Object.assign({},list[g[0]]);var amount=num(keeper.amount);g.slice(1).forEach(function(i){var d=list[i];drop.add(i);amount+=num(d.amount);Object.keys(d).forEach(function(f){if(empty(keeper[f])&&!empty(d[f]))keeper[f]=d[f]});if(!empty(d.name))nameMap[norm(d.name)]=keeper.name;if(!empty(d.code))codeMap[String(d.code)]=String(keeper.code)});keeper.amount=amount;replace[g[0]]=keeper});var out=[];list.forEach(function(a,i){if(!drop.has(i))out.push(replace[i]||a)});out.forEach(function(a){if(a.parentName&&nameMap[norm(a.parentName)]!=null)a.parentName=nameMap[norm(a.parentName)];if(a.parentCode!=null&&codeMap[String(a.parentCode)]!=null)a.parentCode=codeMap[String(a.parentCode)]});localStorage.setItem("chartOfAccounts",JSON.stringify(out));var changed=0;KEYS.forEach(function(k){var raw=localStorage.getItem(k);if(!raw)return;var data;try{data=JSON.parse(raw)}catch(e){return}var n=remap(data,nameMap,codeMap);if(n){localStorage.setItem(k,JSON.stringify(data));changed+=n}});try{if(typeof getInventory==="function"&&typeof saveInventory==="function"&&typeof __invWarehouseNames==="function"){__invWarehouseNames().forEach(function(wh){var inv=getInventory(wh),n=remap(inv,nameMap,codeMap);if(n){saveInventory(wh,inv);changed+=n}})}}catch(e){}["renderAccounts","updateBalanceSheetFromChart","populateAccountDropdowns","populateInvoiceChartOfAccountDropdown","populateQuoteChartOfAccountDropdown","populateBillChartOfAccountDropdown","populateBulkBillChartOfAccountDropdown","populateDebitAccountDropdown","populateReturnAccountDropdown","populateAccountsDropdown","populateAccountSelect","populateTransactionAccountSelect","populateChartOfAccounts","populateParentAccountSelect","renderBalanceSheet","renderProfitMargin"].forEach(function(fn){if(typeof window[fn]==="function"){try{window[fn]()}catch(e){}}});var master=document.querySelector("#accountsTable")&&document.querySelector('thead input[onclick*="toggleAllAccounts"]');if(master)master.checked=false;note("🔗 Merged "+total+" accounts into "+groups.length+(changed?" · "+changed+" linked record(s) updated":""),"success")}
/* ===== Chart of Accounts: Bulk Edit (accounts under the same parent) ===== */
var BE={rows:[],parentFilter:""};
var beEsc=function(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")};
function beRole(list,a){return typeof window.coaRole==="function"?window.coaRole(list,a):(a.isParent?"parent":(a.parentCode||a.parentName?"sub":""))}
function beParents(list){return list.filter(function(a){return a&&beRole(list,a)==="parent"}).sort(function(x,y){return String(x.code||"").localeCompare(String(y.code||""),undefined,{numeric:true})})}
function beChildrenIdx(list,p){var pc=String(p.code||"");return list.reduce(function(o,a,i){if(a&&a!==p&&(pc&&String(a.parentCode||"")===pc||!a.parentCode&&a.parentName&&a.parentName===p.name))o.push(i);return o},[])}
function beTypeOptions(sel){var el=document.getElementById("accountType"),h="";if(el){Array.prototype.forEach.call(el.options,function(o){if(o.value)h+='<option value="'+beEsc(o.value)+'"'+(o.value===sel?" selected":"")+">"+beEsc(o.text)+"</option>"})}if(sel&&h.indexOf('value="'+beEsc(sel)+'"')<0)h='<option value="'+beEsc(sel)+'" selected>'+beEsc(sel)+"</option>"+h;return h}
function beParentOptions(list,sel,selfCode){var h='<option value="">— None (standalone) —</option>';beParents(list).forEach(function(p){if(selfCode&&String(p.code)===String(selfCode))return;var v=String(p.code||p.name);h+='<option value="'+beEsc(v)+'"'+(String(sel)===v?" selected":"")+">"+beEsc((p.code?p.code+" — ":"")+p.name)+"</option>"});return h}
function beRowHtml(list,r,k){var a=r.acc,sys=isSystem(a),dis=sys?" disabled":"";var pv=String(a.parentCode||a.parentName||"");return'<tr data-k="'+k+'" style="border-top:1px solid #e5e7eb"><td style="padding:4px 6px;text-align:center"><input type="checkbox" class="be-pick" checked></td><td style="padding:4px 6px"><input class="be-name" value="'+beEsc(a.name)+'"'+dis+' style="width:100%;min-width:160px;border:1px solid #d1d5db;border-radius:4px;padding:3px 6px"></td><td style="padding:4px 6px"><input class="be-code" value="'+beEsc(a.code)+'"'+dis+' style="width:90px;border:1px solid #d1d5db;border-radius:4px;padding:3px 6px"></td><td style="padding:4px 6px"><select class="be-type"'+dis+' style="width:100%;min-width:140px;border:1px solid #d1d5db;border-radius:4px;padding:3px 4px">'+beTypeOptions(a.type)+'</select></td><td style="padding:4px 6px"><select class="be-parent" style="width:100%;min-width:150px;border:1px solid #d1d5db;border-radius:4px;padding:3px 4px">'+beParentOptions(list,pv,a.code)+'</select></td><td style="padding:4px 6px"><input class="be-amt" type="number" step="any" value="'+(num(a.amount)||"")+'" style="width:100px;text-align:right;border:1px solid #d1d5db;border-radius:4px;padding:3px 6px"></td><td style="padding:4px 6px;font-size:12px;color:#6b7280">'+(sys?"🔒 system":beRole(list,a)==="parent"?"Parent":beRole(list,a)==="sub"?"Sub":"")+"</td></tr>"}
function beClose(){var o=document.getElementById("coaBulkEditModal");if(o)o.remove()}
function beRenderGrid(){var list=read("chartOfAccounts"),body=document.getElementById("beBody");if(!body)return;if(!BE.rows.length){body.innerHTML='<tr><td colspan="7" style="padding:16px;text-align:center;color:#6b7280">No accounts loaded. Choose a parent above, or tick accounts in the list first.</td></tr>';return}body.innerHTML=BE.rows.map(function(r,k){return beRowHtml(list,r,k)}).join("");var c=document.getElementById("beCount");if(c)c.textContent=BE.rows.length+" account"+(BE.rows.length===1?"":"s")}
function beLoadParent(code){var list=read("chartOfAccounts");if(!code){BE.rows=[];return beRenderGrid()}var p=list.filter(function(a){return a&&String(a.code||a.name)===String(code)})[0];if(!p){BE.rows=[];return beRenderGrid()}BE.rows=beChildrenIdx(list,p).map(function(i){return{i:i,acc:list[i]}});if(!BE.rows.length)note('"'+p.name+'" has no sub accounts yet.',"error");beRenderGrid()}
function beApplyAll(){var list=read("chartOfAccounts");var tp=document.getElementById("beAllType").value,pp=document.getElementById("beAllParent").value,ap=document.getElementById("beAllAmt").value;var rows=document.querySelectorAll("#beBody tr[data-k]"),n=0;Array.prototype.forEach.call(rows,function(tr){if(!tr.querySelector(".be-pick").checked)return;var a=BE.rows[+tr.dataset.k].acc;if(tp&&!isSystem(a)){tr.querySelector(".be-type").value=tp;n++}if(pp!=="__keep"){var ps=tr.querySelector(".be-parent");var self=String(a.code||"");var val=pp;if(val&&val===self){return}ps.value=val;n++}if(ap!==""){tr.querySelector(".be-amt").value=ap;n++}});if(!n)note("Nothing to apply — pick a value in “Apply to ticked rows” first.","error");else note("Applied to ticked rows. Review, then press Save changes.","success")}
function beSave(){if(typeof window.requirePermission==="function"&&!window.requirePermission("chartOfAccountsTab","edit","edit chart of accounts"))return;var list=read("chartOfAccounts");var trs=Array.prototype.slice.call(document.querySelectorAll("#beBody tr[data-k]"));if(!trs.length)return note("No accounts to save.","error");var edits=[],errs=[];var pending={};trs.forEach(function(tr){var r=BE.rows[+tr.dataset.k],old=list[r.i];if(!old)return;var name=tr.querySelector(".be-name").value.trim().replace(/\s+/g," "),code=tr.querySelector(".be-code").value.trim(),type=tr.querySelector(".be-type").value,par=tr.querySelector(".be-parent").value,amt=tr.querySelector(".be-amt").value;if(!name||!code){errs.push((old.name||"(unnamed)")+": name and code are required.");return}if(!type){errs.push(name+": choose an account type.");return}pending[r.i]={name:name,code:code}; edits.push({i:r.i,old:old,name:name,code:code,type:type,par:par,amt:amt===""?0:(parseFloat(amt)||0)})});if(errs.length)return note(errs.slice(0,4).join("\n")+(errs.length>4?"\n…and "+(errs.length-4)+" more":""),"error");var codes={},dupe=[];list.forEach(function(a,i){if(!a)return;var c=String(pending[i]?pending[i].code:a.code||"").trim().toLowerCase();if(!c)return;if(codes[c]!=null&&codes[c]!==i)dupe.push(c);else codes[c]=i});if(dupe.length)return note("Duplicate account code(s): "+dupe.slice(0,6).join(", ")+". Each code must be unique.","error");var names={},dn=[];list.forEach(function(a,i){if(!a)return;var n=norm(pending[i]?pending[i].name:a.name),t=norm(a.type);var key=n+"||"+(pending[i]?"":t);if(!n)return});var nameCount={};list.forEach(function(a,i){if(!a)return;var n=norm(pending[i]?pending[i].name:a.name);(nameCount[n]=nameCount[n]||[]).push(i)});edits.forEach(function(e){if(nameCount[norm(e.name)].length>1&&norm(e.name)!==norm(e.old.name))dn.push(e.name)});if(dn.length&&!confirm("These names already exist on another account:\n\n"+dn.slice(0,8).join("\n")+"\n\nSave anyway? (Use Merge instead if they are duplicates.)"))return;
var after=list.map(function(a,i){return pending[i]?Object.assign({},a,{name:pending[i].name,code:pending[i].code}):a});var byCodeAfter={};after.forEach(function(a,i){if(a&&a.code)byCodeAfter[String(a.code)]=i});var parentErr=[];edits.forEach(function(e){if(!e.par)return;var pi=byCodeAfter[e.par],pa=pi!=null?after[pi]:after.filter(function(a){return a&&a.name===e.par})[0];var pidx=pi!=null?pi:after.indexOf(pa);if(!pa){parentErr.push(e.name+": parent not found.");return}if(pidx===e.i){parentErr.push(e.name+": an account cannot be its own parent.");return}var seen={},cur=pa,guard=0;while(cur&&guard++<50){if(after.indexOf(cur)===e.i){parentErr.push(e.name+": that parent is under this account (circular).");return}var nx=cur.parentCode?after[byCodeAfter[String(cur.parentCode)]]:null;cur=nx}});if(parentErr.length)return note(parentErr.slice(0,4).join("\n"),"error");
var nameMap={},codeMap={},summary=[];edits.forEach(function(e){var o=e.old;if(norm(o.name)!==norm(e.name)&&o.name)nameMap[norm(o.name)]=e.name;if(String(o.code||"")!==String(e.code)&&o.code!=null&&String(o.code)!=="")codeMap[String(o.code)]=String(e.code)});
var backup={at:(new Date).toISOString(),chartOfAccounts:JSON.stringify(list),keys:{}};KEYS.forEach(function(k){if(Object.keys(nameMap).length||Object.keys(codeMap).length){var v=localStorage.getItem(k);if(v)backup.keys[k]=v}});try{localStorage.setItem("__bulkEditBackup_accounts",JSON.stringify(backup))}catch(x){try{localStorage.setItem("__bulkEditBackup_accounts",JSON.stringify({at:backup.at,chartOfAccounts:backup.chartOfAccounts,keys:{}}))}catch(y){}}
var out=list.map(function(a){return a});var changed=0;edits.forEach(function(e){var o=e.old,n=Object.assign({},o);n.name=e.name;n.code=e.code;if(!isSystem(o))n.type=e.type;if(typeof window.COA_TYPE_TO_CATEGORY==="object"&&window.COA_TYPE_TO_CATEGORY&&window.COA_TYPE_TO_CATEGORY[n.type]&&!isSystem(o))n.category=window.COA_TYPE_TO_CATEGORY[n.type];n.amount=e.amt;if(e.par){var pi=byCodeAfter[e.par],pa=pi!=null?after[pi]:after.filter(function(a){return a&&a.name===e.par})[0];n.parentName=pa.name;n.parentCode=pa.code;n.isSub=true}else{n.parentName="";n.parentCode="";n.isSub=false}if(JSON.stringify(n)!==JSON.stringify(o))changed++;out[e.i]=n});
edits.forEach(function(e){var n=out[e.i],o=e.old;if(typeof window.coaSyncChildren==="function")window.coaSyncChildren(out,o,n)});
Object.keys(nameMap).forEach(function(k){out.forEach(function(a){if(a&&a.parentName&&norm(a.parentName)===k&&!(edits.some(function(e){return out[e.i]===a&&e.par})))a.parentName=nameMap[k]})});
if(!changed)return note("No changes to save.","error");
localStorage.setItem("chartOfAccounts",JSON.stringify(out));var linked=0;if(Object.keys(nameMap).length||Object.keys(codeMap).length){KEYS.forEach(function(k){var raw=localStorage.getItem(k);if(!raw)return;var data;try{data=JSON.parse(raw)}catch(x){return}var n=remap(data,nameMap,codeMap);if(n){localStorage.setItem(k,JSON.stringify(data));linked+=n}});try{if(typeof getInventory==="function"&&typeof saveInventory==="function"&&typeof __invWarehouseNames==="function"){__invWarehouseNames().forEach(function(wh){var inv=getInventory(wh),n=remap(inv,nameMap,codeMap);if(n){saveInventory(wh,inv);linked+=n}})}}catch(x){}}
["renderAccounts","updateBalanceSheetFromChart","populateAccountDropdowns","populateInvoiceChartOfAccountDropdown","populateQuoteChartOfAccountDropdown","populateBillChartOfAccountDropdown","populateBulkBillChartOfAccountDropdown","populateDebitAccountDropdown","populateReturnAccountDropdown","populateAccountsDropdown","populateAccountSelect","populateTransactionAccountSelect","populateChartOfAccounts","populateTaxTypeFromChartOfAccounts","populateCostCategoryFromChartOfAccounts","populateParentAccountSelect","renderBalanceSheet"].forEach(function(fn){if(typeof window[fn]==="function"){try{window[fn]()}catch(x){}}});var master=document.querySelector('thead input[onclick*="toggleAllAccounts"]');if(master)master.checked=false;beClose();note("✏️ Updated "+changed+" account"+(changed===1?"":"s")+(linked?" · "+linked+" linked record(s) updated":""),"success")}
window.bulkEditAccounts=function(){if(typeof window.requirePermission==="function"&&!window.requirePermission("chartOfAccountsTab","edit","edit chart of accounts"))return;var list=read("chartOfAccounts");var sel=selectedIdx();BE.rows=[];if(sel){sel.forEach(function(i){if(list[i])BE.rows.push({i:i,acc:list[i]})})}var parents=beParents(list);beClose();var o=document.createElement("div");o.id="coaBulkEditModal";o.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px";var pOpts='<option value="">— Select a parent —</option>'+parents.map(function(p){var n=beChildrenIdx(list,p).length;return'<option value="'+beEsc(p.code||p.name)+'">'+beEsc((p.code?p.code+" — ":"")+p.name)+" ("+n+" sub)</option>"}).join("");o.innerHTML='<div style="background:#fff;border-radius:10px;max-width:980px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3)"><div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700;font-size:16px">✏️ Bulk Edit Accounts</div><div style="font-size:12px;color:#6b7280">Edit many accounts at once. Renamed names/codes are updated in transactions too. <span id="beCount"></span></div></div><button type="button" id="beX" style="font-size:22px;line-height:1;color:#6b7280;background:none;border:0;cursor:pointer">&times;</button></div><div style="padding:12px 18px;border-bottom:1px solid #e5e7eb;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><label style="font-size:13px;font-weight:600">Load all sub accounts of</label><select id="beParentLoad" style="border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;min-width:240px">'+pOpts+'</select><span style="font-size:12px;color:#6b7280">or close this and tick accounts in the list first</span></div><div style="padding:10px 18px;background:#f8fafc;border-bottom:1px solid #e5e7eb"><div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">Apply to ticked rows</div><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><select id="beAllType" style="border:1px solid #d1d5db;border-radius:6px;padding:5px 6px;min-width:150px"><option value="">Type: no change</option>'+beTypeOptions("")+'</select><select id="beAllParent" style="border:1px solid #d1d5db;border-radius:6px;padding:5px 6px;min-width:180px"><option value="__keep">Parent: no change</option>'+beParentOptions(list,"__none__").replace('<option value="">— None (standalone) —</option>','<option value="">Parent: none (standalone)</option>')+'</select><input id="beAllAmt" type="number" step="any" placeholder="Opening: no change" style="border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;width:150px"><button type="button" id="beApply" style="background:#1e3a8a;color:#fff;border-radius:6px;padding:6px 12px;font-weight:600;border:0;cursor:pointer">Apply</button></div></div><div style="overflow:auto;flex:1"><table style="width:100%;font-size:13px;border-collapse:collapse"><thead style="position:sticky;top:0;background:#f3f4f6"><tr><th style="padding:6px"><input type="checkbox" id="beAll" checked></th><th style="padding:6px;text-align:left">Account name</th><th style="padding:6px;text-align:left">Code</th><th style="padding:6px;text-align:left">Type</th><th style="padding:6px;text-align:left">Parent</th><th style="padding:6px;text-align:right">Opening</th><th style="padding:6px;text-align:left">Role</th></tr></thead><tbody id="beBody"></tbody></table></div><div style="padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px"><button type="button" id="beCancel" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:7px 16px;cursor:pointer">Cancel</button><button type="button" id="beSave" style="background:#1e3a8a;color:#fff;border-radius:6px;padding:7px 16px;font-weight:600;border:0;cursor:pointer">Save changes</button></div></div>';document.body.appendChild(o);o.addEventListener("mousedown",function(e){if(e.target===o)beClose()});document.getElementById("beX").onclick=beClose;document.getElementById("beCancel").onclick=beClose;document.getElementById("beSave").onclick=beSave;document.getElementById("beApply").onclick=beApplyAll;document.getElementById("beParentLoad").onchange=function(){beLoadParent(this.value)};document.getElementById("beAll").onchange=function(){var v=this.checked;Array.prototype.forEach.call(document.querySelectorAll("#beBody .be-pick"),function(c){c.checked=v})};beRenderGrid()};

})();(function(){"use strict";if(window.__acxPdfFix)return;window.__acxPdfFix=true;var LIBS={jspdf:{ok:function(){return!!(window.jspdf&&window.jspdf.jsPDF)},urls:["https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js","https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"]},autotable:{ok:function(){return!!(window.jspdf&&window.jspdf.jsPDF&&window.jspdf.jsPDF.API&&typeof window.jspdf.jsPDF.API.autoTable==="function")},urls:["https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js","https://cdn.jsdelivr.net/npm/jspdf-autotable@3.5.31/dist/jspdf.plugin.autotable.min.js"]},html2pdf:{ok:function(){return typeof window.html2pdf==="function"},urls:["https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js","https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js"]}};function loadScript(url,timeoutMs){return new Promise(function(resolve,reject){var s=document.createElement("script"),done=false;var timer=setTimeout(function(){fin(new Error("timeout "+url))},timeoutMs||2e4);function fin(err){if(done)return;done=true;clearTimeout(timer);if(err){try{s.remove()}catch(e){}reject(err)}else resolve()}s.src=url;s.async=true;s.onload=function(){fin(null)};s.onerror=function(){fin(new Error("failed "+url))};document.head.appendChild(s)})}var pending={};function ensure(name){var lib=LIBS[name];if(lib.ok())return Promise.resolve();if(pending[name])return pending[name];var p=function tryUrls(i){if(i>=lib.urls.length)return Promise.reject(new Error("Could not load "+name));return loadScript(lib.urls[i]).then(function(){if(!lib.ok())throw new Error(name+" loaded but not usable")}).catch(function(){return tryUrls(i+1)})}(0);pending[name]=p;p.catch(function(){pending[name]=null});return p}function allReady(){return LIBS.jspdf.ok()&&LIBS.autotable.ok()&&LIBS.html2pdf.ok()}function ensureAll(){if(allReady())return Promise.resolve();var jsp=ensure("jspdf").then(function(){return ensure("autotable").catch(function(){})});return Promise.all([jsp,ensure("html2pdf")]).then(function(){})}window.__acxEnsureAllPdfLibs=ensureAll;function preload(){ensureAll().catch(function(){})}if(document.readyState==="complete")setTimeout(preload,800);else window.addEventListener("load",function(){setTimeout(preload,800)});var NAME_RE=/^(download|export|generate|rep)[A-Za-z0-9_]*(PDF|Pdf)$/;function wrapFn(name){var fn=window[name];if(typeof fn!=="function"||fn.__acxPdfWrapped||fn.__acxDlWrapped)return;var w=function(){var self=this,args=arguments;if(allReady()||LIBS.jspdf.ok()&&LIBS.html2pdf.ok())return fn.apply(self,args);return ensureAll().then(function(){return fn.apply(self,args)}).catch(function(err){console.error("[pdf-fix] "+name+" failed:",err);alert("Could not load the PDF tools. Please check your internet connection and try again.")})};w.__acxPdfWrapped=true;try{window[name]=w}catch(e){}}function wrapAll(){try{Object.getOwnPropertyNames(window).forEach(function(n){if(NAME_RE.test(n))wrapFn(n)})}catch(e){console.warn("[pdf-fix] wrapAll",e)}}wrapAll();var runs=0;var iv=setInterval(function(){wrapAll();if(++runs>25)clearInterval(iv)},700);window.addEventListener("load",function(){setTimeout(wrapAll,300);setTimeout(wrapAll,2e3)});function saveBlob(blob,filename){var file=new Blob([blob],{type:"application/octet-stream"});var url=URL.createObjectURL(file);var ua=navigator.userAgent||"";var ios=/iPad|iPhone|iPod/.test(ua)||navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1;if(ios&&window.top!==window.self){window.open(url,"_blank");setTimeout(function(){URL.revokeObjectURL(url)},6e4);return}var a=document.createElement("a");a.href=url;a.download=filename||"document.pdf";a.style.display="none";document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(url)},4e3)}window.__acxSaveBlob=saveBlob;function render(el,opt){return window.html2pdf().set(opt).from(el).toPdf().get("pdf").then(function(pdf){return pdf.output("blob")})}window.__downloadPdfBlob=async function(el,opt){opt=opt||{};try{await ensure("html2pdf");var blob;try{blob=await render(el,opt)}catch(e1){console.warn("[pdf-fix] first render failed, retrying lighter:",e1);var lighter=Object.assign({},opt,{image:{type:"jpeg",quality:.92},html2canvas:Object.assign({},opt.html2canvas||{},{scale:1,useCORS:true,allowTaint:true,logging:false})});blob=await render(el,lighter)}saveBlob(blob,opt.filename||"document.pdf")}catch(e){console.error("[pdf-fix] PDF download failed:",e);alert("Could not generate the PDF. Please check your internet connection and try again.")}};window.downloadBAAdjLogEntry=async function(wh,idx){try{await ensure("jspdf");var list=JSON.parse(localStorage.getItem("bulkAdjustments_"+wh)||"[]");var a=list[parseInt(idx,10)];if(!a){alert("Adjustment entry not found.");return}var change=Number(a.change!=null?a.change:a.adjustment||0);var when=a.createdAt||a.date||Date.now(),whenTxt;try{whenTxt=new Date(when).toLocaleString()}catch(e){whenTxt=String(when)}var ref="BA-"+String(wh).replace(/\s+/g,"").toUpperCase()+"-"+idx;var doc=new window.jspdf.jsPDF;doc.setFontSize(16);doc.text("Bulk Stock Adjustment",14,18);doc.setFontSize(11);["Reference: "+ref,"Warehouse: "+wh,"Date: "+whenTxt,"","Product: "+(a.product||a.item||""),"SKU: "+(a.sku||"-"),"Old Qty: "+(a.oldQty!=null?a.oldQty:"-"),"New Qty: "+(a.newQty!=null?a.newQty:"-"),"Change: "+(change>0?"+":"")+change,"Reason: "+(a.reason||"-"),"Status: "+(a.status||"-")].forEach(function(line,i){doc.text(line,14,32+i*8)});saveBlob(doc.output("blob"),ref+".pdf")}catch(e){console.error("[pdf-fix] downloadBAAdjLogEntry failed:",e);alert("Could not generate the PDF. Please try again.")}}})();

/* ===================================================================================
 * Inventory: Stock History / Stock Activity (was stock-ledger.js), Transits (was stock-ledger.js part 2)
 * and Assessment = Stock Take (was stock-take.js). Merged here; starts after the page and every other
 * script has loaded, which is the same moment those files used to run relative to the rest of the app.
 * =================================================================================== */
;(function () {
  function acxStockModulesInit() {
/* ----- STOCK LEDGER + TRANSITS ----- */
/* Acacia Books - Stock Ledger + Stock Transit (one file)
 * PART 1  Reports > Inventory Reports > Stock History, the stock count check and the Stock Activity feed.
 * PART 2  Inventory > Stock Transit page: dispatch / receive / cancel transfers and Add Stock Activity.
 * Part 2 saves transfers in "movements" and manual activities in "stockActivities"; Part 1 reads them. */

/* ===================== PART 1: STOCK LEDGER / HISTORY ===================== */
/* Acacia Books - Reports > Inventory Reports > Stock History
 * One list of every stock movement (sold in Books, sold in POS, bills, returns, adjustments, transfers) and a stock count check.
 * Built from what Books already keeps: invoices (Books + POS), item history (bills / returns / write-offs), adjustments, transfers.
 * Nothing here changes stock. Saved counts are kept in the "stockCounts" list. */
(function (w) {
  'use strict';
  var TAB = 'stockHistoryReportPanel';
  var ls = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var q2 = function (n) { n = Math.round(num(n) * 100) / 100; return n === 0 ? '0' : String(n); };
  var $ = function (id) { return document.getElementById(id); };
  var isStock = function (l) { return typeof w.__acxLineStock === 'function' ? w.__acxLineStock(l) : (!l.type || low(l.type) === 'product'); };

  /* ---------- data ---------- */
  function inventories() {                         /* {warehouse: [items]} the same keys Books deducts from */
    var out = {};
    Object.keys(localStorage).forEach(function (k) {
      var base = k.replace(/^.*::/, '');
      if (base !== 'inventory' && base.indexOf('inventory_') !== 0) return;
      var a = ls(k, []); if (!Array.isArray(a)) return;
      var name = base === 'inventory' ? 'Main' : base.slice(10);
      if (!out[name] || !out[name].length) out[name] = a;
    });
    return out;
  }
  function dateOf(v) { var d = new Date(v); return isNaN(d) ? null : d; }
  function ymd(d) { var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  function build() {
    var inv = inventories(), rows = [];
    var where = function (sku, name) {              /* same lookup order Books uses when it deducts */
      for (var wh in inv) { var hit = (inv[wh] || []).filter(function (x) { return x && (sku && x.sku ? low(x.sku) === low(sku) : low(x.name) === low(name)); })[0]; if (hit) return { wh: wh, it: hit }; }
      return null;
    };
    var add = function (r) { var d = dateOf(r.ts || r.date); if (!d) return; r.ts = d.getTime(); r.date = ymd(d); rows.push(r); };

    /* 1) sales: Books invoices and POS sales */
    (ls('invoices', []) || []).forEach(function (i) {
      if (!i || i.pendingApproval) return;
      var pos = i.source === 'POS', pend = pos && !i.stockDone && !i.acx;
      (i.items || []).forEach(function (l) {
        if (!l || !isStock(l) || l.stk === false) return;
        var q = num(l.qty); if (!q) return;
        var f = where(l.sku, l.desc || l.name), wh = l.warehouse || (f && f.wh) || '';
        add({ ts: pos && i.pos && i.pos.at ? i.pos.at : i.date, item: l.desc || l.name || '', sku: l.sku || (f && f.it.sku) || '', wh: wh,
          src: pos ? 'POS sale' : 'Books sale', chan: pos ? 'POS' : 'Books', type: 'Sale', doc: i.invoiceNumber || '', ref: pos ? (i.posRef || '') : '',
          party: i.customer || '', qin: 0, qout: q, by: pos ? ((i.pos && i.pos.cashier) || '') + (i.pos && i.pos.till ? ' · ' + i.pos.till : '') : (i.createdBy || i.user || ''), pending: pend });
      });
    });
    (ls('bulkInvoices', []) || []).forEach(function (b) {
      (b.items || []).forEach(function (l) {
        if (!l || !isStock(l)) return; var q = num(l.qty); if (!q) return;
        var nm = l.itemName || l.desc || l.name || '', f = where(l.sku, nm);
        add({ ts: b.date, item: nm, sku: l.sku || (f && f.it.sku) || '', wh: l.warehouse || (f && f.wh) || '', src: 'Books sale', chan: 'Books', type: 'Sale (bulk)',
          doc: b.invoiceNo || '', ref: '', party: (b.customers || []).join(', '), qin: 0, qout: q, by: '', pending: false });
      });
    });

    /* 2) what Books already logs on each item: bills, returns, write-offs */
    var HT = { 'bill': ['Purchase', 'Bill'], 'bill deleted': ['Purchase', 'Bill deleted'], 'sales return': ['Sales return', 'Sales return'],
      'purchase return': ['Purchase return', 'Purchase return'], 'purchase return reversed': ['Purchase return', 'Purchase return reversed'], 'stock adjustment': ['Adjustment', 'Write-off'], 'opening balance': ['Opening stock', 'Opening stock'] };
    Object.keys(inv).forEach(function (wh) {
      (inv[wh] || []).forEach(function (it) {
        (it && Array.isArray(it.history) ? it.history : []).forEach(function (h) {
          var m = HT[low(h && h.type)]; if (!m) return; var q = num(h.qty);
          add({ ts: h.isoDate || h.date, item: it.name || '', sku: it.sku || '', wh: wh, src: m[0], chan: 'Books', type: m[1], doc: h.ref || h.refInvoice || '', ref: '',
            party: h.refSupplier || '', qin: q > 0 ? q : 0, qout: q < 0 ? -q : 0, by: h.user || '', pending: false });
        });
      });
    });

    /* 3) manual adjustments and warehouse transfers */
    (ls('amendments', []) || []).concat((ls('baLog', []) || []).map(function (e) { return { date: e.date, warehouse: e.warehouse, item: e.product, sku: e.sku, quantity: e.change, user: e.user, reason: 'Bulk adjustment' }; })).forEach(function (a) {
      if (!a) return; var q = num(a.quantity), t = low(a.adjustmentType);
      if (t === 'decrease') q = -Math.abs(q); else if (t === 'increase') q = Math.abs(q);
      if (!q) return;
      add({ ts: a.date, item: a.item || '', sku: a.sku || '', wh: a.warehouse || '', src: 'Adjustment', chan: 'Books', type: a.reason || 'Adjustment', doc: '', ref: '', party: '',
        qin: q > 0 ? q : 0, qout: q < 0 ? -q : 0, by: a.user || '', pending: false });
    });
    (ls('movements', []) || []).forEach(function (m) {
      if (!m) return; var q = num(m.quantity); if (!q) return;
      var f = where('', m.item), sku = m.sku || (f && f.it.sku) || '', st = m.status || 'Received', no = m.transitNo || '';
      /* leaves the sending warehouse when dispatched */
      add({ ts: m.date, item: m.item || '', sku: sku, wh: m.from || '', src: 'Transfer', chan: 'Books', type: st === 'In Transit' ? 'Transfer out (in transit)' : 'Transfer out', doc: no, ref: m.reference || '', party: '→ ' + (m.to || ''), qin: 0, qout: q, by: m.dispatchedBy || '', pending: false });
      /* reaches the receiving warehouse only when received */
      if (st === 'Received') add({ ts: m.receivedDate || m.date, item: m.item || '', sku: sku, wh: m.to || '', src: 'Transfer', chan: 'Books', type: 'Transfer in', doc: no, ref: m.reference || '', party: '← ' + (m.from || ''), qin: q, qout: 0, by: m.receivedBy || '', pending: false });
      /* cancelled transit goes back to the sender */
      if (st === 'Cancelled') add({ ts: m.cancelledDate || m.date, item: m.item || '', sku: sku, wh: m.from || '', src: 'Transfer', chan: 'Books', type: 'Transit cancelled (returned)', doc: no, ref: m.reference || '', party: '', qin: q, qout: 0, by: m.cancelledBy || '', pending: false });
    });

    /* 4) manual Stock In / Stock Out / Adjustments added on the Stock Transit page */
    (ls('stockActivities', []) || []).forEach(function (a) {
      if (!a) return; var qi = num(a.qin), qo = num(a.qout); if (!qi && !qo) return;
      add({ ts: a.date, item: a.item || '', sku: a.sku || '', wh: a.warehouse || '', src: 'Adjustment', chan: 'Books', type: a.type || 'Stock activity', doc: a.no || '', ref: a.reference || '', party: a.reason || '', qin: qi, qout: qo, by: a.by || '', pending: false });
    });
    rows.sort(function (a, b) { return b.ts - a.ts; });
    return { rows: rows, inv: inv };
  }

  /* ---------- UI ---------- */
  var cache = null, view = 'ledger', lastCount = null;
  var SRC = ['Books sale', 'POS sale', 'Purchase', 'Sales return', 'Purchase return', 'Adjustment', 'Transfer', 'Opening stock'];
  function html() {
    return '<h2 class="text-sm font-bold mb-3">Stock History</h2>' +
      '<div class="flex gap-2 mb-3"><button id="slV1" class="px-3 py-1 rounded border">Movement ledger</button><button id="slV2" class="px-3 py-1 rounded border">Stock count check</button></div>' +
      '<div id="slFilters" class="flex flex-wrap gap-2 items-end mb-3"></div><div id="slBody" class="overflow-x-auto"></div><div id="slSaved" class="mt-4"></div>';
  }
  function whOptions(sel) { return '<option value="">All warehouses</option>' + Object.keys(cache.inv).sort().map(function (k) { return '<option' + (k === sel ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join(''); }
  function field(label, inner) { return '<label class="text-xs text-gray-600 flex flex-col">' + label + inner + '</label>'; }
  var IN = 'border rounded px-2 py-1 text-sm';

  function render() {
    var host = $(TAB); if (!host) return; if (!host.firstChild || !$('slBody')) host.innerHTML = html();
    cache = build();
    $('slV1').style.background = view === 'ledger' ? '#1e3a8a' : ''; $('slV1').style.color = view === 'ledger' ? '#fff' : '';
    $('slV2').style.background = view === 'count' ? '#1e3a8a' : ''; $('slV2').style.color = view === 'count' ? '#fff' : '';
    $('slV1').onclick = function () { view = 'ledger'; render(); }; $('slV2').onclick = function () { view = 'count'; render(); };
    view === 'ledger' ? ledger() : count();
  }
  function keepVal(id, d) { var e = $(id); return e ? e.value : d; }

  function ledger() {
    var keep = { from: keepVal('slFrom', ''), to: keepVal('slTo', ''), wh: keepVal('slWh', ''), src: keepVal('slSrc', ''), q: keepVal('slQ', '') };
    $('slSaved').innerHTML = '';
    $('slFilters').innerHTML =
      field('From', '<input id="slFrom" type="date" class="' + IN + '" value="' + esc(keep.from) + '">') + field('To', '<input id="slTo" type="date" class="' + IN + '" value="' + esc(keep.to) + '">') +
      field('Warehouse', '<select id="slWh" class="' + IN + '">' + whOptions(keep.wh) + '</select>') +
      field('Source', '<select id="slSrc" class="' + IN + '"><option value="">All sources</option><option value="Books sale"' + (keep.src === 'Books sale' ? ' selected' : '') + '>Sold in Books</option><option value="POS sale"' + (keep.src === 'POS sale' ? ' selected' : '') + '>Sold in POS</option>' +
        SRC.slice(2).map(function (s) { return '<option' + (s === keep.src ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>') +
      field('Item / document', '<input id="slQ" class="' + IN + '" placeholder="item, SKU, INV no." value="' + esc(keep.q) + '">') +
      '<button id="slCsv" class="px-3 py-1 rounded bg-blue-900 text-white text-sm">Export CSV</button>';
    ['slFrom', 'slTo', 'slWh', 'slSrc'].forEach(function (id) { $(id).onchange = paintLedger; }); $('slQ').oninput = paintLedger; $('slCsv').onclick = function () { csv(paintLedger(true)); };
    paintLedger();
  }
  function filtered() {
    var f = $('slFrom').value, t = $('slTo').value, wh = $('slWh').value, s = $('slSrc').value, q = low($('slQ').value);
    return cache.rows.filter(function (r) {
      return (!f || r.date >= f) && (!t || r.date <= t) && (!wh || r.wh === wh) && (!s || r.src === s) &&
        (!q || low(r.item + ' ' + r.sku + ' ' + r.doc + ' ' + r.ref + ' ' + r.party).indexOf(q) > -1);
    });
  }
  function paintLedger(ret) {
    var list = filtered(), tin = 0, tout = 0, tb = 0, tp = 0;
    list.forEach(function (r) { if (r.pending) return; tin += r.qin; tout += r.qout; if (r.src === 'Books sale') tb += r.qout; if (r.src === 'POS sale') tp += r.qout; });
    if (ret === true) return list;
    $('slBody').innerHTML = '<p class="text-sm mb-2"><b>' + list.length + '</b> movement(s) · In <b>' + q2(tin) + '</b> · Out <b>' + q2(tout) + '</b> · Sold in Books <b>' + q2(tb) + '</b> · Sold in POS <b>' + q2(tp) + '</b></p>' +
      '<table class="min-w-full text-sm border"><thead><tr class="bg-gray-100">' + ['Date', 'Item', 'SKU', 'Warehouse', 'Source', 'Type', 'Document', 'Party', 'In', 'Out', 'By'].map(function (h, i) { return '<th class="border px-2 py-1 text-' + (i === 8 || i === 9 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (list.slice(0, 1500).map(function (r) {
        var badge = r.chan === 'POS' ? '<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:0 6px">POS</span>' : r.src === 'Books sale' ? '<span style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:0 6px">Books</span>' : esc(r.src);
        return '<tr' + (r.pending ? ' style="opacity:.6"' : '') + '><td class="border px-2 py-1 whitespace-nowrap">' + esc(r.date) + '</td><td class="border px-2 py-1">' + esc(r.item) + '</td><td class="border px-2 py-1">' + esc(r.sku) + '</td><td class="border px-2 py-1">' + esc(r.wh || '—') + '</td><td class="border px-2 py-1">' + badge + '</td><td class="border px-2 py-1">' + esc(r.type) + (r.pending ? ' <i>(not yet deducted)</i>' : '') + '</td><td class="border px-2 py-1">' + esc(r.doc) + (r.ref ? '<br><small class="text-gray-500">till ref ' + esc(r.ref) + '</small>' : '') + '</td><td class="border px-2 py-1">' + esc(r.party) + '</td><td class="border px-2 py-1 text-right">' + (r.qin ? q2(r.qin) : '') + '</td><td class="border px-2 py-1 text-right">' + (r.qout ? q2(r.qout) : '') + '</td><td class="border px-2 py-1">' + esc(r.by) + '</td></tr>';
      }).join('') || '<tr><td colspan="11" class="text-center p-4 text-gray-500">No movements found for these filters.</td></tr>') + '</tbody></table>' + (list.length > 1500 ? '<p class="text-xs text-gray-500">Showing the latest 1500. Narrow the dates or export CSV for everything.</p>' : '');
  }

  /* ---- stock count check ---- */
  function count(preset) {
    var today = ymd(new Date()), first = today.slice(0, 8) + '01';
    var keep = preset || { from: keepVal('scFrom', first), to: keepVal('scTo', today), wh: keepVal('scWh', Object.keys(cache.inv).sort()[0] || '') };
    $('slFilters').innerHTML = field('Count from', '<input id="scFrom" type="date" class="' + IN + '" value="' + keep.from + '">') + field('Counted as at', '<input id="scTo" type="date" class="' + IN + '" value="' + keep.to + '">') +
      field('Warehouse', '<select id="scWh" class="' + IN + '">' + Object.keys(cache.inv).sort().map(function (k) { return '<option' + (k === keep.wh ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>') +
      '<button id="scSave" class="px-3 py-1 rounded bg-green-700 text-white text-sm">Save count</button><button id="scPrint" class="px-3 py-1 rounded border text-sm">Print count sheet</button><button id="scCsv" class="px-3 py-1 rounded bg-blue-900 text-white text-sm">Export CSV</button>';
    ['scFrom', 'scTo', 'scWh'].forEach(function (id) { $(id).onchange = function () { count(); }; });
    var from = $('scFrom').value, to = $('scTo').value, wh = $('scWh').value, items = (cache.inv[wh] || []).filter(function (x) { return x && x.name && x.active !== false; });
    var mv = cache.rows.filter(function (r) { return r.wh === wh && !r.pending; });
    var oldCounts = (preset && preset.counted) || {};
    var lines = items.map(function (it) {
      var mine = mv.filter(function (r) { return it.sku && r.sku ? low(r.sku) === low(it.sku) : low(r.item) === low(it.name); });
      var now = num(it.qty), after = 0, p = { books: 0, pos: 0, recv: 0, ret: 0, adj: 0, trf: 0 };
      mine.forEach(function (r) {
        if (r.date > to) after += r.qin - r.qout;
        if (r.date >= from && r.date <= to) {
          if (r.src === 'Books sale') p.books += r.qout; else if (r.src === 'POS sale') p.pos += r.qout; else if (r.src === 'Purchase') p.recv += r.qin - r.qout;
          else if (r.src === 'Sales return' || r.src === 'Purchase return') p.ret += r.qin - r.qout; else if (r.src === 'Adjustment') p.adj += r.qin - r.qout; else if (r.src === 'Transfer') p.trf += r.qin - r.qout;
        }
      });
      var exp = Math.round((now - after) * 100) / 100, k = (it.sku || it.name);
      return { name: it.name, sku: it.sku || '', now: now, exp: exp, p: p, key: k, counted: oldCounts[k] };
    });
    $('slBody').innerHTML = '<p class="text-xs text-gray-600 mb-2">Expected = stock in the system now, less anything that moved after the "counted as at" date. Type the quantity you counted; the difference shows at once.</p>' +
      '<table class="min-w-full text-sm border"><thead><tr class="bg-gray-100">' + ['Item', 'SKU', 'System now', 'Sold in Books', 'Sold in POS', 'Bills in', 'Returns', 'Adjust.', 'Transfers', 'Expected', 'Counted', 'Difference'].map(function (h, i) { return '<th class="border px-2 py-1 text-' + (i > 1 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (lines.map(function (l, i) {
        return '<tr data-i="' + i + '"><td class="border px-2 py-1">' + esc(l.name) + '</td><td class="border px-2 py-1">' + esc(l.sku) + '</td><td class="border px-2 py-1 text-right">' + q2(l.now) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.books) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.pos) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.recv) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.ret) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.adj) + '</td><td class="border px-2 py-1 text-right">' + q2(l.p.trf) + '</td><td class="border px-2 py-1 text-right"><b>' + q2(l.exp) + '</b></td><td class="border px-2 py-1 text-right"><input type="number" step="any" class="scIn border rounded px-1 py-0.5 w-24 text-right" value="' + (l.counted == null ? '' : l.counted) + '"></td><td class="border px-2 py-1 text-right scDiff"></td></tr>';
      }).join('') || '<tr><td colspan="12" class="text-center p-4 text-gray-500">No items in this warehouse.</td></tr>') + '</tbody></table>';
    var paintDiff = function (tr) { var inp = tr.querySelector('.scIn'), d = tr.querySelector('.scDiff'), l = lines[+tr.dataset.i]; if (inp.value === '') { d.textContent = ''; return; } var v = Math.round((num(inp.value) - l.exp) * 100) / 100; d.textContent = (v > 0 ? '+' : '') + q2(v); d.style.color = v === 0 ? '#15803d' : '#b91c1c'; d.style.fontWeight = '700'; };
    document.querySelectorAll('#slBody tbody tr[data-i]').forEach(function (tr) { tr.querySelector('.scIn').oninput = function () { paintDiff(tr); }; paintDiff(tr); });
    var collect = function () { var o = {}; document.querySelectorAll('#slBody tbody tr[data-i]').forEach(function (tr) { var v = tr.querySelector('.scIn').value; if (v !== '') o[lines[+tr.dataset.i].key] = num(v); }); return o; };
    $('scSave').onclick = function () {
      var c = collect(); if (!Object.keys(c).length) return alert('Type at least one counted quantity first.');
      var u = ls('loggedInUser', null) || {}, all = ls('stockCounts', []); if (!Array.isArray(all)) all = [];
      all.unshift({ id: Date.now(), savedAt: new Date().toISOString(), by: u.name || '', warehouse: wh, from: from, to: to, counted: c,
        lines: lines.filter(function (l) { return c[l.key] != null; }).map(function (l) { return { name: l.name, sku: l.sku, expected: l.exp, counted: c[l.key], difference: Math.round((c[l.key] - l.exp) * 100) / 100 }; }) });
      localStorage.setItem('stockCounts', JSON.stringify(all.slice(0, 100))); saved(); alert('Stock count saved.');
    };
    $('scCsv').onclick = function () { var c = collect(); csvRaw([['Item', 'SKU', 'System now', 'Sold in Books', 'Sold in POS', 'Bills in', 'Returns', 'Adjustments', 'Transfers', 'Expected', 'Counted', 'Difference']].concat(lines.map(function (l) { var ct = c[l.key]; return [l.name, l.sku, l.now, l.p.books, l.p.pos, l.p.recv, l.p.ret, l.p.adj, l.p.trf, l.exp, ct == null ? '' : ct, ct == null ? '' : Math.round((ct - l.exp) * 100) / 100]; })), 'stock-count-' + wh + '-' + to + '.csv'); };
    $('scPrint').onclick = function () {
      var win = window.open('', '_blank'); if (!win) return alert('Popup blocked! Please allow pop-ups.');
      win.document.write('<html><head><title>Count sheet</title><style>body{font:13px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:5px}</style></head><body><h3>Stock count sheet - ' + esc(wh) + ' - as at ' + esc(to) + '</h3><table><tr><th>Item</th><th>SKU</th><th>Expected</th><th>Counted</th><th>Difference</th></tr>' + lines.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.sku) + '</td><td align=right>' + q2(l.exp) + '</td><td style="width:90px"></td><td style="width:90px"></td></tr>'; }).join('') + '</table></body></html>'); win.document.close(); win.print();
    };
    saved();
  }
  function saved() {
    var all = ls('stockCounts', []); if (!Array.isArray(all) || !all.length || view !== 'count') { $('slSaved').innerHTML = ''; return; }
    $('slSaved').innerHTML = '<h3 class="text-sm font-bold mb-2">Saved counts</h3><table class="text-sm border"><thead><tr class="bg-gray-100"><th class="border px-2 py-1">Saved</th><th class="border px-2 py-1">Warehouse</th><th class="border px-2 py-1">As at</th><th class="border px-2 py-1">By</th><th class="border px-2 py-1">Items</th><th class="border px-2 py-1">With difference</th><th class="border px-2 py-1"></th></tr></thead><tbody>' +
      all.slice(0, 15).map(function (c, i) { return '<tr><td class="border px-2 py-1">' + esc(new Date(c.savedAt).toLocaleString()) + '</td><td class="border px-2 py-1">' + esc(c.warehouse) + '</td><td class="border px-2 py-1">' + esc(c.to) + '</td><td class="border px-2 py-1">' + esc(c.by) + '</td><td class="border px-2 py-1 text-right">' + c.lines.length + '</td><td class="border px-2 py-1 text-right">' + c.lines.filter(function (l) { return l.difference !== 0; }).length + '</td><td class="border px-2 py-1"><button data-o="' + i + '" class="text-blue-700">Open</button> · <button data-d="' + i + '" class="text-red-600">Delete</button></td></tr>'; }).join('') + '</tbody></table>';
    $('slSaved').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return; var list = ls('stockCounts', []);
      if (b.dataset.o != null) { var c = list[+b.dataset.o]; if (c) { view = 'count'; count({ from: c.from, to: c.to, wh: c.warehouse, counted: c.counted }); } }
      if (b.dataset.d != null && confirm('Delete this saved count?')) { list.splice(+b.dataset.d, 1); localStorage.setItem('stockCounts', JSON.stringify(list)); saved(); }
    };
  }
  function csvRaw(rows, name) {
    var t = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
  }
  function csv(list) { csvRaw([['Date', 'Item', 'SKU', 'Warehouse', 'Source', 'Type', 'Document', 'Till ref', 'Party', 'In', 'Out', 'By', 'Not yet deducted']].concat(list.map(function (r) { return [r.date, r.item, r.sku, r.wh, r.src, r.type, r.doc, r.ref, r.party, r.qin, r.qout, r.by, r.pending ? 'yes' : '']; })), 'stock-history.csv'); }


  /* ---------- Stock Activity feed (used by the Stock Transit page) ---------- */
  function activityOf(r) {
    if (r.src === 'Books sale' || r.src === 'POS sale') return { a: r.pending ? 'Sale (not yet deducted)' : 'Sale', c: 'Sale' };
    if (r.src === 'Purchase') return { a: r.type === 'Bill deleted' ? 'Purchase (bill deleted)' : 'Purchase', c: 'Purchase' };
    if (r.src === 'Sales return') return { a: 'Sales Return', c: 'Sales Return' };
    if (r.src === 'Purchase return') return { a: r.type === 'Purchase return reversed' ? 'Purchase Return (reversed)' : 'Purchase Return', c: 'Purchase Return' };
    if (r.src === 'Opening stock') return { a: 'Opening Stock', c: 'Opening Stock' };
    if (r.src === 'Transfer') return { a: r.type, c: 'Transfer' };
    return { a: r.type || 'Adjustment', c: 'Adjustment' };
  }
  function pendingDocs() {                          /* documents that do not move stock (yet) */
    var out = [], done = /convert|invoic|receiv|fulfil|complet|closed|cancel|reject|deliver|billed/i;
    [['quotes', 'Quotation', ['quoteNumber', 'number']], ['orders', 'Sales Order', ['orderNumber', 'soNumber', 'number', 'id']], ['purchaseOrders', 'Purchase Order', ['poNumber', 'number']]].forEach(function (k) {
      (ls(k[0], []) || []).forEach(function (d) {
        if (!d) return; var no = ''; k[2].forEach(function (f) { if (!no && d[f] != null && d[f] !== '') no = d[f]; });
        var st = String(d.status || ''), isQ = k[1] === 'Quotation', over = done.test(st), dt = dateOf(d.date || d.orderDate);
        (d.items || []).forEach(function (l) {
          if (!l || !isStock(l)) return; var q = num(l.qty != null ? l.qty : l.quantity); if (!q) return;
          out.push({ ts: dt ? dt.getTime() : 0, date: dt ? ymd(dt) : '', item: l.desc || l.name || l.item || l.product || l.description || '', wh: l.warehouse || '',
            a: k[1] + ' - ' + (isQ || over ? 'No movement' : 'Pending'), c: isQ || over ? 'No movement' : 'Pending', ref: String(no), qin: 0, qout: 0, note: q + ' unit(s)' + (st ? ' - ' + st : '') });
        });
      });
    });
    return out;
  }
  w.acxStockActivity = function () {
    var rows = build().rows.map(function (r) { var x = activityOf(r); return { ts: r.ts, date: r.date, item: r.item, wh: r.wh, a: x.a, c: x.c, ref: r.doc || r.ref || '', qin: r.qin, qout: r.qout, note: r.party || '' }; });
    return rows.concat(pendingDocs()).sort(function (a, b) { return b.ts - a.ts; });
  };

  /* ---------- mount: report under Reports > Inventory Reports ---------- */
  function mount() {
    var area = document.querySelector('.reports-content'), list = document.querySelector('ul.rep-cat-children[data-cat="cat_inventoryReports"]'); if (!area || !list) return false;
    /* the old Stock History entry under Inventory > Stock is gone */
    var old = document.querySelector('#inventorySubmenu [data-stock-history]'); if (old) { var oli = old.closest('li'); (oli || old).remove(); }
    var oldTab = $('stockLedgerTab'); if (oldTab) oldTab.remove();
    if (!$(TAB)) { var d = document.createElement('div'); d.id = TAB; d.className = 'report-view hidden bg-white rounded-lg shadow mb-6 p-6 border-t'; area.appendChild(d); }
    if (!list.querySelector('[data-stock-history]')) {
      var li = document.createElement('li'); li.setAttribute('data-stock-history', '1'); li.textContent = '📁 Stock History';
      li.onclick = function () { w.showReport(TAB, li); };
      var after = list.querySelector('li[onclick*="stockAssessmentReportPanel"]');
      after ? after.parentNode.insertBefore(li, after.nextSibling) : list.appendChild(li);
      var head = document.querySelector('.rep-cat-header[data-cat="cat_inventoryReports"] .rep-cat-count');
      if (head) { var n = parseInt(String(head.textContent).replace(/\D/g, ''), 10); if (n >= 0) head.textContent = '(' + (n + 1) + ')'; }
    }
    if (!w.__slHooked && typeof w.showReport === 'function') {
      w.__slHooked = true; var orig = w.showReport;
      w.showReport = function (id) { var r = orig.apply(this, arguments); if (id === TAB) { try { render(); } catch (e) { console.error('[stock-history]', e); } } return r; };
    }
    return true;
  }
  var tries = 0; (function go() { if (!mount() && tries++ < 40) setTimeout(go, 500); })();
  w.renderStockHistory = render;
})(window);

/* ===================== PART 2: STOCK TRANSIT ===================== */
/* Acacia Books - Inventory > Stock Transit
 * Replaces the old "movement" page.
 *  - Transfer from warehouse A to warehouse B goes through TRANSIT:
 *      Dispatch  -> stock leaves the source warehouse now, destination does NOT get it yet (status "In Transit")
 *      Receive   -> destination warehouse gets the stock (status "Received")
 *      Cancel    -> stock goes back to the source warehouse (status "Cancelled")
 *  - "Add Stock Activity" also records Stock In, Stock Out and Adjustments (kept in the "stockActivities" list).
 *  - Transfers are still saved in the existing "movements" list, so Recycle Bin, sync and the Stock Transfers report keep working.
 *    Old transfers (saved before this change, no status) show as Received.
 *  - Everything is read by Reports > Inventory Reports > Stock History (stock-ledger.js). */
(function (w) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n, l) { return String(n).padStart(l, '0'); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var rd = function (k) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  var mv = function () { return rd('movements'); };
  var setMv = function (a) { localStorage.setItem('movements', JSON.stringify(a)); };
  var acts = function () { return rd('stockActivities'); };
  var setActs = function (a) { localStorage.setItem('stockActivities', JSON.stringify(a)); };
  function who() { try { var u = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {}; return u.name || u.fullName || u.username || u.email || ''; } catch (e) { return ''; } }
  var statusOf = function (m) { return (m && m.status) || 'Received'; };
  var same = function (x, m) { return x && ((m.sku && x.sku && low(x.sku) === low(m.sku)) || low(x.name) === low(m.item)); };

  function nextNo(list, prefix, field) {
    var max = list.length;
    list.forEach(function (r) { var d = parseInt(String(r && r[field] || '').replace(/\D/g, ''), 10); if (d > max) max = d; });
    return prefix + pad(max + 1, 4);
  }
  function refresh() {
    ['renderMovementTable', 'renderInventoryTable', 'renderStockTransfer'].forEach(function (f) { try { if (typeof w[f] === 'function') w[f](); } catch (e) { console.error('[stock-transit]', f, e); } });
  }
  function itemsOf(wh) { try { return (wh ? w.getInventory(wh) : w.getAllInventories()) || []; } catch (e) { return []; } }

  /* ---------- page ---------- */
  var BTN = 'bg-blue-900 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-800';
  var INP = 'border p-2 rounded w-full text-sm';
  function tabHtml() {
    return '<h2 class="text-sm font-bold mb-1">Transits</h2>' +
      '<div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">' +
        '<div class="flex flex-wrap items-center gap-2">' +
          '<input id="movementSearch" placeholder="Search transit no., item, warehouse" class="border rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" oninput="searchMovement()">' +
          '<select id="trStatus" class="border rounded-md px-2 py-1.5 text-sm" onchange="renderMovementTable()"><option value="">All statuses</option><option>In Transit</option><option>Received</option><option>Cancelled</option></select>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<button id="trAddBtn" class="' + BTN + ' font-semibold" onclick="trToggleForm()">New</button>' +
          '<div id="movementExpertSection" class="relative inline-block text-left"><button id="movementExpertBtn" class="inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-1.5 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">Options</button>' +
          '<div id="movementDropdown" class="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 hidden z-50"><div class="py-1">' +
            '<button onclick="trExport()" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Export transit list (CSV)</button>' +
            '<button onclick="window.print()" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Print</button></div></div></div>' +
        '</div>' +
      '</div>' +
      '<div id="trSummary" class="text-xs text-gray-700 mb-3"></div>' +

      '<div id="trForm" class="bg-white p-6 rounded shadow space-y-4 mb-6 hidden"><h3 class="text-sm font-bold text-gray-700 border-b pb-2">Add Stock Activity</h3>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div><label class="block text-sm font-semibold mb-1">Activity <span class="text-red-500">*</span></label><select id="actType" class="' + INP + '" onchange="trActChange()">' +
            '<option value="transfer">Transfer between warehouses (goes In Transit)</option><option value="in">Stock In</option><option value="out">Stock Out</option><option value="inc">Adjustment - increase</option><option value="dec">Adjustment - decrease</option></select></div>' +
          '<div id="trWhOne" class="hidden"><label class="block text-sm font-semibold mb-1">Warehouse <span class="text-red-500">*</span></label><select id="actWarehouse" class="' + INP + '" onchange="populateMovementItems()"><option value="">Select Warehouse</option></select></div>' +
          '<div id="trWhFrom"><label class="block text-sm font-semibold mb-1">From warehouse (sending) <span class="text-red-500">*</span></label><select id="fromLocation" class="' + INP + '" onchange="populateMovementItems()"><option value="">Select Warehouse</option></select></div>' +
          '<div id="trWhTo"><label class="block text-sm font-semibold mb-1">To warehouse (receiving) <span class="text-red-500">*</span></label><select id="toLocation" class="' + INP + '"><option value="">Select Warehouse</option></select></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Item <span class="text-red-500">*</span></label><select id="transferItem" class="' + INP + '"><option value="">Select Item</option></select></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Quantity <span class="text-red-500">*</span></label><input id="transferQuantity" type="number" min="0" step="any" placeholder="Quantity" class="' + INP + '"></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Date <span class="text-red-500">*</span></label><input id="transferDate" type="date" class="' + INP + '"></div>' +
          '<div><label class="block text-sm font-semibold mb-1">Reference number</label><input id="actRef" placeholder="Invoice, transfer or adjustment no." class="' + INP + '"></div>' +
        '</div>' +
        '<div><label class="block text-sm font-semibold mb-1">Reason / Notes</label><textarea id="actNotes" class="' + INP + ' resize-y" rows="2" placeholder="Reason / notes"></textarea></div>' +
        '<div class="text-right space-x-2 border-t pt-4"><button id="trSave" onclick="saveTransfer()" class="' + BTN + ' font-semibold">Dispatch to Transit</button> <button onclick="cancelTransfer()" class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600">Cancel</button></div>' +
      '</div>' +

      '<div class="bg-white p-4 rounded shadow mb-6"><div class="flex justify-between items-center mb-4"><h3 class="text-sm font-semibold">Transits</h3></div>' +
        '<div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr>' +
          ['Transit No.', 'Date', 'Item', 'SKU', 'From', 'To', 'Quantity', 'Dispatched By', 'Received By', 'Status'].map(function (h) { return '<th class="border p-2 text-left">' + h + '</th>'; }).join('') +
          '<th class="border p-2 text-center">Actions</th></tr></thead><tbody id="movementTableBody"></tbody></table></div>' +
        '<div id="paginationControls" class="flex items-center justify-between mt-4 px-2 text-sm text-gray-600"><div>Total Count: <span id="totalCount">0</span></div><div>Show <select id="itemsPerPageSelect" class="border rounded px-2 py-1 mx-1"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select> per page</div><div class="space-x-1"><button id="prevPageBtn" class="px-2 py-1 border rounded disabled:opacity-50" disabled="disabled">Prev</button> <span id="pageInfo" class="px-2">1 - 0</span> <button id="nextPageBtn" class="px-2 py-1 border rounded disabled:opacity-50" disabled="disabled">Next</button></div></div>' +
      '</div>';
  }

  /* ---------- dropdowns ---------- */
  function fillSelect(el, names, keep) {
    if (!el) return; var cur = keep == null ? el.value : keep;
    el.innerHTML = '<option value="">Select Warehouse</option>' + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    if (cur && names.indexOf(cur) > -1) el.value = cur;
  }
  w.populateMovementWarehouses = function () {
    var names = []; try { names = (JSON.parse(localStorage.getItem('warehouses') || '[]') || []).map(function (x) { return x && x.name; }).filter(Boolean); } catch (e) {}
    fillSelect($('fromLocation'), names); fillSelect($('toLocation'), names); fillSelect($('actWarehouse'), names);
  };
  w.populateMovementItems = function () {
    var sel = $('transferItem'); if (!sel) return;
    var t = $('actType') ? $('actType').value : 'transfer';
    var wh = t === 'transfer' ? ($('fromLocation') || {}).value : ($('actWarehouse') || {}).value;
    var list = (t === 'in' || !wh) ? itemsOf('') : itemsOf(wh), seen = {}, cur = sel.value;
    sel.innerHTML = '<option value="">Select Item</option>';
    list.forEach(function (it) {
      if (!it || !it.name) return; var k = it.sku || it.name; if (seen[k]) return; seen[k] = 1;
      var o = document.createElement('option'); o.value = k; o.textContent = it.name + ' (' + (it.sku || 'No SKU') + ')'; sel.appendChild(o);
    });
    if (cur && seen[cur]) sel.value = cur;
  };
  w.trActChange = function () {
    var t = $('actType').value, tr = t === 'transfer';
    $('trWhOne').classList.toggle('hidden', tr); $('trWhFrom').classList.toggle('hidden', !tr); $('trWhTo').classList.toggle('hidden', !tr);
    $('trSave').textContent = tr ? (w.__trEdit != null ? 'Update Transit' : 'Dispatch to Transit') : 'Save Stock Activity';
    w.populateMovementItems();
  };
  w.trToggleForm = function (show) {
    var f = $('trForm'); if (!f) return; var open = typeof show === 'boolean' ? show : f.classList.contains('hidden');
    f.classList.toggle('hidden', !open);
    if (open) { w.populateMovementWarehouses(); w.trActChange(); if (!$('transferDate').value) $('transferDate').value = today(); }
  };

  /* ---------- save: transfer (dispatch) or stock activity ---------- */
  function findIn(inv, key) { return (inv || []).filter(function (x) { return x && (x.sku === key || x.name === key); })[0]; }
  function templateFor(key) { var all = itemsOf(''); return findIn(all, key); }
  function clean(it, qty) { var c = Object.assign({}, it); delete c.history; c.qty = qty; return c; }

  w.saveTransfer = function () {
    var t = $('actType').value, key = $('transferItem').value, qty = num($('transferQuantity').value), date = $('transferDate').value;
    var ref = $('actRef').value.trim(), note = $('actNotes').value.trim();
    if (!key || !(qty > 0) || !date) return alert('Please choose the item, a quantity above 0 and a date.');
    if (t === 'transfer') {
      var from = $('fromLocation').value, to = $('toLocation').value;
      if (!from || !to) return alert('Please choose the sending and the receiving warehouse.');
      if (from === to) return alert('From and To warehouses cannot be the same.');
      var listE = mv(), ed = (w.__trEdit != null) ? listE[w.__trEdit] : null;
      if (ed && statusOf(ed) !== 'In Transit') ed = null;
      var inv0 = w.getInventory(from), it0 = findIn(inv0, key);
      var back = (ed && ed.from === from && same(it0, ed)) ? num(ed.quantity) : 0;    /* the old dispatch is given back first */
      if (!it0 || num(it0.qty) + back < qty) return alert('Insufficient quantity in source warehouse.');
      if (ed) {                                                                       /* put the old quantity back in the old sending warehouse */
        var oldInv = w.getInventory(ed.from) || [], oh = oldInv.filter(function (x) { return same(x, ed); })[0];
        if (oh) oh.qty = num(oh.qty) + num(ed.quantity); else oldInv.push(clean(templateFor(ed.sku || ed.item) || { name: ed.item, sku: ed.sku || '' }, num(ed.quantity)));
        w.saveInventory(ed.from, oldInv);
      }
      var inv = w.getInventory(from), it = findIn(inv, key);
      it.qty = num(it.qty) - qty; w.saveInventory(from, inv);                        /* leaves the sender now; destination waits for Receive */
      var list = mv();
      if (ed) {
        var e2 = list[w.__trEdit];
        e2.item = it.name; e2.sku = it.sku || ''; e2.from = from; e2.to = to; e2.quantity = qty; e2.date = date; e2.reference = ref; e2.reason = note;
        w.__trEdit = null; setMv(list);
        alert('Transit updated.');
      } else {
      list.push({ id: 'TR' + Date.now(), transitNo: nextNo(list, 'TRN-', 'transitNo'), item: it.name, sku: it.sku || '', from: from, to: to, quantity: qty, date: date,
        status: 'In Transit', dispatchedBy: who(), receivedBy: '', receivedDate: '', reference: ref, reason: note });
      setMv(list);
      alert('Stock dispatched. It is now In Transit and will be added to ' + to + ' when it is received.');
      }
    } else {
      var wh = $('actWarehouse').value; if (!wh) return alert('Please choose the warehouse.');
      var inc = (t === 'in' || t === 'inc'), invW = w.getInventory(wh) || [], itW = findIn(invW, key);
      if (!inc && (!itW || num(itW.qty) < qty)) return alert('Insufficient quantity in this warehouse.');
      if (!itW) { var tpl = templateFor(key); if (!tpl) return alert('Item not found.'); itW = clean(tpl, 0); invW.push(itW); }
      itW.qty = num(itW.qty) + (inc ? qty : -qty); w.saveInventory(wh, invW);
      var a = acts();
      a.push({ id: 'SA' + Date.now(), no: nextNo(a, 'ACT-', 'no'), type: { in: 'Stock In', out: 'Stock Out', inc: 'Adjustment (increase)', dec: 'Adjustment (decrease)' }[t],
        item: itW.name, sku: itW.sku || '', warehouse: wh, qin: inc ? qty : 0, qout: inc ? 0 : qty, date: date, reference: ref, reason: note, by: who() });
      setActs(a);
      alert('Stock activity saved.');
    }
    w.cancelTransfer(); w.trToggleForm(false); refresh();
  };
  w.cancelTransfer = function () {
    w.__trEdit = null; if ($('actType')) $('actType').disabled = false;
    ['transferItem', 'fromLocation', 'toLocation', 'actWarehouse', 'transferQuantity', 'transferDate', 'actRef', 'actNotes'].forEach(function (id) { var e = $(id); if (e) e.value = ''; });
    if ($('actType')) { $('actType').value = 'transfer'; w.trActChange(); }
    w.trToggleForm(false);
  };

  /* ---------- receive / cancel ---------- */
  w.trReceive = function (i) {
    var list = mv(), m = list[i]; if (!m || statusOf(m) !== 'In Transit') return;
    var old = $('trRecv'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'trRecv';
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center';
    box.innerHTML = '<div class="bg-white rounded shadow-lg p-5 w-96 max-w-full"><h3 class="text-sm font-bold mb-1">Receive stock</h3>' +
      '<p class="text-xs text-gray-600 mb-3">' + esc(m.transitNo || '') + ': ' + esc(m.quantity) + ' x ' + esc(m.item) + ' from ' + esc(m.from) + ' to <b>' + esc(m.to) + '</b>. The quantity is added to ' + esc(m.to) + ' now.</p>' +
      '<label class="block text-sm font-semibold mb-1">Received by</label><input id="trRcvBy" class="' + INP + ' mb-3" value="' + esc(who()) + '">' +
      '<label class="block text-sm font-semibold mb-1">Date received</label><input id="trRcvDate" type="date" class="' + INP + ' mb-4" value="' + today() + '">' +
      '<div class="text-right space-x-2"><button id="trRcvNo" class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm">Close</button><button id="trRcvOk" class="' + BTN + ' font-semibold">Confirm receipt</button></div></div>';
    document.body.appendChild(box);
    $('trRcvNo').onclick = function () { box.remove(); };
    $('trRcvOk').onclick = function () {
      var by = $('trRcvBy').value.trim(), dt = $('trRcvDate').value;
      if (!by || !dt) return alert('Please enter who received the stock and the date.');
      var cur = mv(), r = cur[i]; if (!r || statusOf(r) !== 'In Transit') { box.remove(); return; }
      var q = num(r.quantity), dest = w.getInventory(r.to) || [], hit = dest.filter(function (x) { return same(x, r); })[0];
      if (hit) hit.qty = num(hit.qty) + q;
      else { var src = (w.getInventory(r.from) || []).filter(function (x) { return same(x, r); })[0] || templateFor(r.sku || r.item) || { name: r.item, sku: r.sku || '' }; dest.push(clean(src, q)); }
      w.saveInventory(r.to, dest);
      r.status = 'Received'; r.receivedBy = by; r.receivedDate = dt; setMv(cur);
      box.remove(); refresh();
    };
  };
  w.trCancelTransit = function (i) {
    var list = mv(), m = list[i]; if (!m || statusOf(m) !== 'In Transit') return;
    if (!confirm('Cancel this transit? ' + m.quantity + ' x ' + m.item + ' goes back to ' + m.from + '.')) return;
    var q = num(m.quantity), src = w.getInventory(m.from) || [], hit = src.filter(function (x) { return same(x, m); })[0];
    if (hit) hit.qty = num(hit.qty) + q; else src.push(clean(templateFor(m.sku || m.item) || { name: m.item, sku: m.sku || '' }, q));
    w.saveInventory(m.from, src);
    m.status = 'Cancelled'; m.cancelledDate = today(); m.cancelledBy = who(); setMv(list); refresh();
  };
  var origDelete = w.deleteMovement;
  w.deleteMovement = function (i) {
    var m = mv()[i]; if (m && statusOf(m) === 'In Transit') return alert('Receive or cancel this transit before deleting it.');
    return typeof origDelete === 'function' ? origDelete.apply(this, arguments) : undefined;
  };

  /* ---------- transit table ---------- */
  var BADGE = { 'In Transit': 'bg-yellow-100 text-yellow-800', 'Received': 'bg-green-100 text-green-800', 'Cancelled': 'bg-gray-200 text-gray-700' };
  function shown() {
    var q = low(($('movementSearch') || {}).value), st = ($('trStatus') || {}).value, out = [];
    mv().forEach(function (m, i) {
      if (!m) return; var s = statusOf(m); if (st && s !== st) return;
      var no = m.transitNo || ('TRN-' + pad(i + 1, 4));
      if (q && [no, m.item, m.sku, m.from, m.to, m.dispatchedBy, m.receivedBy, m.date, s].join(' ').toLowerCase().indexOf(q) < 0) return;
      out.push({ m: m, i: i, no: no, s: s });
    });
    return out.reverse();
  }
  /* ---------- row actions: Edit, Delete, Preview, Email, More (Download, Print) ---------- */
  var AB = 'px-2 py-1 rounded text-sm text-white mr-1 ';
  function actions(r) {
    var i = r.i;
    return '<button class="' + AB + 'bg-blue-900 hover:bg-blue-800" onclick="trEdit(' + i + ')">Edit</button>' +
      '<button class="' + AB + 'bg-red-700 hover:bg-red-600" onclick="deleteMovement(' + i + ')">Delete</button>' +
      '<button class="' + AB + 'bg-gray-600 hover:bg-gray-500" onclick="trPreview(' + i + ')">Preview</button>' +
      '<button class="' + AB + 'bg-gray-600 hover:bg-gray-500" onclick="trEmail(' + i + ')">Email</button>' +
      '<button class="px-2 py-1 rounded text-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50" onclick="trMore(' + i + ', this, event)">More &#9662;</button>';
  }
  function rec(i) {
    var m = mv()[i]; if (!m) return null;
    return { m: m, no: m.transitNo || ('TRN-' + pad(i + 1, 4)), s: statusOf(m) };
  }
  function org() { try { return (JSON.parse(localStorage.getItem('orgInfo') || '{}') || {}).name || ''; } catch (e) { return ''; } }
  function docRows(r) {
    var m = r.m;
    return [['Transit No.', r.no], ['Status', r.s], ['Date', m.date], ['Item', m.item], ['SKU', m.sku || ''], ['From warehouse', m.from], ['To warehouse', m.to], ['Quantity', m.quantity],
      ['Dispatched by', m.dispatchedBy || ''], ['Received by', m.receivedBy || ''], ['Date received', m.receivedDate || ''], ['Reference', m.reference || ''], ['Notes', m.reason || '']];
  }
  function docHtml(r) {
    var rows = docRows(r).filter(function (x) { return x[1] !== '' && x[1] != null; }).map(function (x) {
      return '<tr><th style="text-align:left;background:#f3f4f6;border:1px solid #ccc;padding:8px;width:35%">' + esc(x[0]) + '</th><td style="border:1px solid #ccc;padding:8px">' + esc(x[1]) + '</td></tr>';
    }).join('');
    return '<div style="font-family:Arial,sans-serif;color:#333;padding:20px"><h2 style="color:#1e3a8a;margin:0 0 4px">Transit ' + esc(r.no) + '</h2>' +
      (org() ? '<div style="color:#666;margin-bottom:12px">' + esc(org()) + '</div>' : '') +
      '<table style="width:100%;border-collapse:collapse">' + rows + '</table>' +
      '<div style="margin-top:24px;font-size:12px;color:gray">Generated on ' + esc(new Date().toLocaleString()) + '</div></div>';
  }
  function closeMenu() { var o = $('trMoreMenu'); if (o) o.remove(); }
  document.addEventListener('click', closeMenu);

  w.trEdit = function (i) {
    var r = rec(i); if (!r) return;
    if (r.s !== 'In Transit') return alert('Only a transit that is still In Transit can be edited.');
    w.__trEdit = i;
    w.trToggleForm(true);
    $('actType').value = 'transfer'; $('actType').disabled = true; w.trActChange();
    $('fromLocation').value = r.m.from; w.populateMovementItems();
    $('toLocation').value = r.m.to;
    var sel = $('transferItem'), key = r.m.sku || r.m.item;
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === key; })) { var o = document.createElement('option'); o.value = key; o.textContent = r.m.item + ' (' + (r.m.sku || 'No SKU') + ')'; sel.appendChild(o); }
    sel.value = key;
    $('transferQuantity').value = r.m.quantity; $('transferDate').value = r.m.date || today();
    $('actRef').value = r.m.reference || ''; $('actNotes').value = r.m.reason || '';
    $('trSave').textContent = 'Update Transit';
    var f = $('trForm'); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  w.trPreview = function (i) {
    var r = rec(i); if (!r) return;
    var old = $('trPrev'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'trPrev';
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px';
    box.innerHTML = '<div class="bg-white rounded shadow-lg w-full" style="max-width:560px;max-height:90vh;overflow:auto">' + docHtml(r) +
      '<div class="text-right space-x-2 border-t p-3"><button id="trPvEmail" class="' + BTN + '">Email</button><button id="trPvDl" class="' + BTN + '">Download</button><button id="trPvPrint" class="' + BTN + '">Print</button><button id="trPvClose" class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600">Close</button></div></div>';
    document.body.appendChild(box);
    $('trPvClose').onclick = function () { box.remove(); };
    $('trPvPrint').onclick = function () { w.trPrint(i); };
    $('trPvDl').onclick = function () { w.trDownload(i); };
    $('trPvEmail').onclick = function () { w.trEmail(i); };
    box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
  };

  w.trEmail = function (i) {
    var r = rec(i); if (!r) return; var m = r.m;
    var subject = 'Transit ' + r.no + (org() ? ' - ' + org() : '');
    var body = 'Hello,\n\nTransit details:\n\n' + docRows(r).filter(function (x) { return x[1] !== '' && x[1] != null; }).map(function (x) { return x[0] + ': ' + x[1]; }).join('\n') + '\n\n' + org();
    var url = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    try { if (typeof w.__logMail === 'function') url = w.__logMail(url); } catch (e) {}
    w.location.href = url;
  };

  w.trPrint = function (i) {
    var r = rec(i); if (!r) return;
    var pw = window.open('', '', 'width=900,height=700'); if (!pw) return alert('Allow pop-ups to print.');
    pw.document.write('<html><head><title>Transit ' + esc(r.no) + '</title></head><body>' + docHtml(r) + '</body></html>');
    pw.document.close(); pw.focus(); setTimeout(function () { pw.print(); }, 300);
  };

  function withPdfLib(cb) {
    if (w.html2pdf) return cb(true);
    var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.onload = function () { cb(!!w.html2pdf); }; s.onerror = function () { cb(false); }; document.head.appendChild(s);
  }
  w.trDownload = function (i) {
    var r = rec(i); if (!r) return;
    withPdfLib(function (ok) {
      if (!ok) return w.trPrint(i);                                    /* offline: the print window can save as PDF */
      var holder = document.createElement('div'); holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px;background:#fff'; holder.innerHTML = docHtml(r); document.body.appendChild(holder);
      w.html2pdf().set({ margin: 0.5, filename: r.no + '.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' } }).from(holder).save()
        .then(function () { holder.remove(); }, function () { holder.remove(); });
    });
  };

  w.trMore = function (i, btn, ev) {
    if (ev) ev.stopPropagation();
    var had = $('trMoreMenu'); closeMenu(); if (had && had.getAttribute('data-i') === String(i)) return;
    var r = rec(i); if (!r) return;
    var menu = document.createElement('div'); menu.id = 'trMoreMenu'; menu.setAttribute('data-i', i);
    var rc = btn.getBoundingClientRect();
    menu.style.cssText = 'position:fixed;z-index:100001;min-width:170px;background:#fff;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.25);border:1px solid #e5e7eb;top:' + Math.min(rc.bottom + 4, window.innerHeight - 190) + 'px;left:' + Math.max(8, rc.right - 170) + 'px';
    var item = function (label, fn) { return '<button class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" data-fn="' + fn + '">' + label + '</button>'; };
    menu.innerHTML = item('Download', 'trDownload') + item('Print', 'trPrint') +
      (r.s === 'In Transit' ? '<div style="border-top:1px solid #e5e7eb"></div>' + item('Receive', 'trReceive') + item('Cancel transit', 'trCancelTransit') : '');
    menu.addEventListener('click', function (e) { var b = e.target.closest('button[data-fn]'); if (!b) return; e.stopPropagation(); closeMenu(); w[b.getAttribute('data-fn')](i); });
    document.body.appendChild(menu);
  };

  w.renderMovementTable = function () {
    var body = $('movementTableBody'); if (!body) return;
    var rows = shown(), all = mv(), transitUnits = 0, transitCount = 0;
    all.forEach(function (m) { if (m && statusOf(m) === 'In Transit') { transitCount++; transitUnits += num(m.quantity); } });
    if ($('trSummary')) $('trSummary').innerHTML = 'In transit now: <b>' + transitCount + '</b> transfer(s), <b>' + transitUnits + '</b> unit(s) &nbsp;|&nbsp; Total transfers: <b>' + all.length + '</b>';
    body.innerHTML = rows.length ? rows.map(function (r) {
      var m = r.m, td = 'border p-2';
      return '<tr><td class="' + td + '">' + esc(r.no) + '</td><td class="' + td + '">' + esc(m.date) + '</td><td class="' + td + '">' + esc(m.item) + '</td><td class="' + td + '">' + esc(m.sku || '') + '</td>' +
        '<td class="' + td + '">' + esc(m.from) + '</td><td class="' + td + '">' + esc(m.to) + '</td><td class="' + td + '">' + esc(m.quantity) + '</td>' +
        '<td class="' + td + '">' + esc(m.dispatchedBy || '') + '</td><td class="' + td + '">' + esc(m.receivedBy || '') + '</td>' +
        '<td class="' + td + '"><span class="px-2 py-0.5 rounded text-xs ' + BADGE[r.s] + '">' + r.s + '</span></td>' +
        '<td class="' + td + ' text-center whitespace-nowrap">' + actions(r) + '</td></tr>';
    }).join('') : '<tr><td colspan="11" class="text-center p-4 text-gray-500">No transits recorded.</td></tr>';
    if ($('totalCount')) $('totalCount').textContent = rows.length;
  };

  w.searchMovement = function () { w.renderMovementTable(); };
  w.renderFilteredMovementTable = function () { w.renderMovementTable(); };
  w.showMovementTab = function () { w.populateMovementWarehouses(); w.populateMovementItems(); w.renderMovementTable(); };
  w.trExport = function () {
    var rows = [['Transit No.', 'Date', 'Item', 'SKU', 'From', 'To', 'Quantity', 'Dispatched By', 'Received By', 'Date Received', 'Status', 'Reference', 'Notes']].concat(shown().map(function (r) { var m = r.m; return [r.no, m.date, m.item, m.sku || '', m.from, m.to, m.quantity, m.dispatchedBy || '', m.receivedBy || '', m.receivedDate || '', r.s, m.reference || '', m.reason || '']; }));
    var t = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'stock-transit.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------- mount ---------- */
  function mount() {
    var tab = $('movementTab'); if (!tab) return false;
    if (!tab.getAttribute('data-transit')) {              /* normally the page is already in index.html; this only runs if it is not */
      tab.setAttribute('data-transit', '1'); tab.innerHTML = tabHtml();
      var dd = $('movementExpertBtn'); if (dd) dd.addEventListener('click', function () { $('movementDropdown').classList.toggle('hidden'); });
    }
    var btn = document.querySelector('button[onclick*="movementTab"]');
    if (btn && btn.textContent.trim() !== 'Transits') btn.textContent = 'Transits';
    return true;
  }
  var tries = 0; (function go() { if (!mount() && tries++ < 40) setTimeout(go, 500); })();
  setTimeout(function () { mount(); }, 1500);   /* the language pass can reset the menu label - set it again */
})(window);

/* ----- ASSESSMENT (STOCK TAKE) ----- */
/* Acacia Books - Inventory > Assessment (Stock Take)
 * Two screens inside the Assessment page:
 *   1. Stock Take Register  - one row per counting session, summary cards, New Stock Take form.
 *   2. Working Sheet        - item-by-item count: system qty, physical qty, variance, value, reason.
 * Workflow: Draft -> Counting -> Submitted -> Approved -> Posted.
 * Inventory balances change ONLY when a count is Posted OR its variance is applied in Inventory > Bulk Adjustment.
 * Posting writes one Adjustment per variance line to "stockActivities", so it shows in Reports > Inventory
 * Reports > Stock History.
 * CSV: Export Stock Sheet (from the Stock module, physical + variance blank) -> count -> Import Count (CSV)
 * fills the physical quantities, the system works out the variance and opens the Variance Report.
 * Bulk Adjustment then shows the variance for the chosen warehouse with the adjustment quantity pre-filled.
 * Data: localStorage "stockTakes". */
(function (w) {
  'use strict';
  var KEY = 'stockTakes', TAB = 'assessmentTab', RPT = 'stockAssessmentReportPanel';
  /* The same screens draw in Inventory > Assessment AND in Reports > Inventory Reports > Stock Assessment.
   * Only one is drawn at a time (the other is emptied) so the field ids never repeat. */
  function rootEl() {
    var r = $(RPT), t = $(TAB), useRpt = !!(r && r.offsetParent !== null);
    var on = useRpt ? r : t, off = useRpt ? t : r;
    if (off && off.innerHTML) off.innerHTML = '';
    return on;
  }
  var $ = function (id) { return document.getElementById(id); };
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n, l) { return String(n).padStart(l, '0'); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var fmtDate = function (d) { var m = String(d || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (d || ''); };
  var rd = function (k) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  var takes = function () { return rd(KEY); };
  var setTakes = function (a) { localStorage.setItem(KEY, JSON.stringify(a)); };
  function who() { try { var u = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {}; return u.name || u.fullName || u.username || u.email || ''; } catch (e) { return ''; } }
  function role() { try { return String((JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {}).role || '').toLowerCase(); } catch (e) { return ''; } }
  function canApprove() { var r = role(); return !r || r === 'admin' || r === 'account' || r === 'accounts'; }
  function money(v) { try { if (typeof w.formatCurrency === 'function') return w.formatCurrency(v); } catch (e) {} return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function signed(n) { return n > 0 ? '+' + n : String(n); }
  function r4(n) { return Math.round(n * 10000) / 10000; }

  var BTN = 'bg-blue-900 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-800';
  var BTN2 = 'bg-gray-600 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-500';
  var INP = 'border p-2 rounded w-full text-sm';
  var BADGE = { Draft: 'bg-gray-200 text-gray-700', Counting: 'bg-yellow-100 text-yellow-800', Submitted: 'bg-blue-100 text-blue-800', Approved: 'bg-green-100 text-green-800', Posted: 'bg-green-700 text-white' };
  var REASONS = ['Miscount', 'Damaged', 'Expired', 'Theft / loss', 'Received, not recorded', 'Issued, not recorded', 'Wrong location', 'Other'];
  var state = { view: 'register', id: null, t: null };
  var stSel = {};
  var saveTimer = null;

  /* ---------- helpers ---------- */
  function warehouses() { try { return (JSON.parse(localStorage.getItem('warehouses') || '[]') || []).map(function (x) { return x && x.name; }).filter(Boolean); } catch (e) { return []; } }
  function invOf(wh) { try { return (w.getInventory(wh) || []).filter(function (x) { return x && x.name; }); } catch (e) { return []; } }
  function catOf(it) { return it.category || it.categoryName || ''; }
  function costOf(it) { return num(it.costPrice != null ? it.costPrice : it.buyPrice != null ? it.buyPrice : it.unitCost != null ? it.unitCost : it.purchasePrice != null ? it.purchasePrice : it.cost); }
  function nextNo(list, prefix, field, len) {
    var max = list.length;
    list.forEach(function (r) { var d = parseInt(String(r && r[field] || '').replace(/\D/g, ''), 10); if (d > max) max = d; });
    return prefix + pad(max + 1, len);
  }
  function byId(id) {                                   /* the open sheet lives in memory so quick edits never overwrite each other */
    if (state.t && state.t.id === id) return state.t;
    return takes().filter(function (t) { return t.id === id; })[0];
  }
  function put(t) { var a = takes(), i = a.findIndex(function (x) { return x.id === t.id; }); if (i < 0) a.push(t); else a[i] = t; setTakes(a); if (state.t && state.t.id === t.id) state.t = t; }
  function calc(l) {
    var counted = l.physicalQty !== null && l.physicalQty !== '' && l.physicalQty !== undefined;
    var p = counted ? num(l.physicalQty) : null, v = counted ? r4(p - num(l.systemQty)) : null;
    return { counted: counted, p: p, v: v, val: counted ? r4(v * num(l.unitCost)) : null };
  }
  function totals(t) {
    var s = 0, p = 0, n = 0, val = 0, c = 0, diffLines = 0;
    t.lines.forEach(function (l) {
      s += num(l.systemQty); var k = calc(l);
      if (k.counted) { c++; p += k.p; n += k.v; val += k.val; if (k.v !== 0) diffLines++; }
    });
    return { sys: r4(s), phys: r4(p), net: r4(n), val: r4(val), counted: c, total: t.lines.length, diffLines: diffLines };
  }
  function blindNow(t) { return !!t.blind && (t.status === 'Draft' || t.status === 'Counting'); }
  function editable(t) { return t.status === 'Counting'; }

  /* ---------- register ---------- */
  function renderRegister() {
    var root = rootEl(); if (!root) return;
    try { topUpAll(); } catch (e) { console.warn('[stock take top-up]', e); }
    var all = takes(), q = low(($('stSearch') || {}).value), st = ($('stStatus') || {}).value || '';
    var cards = { total: all.length, pend: 0, done: 0, diff: 0 };
    all.forEach(function (t) { var k = totals(t); if (t.status === 'Submitted') cards.pend++; if (t.status === 'Posted') cards.done++; if (k.diffLines > 0) cards.diff++; });
    var rows = all.slice().reverse().filter(function (t) {
      if (st && t.status !== st) return false;
      return !q || [t.no, t.warehouse, t.status, t.date, t.assignedTo, t.category].join(' ').toLowerCase().indexOf(q) > -1;
    });
    var card = function (label, n, cls) { return '<div class="bg-white rounded shadow p-4"><div class="text-xs text-gray-500">' + label + '</div><div class="text-2xl font-bold ' + (cls || 'text-blue-900') + '">' + n + '</div></div>'; };
    var td = 'border p-2';
    var body = rows.length ? rows.map(function (t) {
      var k = totals(t), anyCount = k.counted > 0;
      return '<tr class="hover:bg-gray-50"><td class="' + td + ' text-center"><input type="checkbox" class="st-chk" data-id="' + esc(t.id) + '"' + (stSel[t.id] ? ' checked' : '') + ' onchange="stPick(\'' + esc(t.id) + '\',this.checked)"></td><td class="' + td + ' font-semibold">' + esc(t.no) + '</td><td class="' + td + '">' + esc(fmtDate(t.date)) + '</td><td class="' + td + '">' + esc(t.warehouse) + (t.category ? ' <span class="text-xs text-gray-500">(' + esc(t.category) + ')</span>' : '') + '</td>' +
        '<td class="' + td + ' text-right">' + k.total + '</td><td class="' + td + ' text-right">' + (anyCount ? (k.diffLines ? '<span class="text-red-600 font-semibold">' + k.diffLines + '</span>' : '0') : '-') + '</td>' +
        '<td class="' + td + '"><span class="px-2 py-0.5 rounded text-xs ' + BADGE[t.status] + '">' + esc(t.status) + '</span>' + (readyForBulk(t) ? ' <span class="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800" title="Variance report is ready - apply it in Inventory > Bulk Adjustment">Variance ready</span>' : '') + '</td>' +
        '<td class="' + td + ' text-center whitespace-nowrap"><button class="' + BTN.replace('px-3 py-1.5', 'px-2 py-1') + ' mr-1" onclick="stOpen(\'' + esc(t.id) + '\')">Open</button>' +
        '<button class="' + BTN2.replace('px-3 py-1.5', 'px-2 py-1') + ' mr-1" onclick="stEdit(\'' + esc(t.id) + '\')">Edit</button>' +
        '<button class="bg-red-700 text-white px-2 py-1 rounded text-sm hover:bg-red-600" onclick="stDelete(\'' + esc(t.id) + '\')">Delete</button></td></tr>';
    }).join('') : '<tr><td colspan="8" class="text-center p-4 text-gray-500">No stock takes found.</td></tr>';
    var keepForm = $('stForm') && !$('stForm').classList.contains('hidden');
    try { ingestMobile(true); } catch (e) { console.warn('[mobile counts]', e); }
    root.innerHTML = mobileBanner() +
      '<div class="flex flex-col md:flex-row md:items-end justify-between gap-2 mb-3"><div><h2 class="text-sm font-bold">Stock Take Register</h2><div class="text-xs text-gray-500">Inventory Control</div></div>' +
      '<div class="flex flex-wrap items-center gap-2"><input id="stSearch" placeholder="Search count no., warehouse, status" class="border rounded-md px-3 py-1.5 text-sm w-64" value="' + esc(($('stSearch') || {}).value || '') + '" oninput="stRenderRegister()">' +
      '<select id="stStatus" class="border rounded-md px-2 py-1.5 text-sm" onchange="stRenderRegister()"><option value="">All statuses</option>' + ['Draft', 'Counting', 'Submitted', 'Approved', 'Posted'].map(function (s) { return '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<button class="' + BTN2 + '" onclick="stExportStock()">Export Stock Sheet (CSV)</button><button class="' + BTN2 + '" onclick="stImportAny()">Import Count (CSV)</button>' +
      '<button id="stBulkDel" class="bg-red-700 text-white px-3 py-1.5 rounded text-sm hover:bg-red-600 font-semibold hidden" onclick="stDeleteSelected()">Delete Selected</button> <button class="' + BTN + ' font-semibold" onclick="stToggleForm()">New Stock Take</button></div></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + card('Total Stock Takes', cards.total) + card('Pending Approval', cards.pend, 'text-yellow-700') + card('Completed', cards.done, 'text-green-700') + card('With Variances', cards.diff, 'text-red-600') + '</div>' +
      formHtml(keepForm) +
      '<div class="bg-white p-4 rounded shadow mb-6"><div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr><th class="border p-2 text-center"><input type="checkbox" id="stChkAll" title="Select all shown" onchange="stPickAll(this.checked)"></th>' +
      ['Count No.', 'Date', 'Warehouse', 'Items', 'Variance', 'Status'].map(function (h, i) { return '<th class="border p-2 text-' + (i === 3 || i === 4 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') + '<th class="border p-2 text-center">Actions</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="text-xs text-gray-500 mt-2">Variance = number of items whose physical count differs from the system quantity.</div></div>';
    if (keepForm) wireForm();
    stSync();
  }
  /* bulk selection (ids survive search / filter changes) */
  function stSync() {
    var have = {}; takes().forEach(function (t) { have[t.id] = 1; });
    Object.keys(stSel).forEach(function (k) { if (!have[k]) delete stSel[k]; });
    var n = Object.keys(stSel).length, b = $('stBulkDel'), boxes = document.querySelectorAll('.st-chk'), all = $('stChkAll');
    if (b) { b.classList.toggle('hidden', n === 0); b.textContent = 'Delete Selected (' + n + ')'; }
    if (all) { var c = 0; boxes.forEach(function (x) { if (x.checked) c++; }); all.checked = boxes.length > 0 && c === boxes.length; all.indeterminate = c > 0 && c < boxes.length; }
  }
  w.stPick = function (id, on) { if (on) stSel[id] = 1; else delete stSel[id]; stSync(); };
  w.stPickAll = function (on) {
    document.querySelectorAll('.st-chk').forEach(function (x) { x.checked = on; var id = x.getAttribute('data-id'); if (on) stSel[id] = 1; else delete stSel[id]; });
    stSync();
  };
  w.stDeleteSelected = function () {
    var ids = Object.keys(stSel), list = takes().filter(function (t) { return ids.indexOf(t.id) > -1; });
    if (!list.length) { stSync(); return; }
    var posted = list.filter(function (t) { return t.status === 'Posted'; }).length;
    var msg = 'Delete ' + list.length + ' stock take' + (list.length === 1 ? '' : 's') + '?\n\n' + list.slice(0, 12).map(function (t) { return t.no + ' (' + t.status + ')'; }).join('\n') + (list.length > 12 ? '\n...and ' + (list.length - 12) + ' more' : '') +
      (posted ? '\n\n' + posted + ' of them ' + (posted === 1 ? 'is' : 'are') + ' POSTED: stock adjustments already made are NOT reversed and stay in Stock History. Only the register records are removed.' : '\n\nInventory is not affected.');
    if (!confirm(msg)) return;
    setTakes(takes().filter(function (t) { return ids.indexOf(t.id) < 0; }));
    if (state.id && ids.indexOf(state.id) > -1) state = { view: 'register', id: null, t: null };
    stSel = {}; render();
  };
  w.stRenderRegister = function () {
    var s = $('stSearch'), pos = s ? s.selectionStart : 0, had = s && document.activeElement === s;
    renderRegister();
    if (had) { var n = $('stSearch'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
  };

  function formHtml(open) {
    var whs = warehouses(), a = takes();
    return '<div id="stForm" class="bg-white p-6 rounded shadow space-y-4 mb-6' + (open ? '' : ' hidden') + '"><h3 class="text-sm font-bold text-gray-700 border-b pb-2">New Stock Take</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
      '<div><label class="block text-sm font-semibold mb-1">Stock Take No.</label><input id="stNo" class="' + INP + ' bg-gray-100" readonly value="' + esc(nextNo(a, 'ST-', 'no', 3)) + '"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Count Date <span class="text-red-500">*</span></label><input id="stDate" type="date" class="' + INP + '" value="' + today() + '"></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Warehouse <span class="text-red-500">*</span></label><select id="stWh" class="' + INP + '"><option value="">Select Warehouse</option>' + whs.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Category <span class="text-xs font-normal text-gray-500">(optional)</span></label><select id="stCat" class="' + INP + '"><option value="">All categories</option></select></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Count Method</label><select id="stMethod" class="' + INP + '"><option>Full Count</option><option>Cycle Count</option></select></div>' +
      '<div><label class="block text-sm font-semibold mb-1">Assigned To</label><input id="stAssign" class="' + INP + '" placeholder="Person performing the count" value="' + esc(who()) + '"></div>' +
      '</div>' +
      '<div><label class="block text-sm font-semibold mb-1">Notes</label><textarea id="stNotes" rows="2" class="' + INP + ' resize-y" placeholder="Additional information"></textarea></div>' +
      '<label class="flex items-center gap-2 text-sm"><input id="stBlind" type="checkbox"> Blind count <span class="text-xs text-gray-500">(hide system quantities from the counter until the count is submitted)</span></label>' +
      '<div class="text-right space-x-2 border-t pt-4"><button class="' + BTN + ' font-semibold" onclick="stCreate()">Save &amp; Load Items</button> <button class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600" onclick="stToggleForm(false)">Cancel</button></div></div>';
  }
  function wireForm() {
    var wh = $('stWh'); if (!wh) return;
    wh.onchange = function () {
      var cats = {}; invOf(wh.value).forEach(function (it) { var c = catOf(it); if (c) cats[c] = 1; });
      $('stCat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    };
  }
  w.stToggleForm = function (show) {
    if (!$('stForm')) { state = { view: 'register', id: null, t: null }; renderRegister(); }
    var f = $('stForm'); if (!f) return;
    var open = typeof show === 'boolean' ? show : f.classList.contains('hidden');
    if (open) { renderRegister(); f = $('stForm'); f.classList.remove('hidden'); wireForm(); f.scrollIntoView && f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else f.classList.add('hidden');
  };

  w.stCreate = function () {
    var date = $('stDate').value, wh = $('stWh').value, cat = $('stCat').value, method = $('stMethod').value;
    if (!date || !wh) return alert('Please choose the count date and the warehouse.');
    var open = takes().filter(function (t) { return t.warehouse === wh && t.status !== 'Posted' && (!t.category || !cat || t.category === cat); })[0];
    if (open) return alert('Stock take ' + open.no + ' for this warehouse' + (open.category ? ' / ' + open.category : '') + ' is still open (' + open.status + '). Post or delete it before starting another count of the same stock.');
    var seen = {}, lines = [];
    invOf(wh).forEach(function (it) {
      if (cat && catOf(it) !== cat) return;
      var key = low(it.name) + '|' + low(it.sku || ''); if (seen[key]) return; seen[key] = 1;           /* one line per item: no duplicate counting */
      lines.push({ key: key, itemId: it.id != null ? String(it.id) : '', name: it.name, sku: it.sku || '', barcode: it.barcode || '', category: catOf(it), warehouse: wh, systemQty: num(it.qty), unitCost: costOf(it), physicalQty: null, reason: '', remarks: '', countedBy: '', countedAt: '' });
    });
    if (!lines.length) return alert('No items were found in this warehouse' + (cat ? ' and category' : '') + ' to count.');
    var a = takes(), t = {
      id: 'STK' + Date.now(), no: nextNo(a, 'ST-', 'no', 3), date: date, warehouse: wh, category: cat, method: method, assignedTo: $('stAssign').value.trim(), notes: $('stNotes').value.trim(),
      blind: $('stBlind').checked, status: 'Draft', createdBy: who(), createdAt: new Date().toISOString(), countedBy: '', submittedBy: '', approvedBy: '', postedBy: '', lines: lines
    };
    a.push(t); setTakes(a);
    state = { view: 'sheet', id: t.id, t: null }; render();
  };
  /* An open stock take is a snapshot of the warehouse taken when it was created. Items imported / added afterwards were missing
   * from it (so Stock Take, Export and the Stock Count phone app showed only the old items). Open Full Count takes
   * (Draft / Counting) are topped up here with any warehouse item that is not on the sheet yet. Counted lines are untouched. */
  /* ---- keep an open count in step with Inventory ----
   * Root cause of "stock take not synchronising with Inventory": every line stored System Qty ONCE, when the count was created,
   * and topUp() only ever added missing items. Sales, bills, transfers, imports and other adjustments made afterwards changed
   * Inventory but never the count, so System Qty / Variance (and the Bulk Adjustment quantity) were worked out against old numbers.
   * Open counts (Draft / Counting) now re-read System Qty, unit cost and item identity from Inventory every time they are opened,
   * exported, submitted or when the cloud brings new stock in. A renamed / re-SKU'd item is matched by SKU / barcode / name and
   * its line is updated, instead of adding a duplicate line next to an orphan. */
  function invIndex(wh) {
    var ix = { byId: {}, byKey: {}, bySku: {}, byBc: {}, byName: {} };
    invOf(wh).forEach(function (it) {
      if (it.id != null && it.id !== '' && !ix.byId[String(it.id)]) ix.byId[String(it.id)] = it;     /* stable item id (acacia-stock-repair.js): survives rename / SKU change */
      var k = low(it.name) + '|' + low(it.sku || ''); if (!ix.byKey[k]) ix.byKey[k] = it;
      if (it.sku) { var s = low(it.sku); (ix.bySku[s] = ix.bySku[s] || []).push(it); }
      if (it.barcode) { var b = low(it.barcode); (ix.byBc[b] = ix.byBc[b] || []).push(it); }
      var n = low(it.name); (ix.byName[n] = ix.byName[n] || []).push(it);
    });
    return ix;
  }
  function findInv(ix, l) {
    if (l.itemId && ix.byId[l.itemId]) return ix.byId[l.itemId];
    if (l.key && ix.byKey[l.key]) return ix.byKey[l.key];
    var k2 = low(l.name) + '|' + low(l.sku || ''); if (ix.byKey[k2]) return ix.byKey[k2];
    var a = l.sku ? ix.bySku[low(l.sku)] : null; if (a && a.length === 1) return a[0];
    a = l.barcode ? ix.byBc[low(l.barcode)] : null; if (a && a.length === 1) return a[0];
    a = ix.byName[low(l.name)]; if (a && a.length === 1) return a[0];
    return null;
  }
  /* returns the number of lines changed */
  function refreshQty(t) {
    if (!t || (t.status !== 'Draft' && t.status !== 'Counting')) return 0;
    var ix = invIndex(t.warehouse), changed = 0;
    (t.lines || []).forEach(function (l) {
      var it = findInv(ix, l); if (!it) return;
      var q = num(it.qty), c = costOf(it), key = low(it.name) + '|' + low(it.sku || ''), hit = false;
      if (num(l.systemQty) !== q) { l.systemQty = q; hit = true; }
      if (c && num(l.unitCost) !== c) { l.unitCost = c; hit = true; }
      if (it.id != null && it.id !== '' && l.itemId !== String(it.id)) { l.itemId = String(it.id); hit = true; }
      if (l.key !== key || l.name !== it.name || (l.sku || '') !== (it.sku || '') || (l.barcode || '') !== (it.barcode || '')) {
        l.key = key; l.name = it.name; l.sku = it.sku || ''; l.barcode = it.barcode || ''; l.category = catOf(it); hit = true;
      }
      if (hit) changed++;
    });
    if (changed) t.qtyRefreshedAt = new Date().toISOString();
    return changed;
  }
  function addMissing(t) {
    if (!t || t.method === 'Cycle Count') return 0;
    var have = {}; (t.lines || []).forEach(function (l) { have[l.key || (low(l.name) + '|' + low(l.sku || ''))] = 1; });
    var add = 0; t.lines = t.lines || [];
    invOf(t.warehouse).forEach(function (it) {
      if (t.category && catOf(it) !== t.category) return;
      var key = low(it.name) + '|' + low(it.sku || ''); if (have[key]) return; have[key] = 1;
      t.lines.push({ key: key, itemId: it.id != null ? String(it.id) : '', name: it.name, sku: it.sku || '', barcode: it.barcode || '', category: catOf(it), warehouse: t.warehouse, systemQty: num(it.qty), unitCost: costOf(it), physicalQty: null, reason: '', remarks: '', countedBy: '', countedAt: '' });
      add++;
    });
    return add;
  }
  function topUp(t) {
    if (!t || (t.status !== 'Draft' && t.status !== 'Counting')) return 0;
    var editing = state.view === 'sheet' && state.t && state.t.id === t.id;        /* never move numbers under a sheet that is being typed in */
    return (editing ? 0 : refreshQty(t)) + addMissing(t);
  }
  function topUpAll() {
    var a = allTakes(), n = 0; a.forEach(function (t) { n += topUp(t); });      /* allTakes() uses the open sheet's in-memory copy, so unsaved counts are kept */
    if (n) setTakes(a); return n;
  }
  /* explicit button: "Refresh System Qty" on an open count */
  w.stRefreshQty = function (id) {
    var t = byId(id); if (!t) return;
    var n = refreshQty(t), add = addMissing(t);
    put(t); renderSheet();
    try { if (typeof w.showNotification === 'function') w.showNotification(n || add ? 'System quantities refreshed from Inventory (' + n + ' line(s) updated' + (add ? ', ' + add + ' new item(s) added' : '') + ').' : 'System quantities already match Inventory.', 'success'); } catch (e) {}
  };
  w.stTopUp = topUpAll;
  w.stDelete = function (id) {
    var t = byId(id); if (!t) return;
    var msg = t.status === 'Posted'
      ? 'Delete stock take ' + t.no + '? It is already POSTED: the stock adjustments made from it are NOT reversed and stay in Stock History. Only this register record is removed.'
      : 'Delete stock take ' + t.no + ' (' + t.status + ')? Inventory is not affected.';
    if (!confirm(msg)) return;
    setTakes(takes().filter(function (x) { return x.id !== id; }));
    if (state.id === id) state = { view: 'register', id: null, t: null };
    render();
  };
  /* Edit: change the details of a count. Warehouse / category stay fixed because the item list was loaded from them.
   * Draft / Counting: all details. Submitted / Approved: goes back to Counting (nothing is posted yet).
   * Posted: only Assigned To + Notes, because stock has already been adjusted. */
  w.stEdit = function (id) {
    var t = byId(id); if (!t) return;
    var posted = t.status === 'Posted', back = t.status === 'Submitted' || t.status === 'Approved';
    if (back && !confirm('Edit ' + t.no + '? It goes back to Counting and its ' + t.status.toLowerCase() + ' sign-off is cleared. Submit it again after your changes.')) return;
    var old = $('stEditModal'); if (old) old.remove();
    var o = document.createElement('div'); o.id = 'stEditModal';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px';
    var lab = function (l) { return '<label class="block text-sm font-semibold mb-1">' + l + '</label>'; };
    o.innerHTML = '<div style="background:#fff;border-radius:10px;max-width:460px;width:100%;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.3);max-height:92vh;overflow:auto">' +
      '<div style="font-weight:700;font-size:15px">Edit Stock Take ' + esc(t.no) + '</div>' +
      '<div style="font-size:12px;color:#6b7280;margin:4px 0 12px">' + esc(t.warehouse) + (t.category ? ' / ' + esc(t.category) : '') + (posted ? ' - posted: only Assigned To and Notes can change.' : ' - warehouse and category cannot change.') + '</div>' +
      (posted ? '' : lab('Count Date') + '<input id="stEdDate" type="date" class="' + INP + ' mb-3" value="' + esc(t.date || '') + '">') +
      (posted ? '' : lab('Count Method') + '<select id="stEdMethod" class="' + INP + ' mb-3"><option' + (t.method === 'Cycle Count' ? '' : ' selected') + '>Full Count</option><option' + (t.method === 'Cycle Count' ? ' selected' : '') + '>Cycle Count</option></select>') +
      lab('Assigned To') + '<input id="stEdAssign" class="' + INP + ' mb-3" value="' + esc(t.assignedTo || '') + '">' +
      lab('Notes') + '<textarea id="stEdNotes" rows="3" class="' + INP + ' mb-3 resize-y">' + esc(t.notes || '') + '</textarea>' +
      (posted ? '' : '<label class="flex items-center gap-2 text-sm mb-4"><input id="stEdBlind" type="checkbox"' + (t.blind ? ' checked' : '') + '> Blind count</label>') +
      '<div class="text-right space-x-2"><button class="' + BTN + ' font-semibold" id="stEdGo">Save Changes</button><button class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600" id="stEdX">Cancel</button></div></div>';
    document.body.appendChild(o);
    o.addEventListener('mousedown', function (e) { if (e.target === o) o.remove(); });
    $('stEdX').onclick = function () { o.remove(); };
    $('stEdGo').onclick = function () {
      var cur = byId(id); if (!cur) { o.remove(); return; }
      if (!posted) {
        var d = $('stEdDate').value; if (!d) return alert('Please choose the count date.');
        cur.date = d; cur.method = $('stEdMethod').value; cur.blind = $('stEdBlind').checked;
      }
      cur.assignedTo = $('stEdAssign').value.trim(); cur.notes = $('stEdNotes').value.trim();
      if (back) { cur.status = 'Counting'; cur.submittedBy = ''; cur.submittedAt = ''; cur.approvedBy = ''; cur.approvedAt = ''; }
      cur.editedBy = who(); cur.editedAt = new Date().toISOString();
      put(cur); o.remove(); render();
    };
  };
  w.stOpen = function (id) { try { topUpAll(); } catch (e) { console.warn('[stock take top-up]', e); } state = { view: 'sheet', id: id, t: null }; render(); };
  w.stBack = function () { if (state.t) { clearTimeout(saveTimer); put(state.t); } state = { view: 'register', id: null, t: null }; render(); };

  /* ---------- working sheet ---------- */
  function cols(t) {
    var blind = blindNow(t);
    return [
      { h: 'Item Name' }, { h: 'SKU' }, { h: 'Category' }, { h: 'Warehouse' },
      { h: 'System Qty', r: 1, sys: 1 }, { h: 'Physical Qty', r: 1 }, { h: 'Variance', r: 1, sys: 1 }, { h: 'Unit Cost', r: 1, sys: 1 }, { h: 'Variance Value', r: 1, sys: 1 },
      { h: 'Reason for Variance' }, { h: 'Remarks' }
    ].filter(function (c) { return !(blind && c.sys); });
  }
  function totalsHtml(t) {
    var k = totals(t), blind = blindNow(t), c = 'bg-white rounded shadow p-3';
    var cell = function (l, v, cls) { return '<div class="' + c + '"><div class="text-xs text-gray-500">' + l + '</div><div class="text-lg font-bold ' + (cls || 'text-blue-900') + '">' + v + '</div></div>'; };
    var vcls = k.net < 0 ? 'text-red-600' : k.net > 0 ? 'text-green-700' : 'text-blue-900';
    return (blind ? cell('System Total', 'Hidden (blind count)', 'text-gray-400 text-sm') : cell('System Total', k.sys)) + cell('Physical Total', k.phys) +
      (blind ? cell('Net Variance', 'Hidden (blind count)', 'text-gray-400 text-sm') : cell('Net Variance', signed(k.net), vcls) + cell('Variance Value', money(k.val), vcls)) + cell('Counted', k.counted + ' of ' + k.total);
  }
  function rowHtml(t, l, i) {
    var k = calc(l), blind = blindNow(t), ed = editable(t), td = 'border p-1 align-middle', tdr = td + ' text-right';
    var vcls = k.v == null ? '' : k.v < 0 ? 'text-red-600 font-semibold' : k.v > 0 ? 'text-green-700 font-semibold' : 'text-gray-700';
    var reason = ed ? '<select class="border rounded p-1 text-sm w-full" data-f="reason" data-i="' + i + '"><option value="">' + (k.v ? 'Select reason' : '-') + '</option>' + REASONS.map(function (r) { return '<option' + (l.reason === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select>' : esc(l.reason || '');
    var remarks = ed ? '<input class="border rounded p-1 text-sm w-full" data-f="remarks" data-i="' + i + '" value="' + esc(l.remarks || '') + '">' : esc(l.remarks || '');
    var phys = ed ? '<input type="number" min="0" step="any" class="border rounded p-1 text-sm w-24 text-right" data-f="physicalQty" data-i="' + i + '" value="' + (k.counted ? esc(l.physicalQty) : '') + '">' : (k.counted ? esc(l.physicalQty) : '<span class="text-gray-400">not counted</span>');
    var cells = [
      '<td class="' + td + '">' + esc(l.name) + '</td>', '<td class="' + td + '">' + esc(l.sku) + '</td>', '<td class="' + td + '">' + esc(l.category) + '</td>', '<td class="' + td + '">' + esc(l.warehouse) + '</td>',
      blind ? '' : '<td class="' + tdr + '">' + esc(l.systemQty) + '</td>',
      '<td class="' + tdr + '">' + phys + '</td>',
      blind ? '' : '<td class="' + tdr + ' ' + vcls + '" id="stVar' + i + '">' + (k.v == null ? '' : signed(k.v)) + '</td>',
      blind ? '' : '<td class="' + tdr + '">' + money(num(l.unitCost)) + '</td>',
      blind ? '' : '<td class="' + tdr + ' ' + vcls + '" id="stVal' + i + '">' + (k.val == null ? '' : money(k.val)) + '</td>',
      '<td class="' + td + '">' + reason + '</td>', '<td class="' + td + '">' + remarks + '</td>'
    ].join('');
    var rm = (t.status === 'Draft' && t.method === 'Cycle Count') ? '<td class="' + td + ' text-center"><button class="text-red-600 text-xs" data-rm="' + i + '">Remove</button></td>' : '';
    return '<tr id="stRow' + i + '">' + cells + rm + '</tr>';
  }
  function actionsHtml(t) {
    var b = function (label, fn, cls) { return '<button class="' + (cls || BTN) + ' font-semibold" onclick="' + fn + '(\'' + esc(t.id) + '\')">' + label + '</button>'; };
    var out = [];
    if (t.status === 'Draft') out.push(b('Start Counting', 'stStart'));
    if (t.status === 'Counting') out.push(b('Submit for Review', 'stSubmit'));
    if (t.status === 'Draft' || t.status === 'Counting') out.push(b('Refresh System Qty', 'stRefreshQty', BTN2));
    if (t.status === 'Submitted') { out.push(b('Approve', 'stApprove')); out.push(b('Send Back for Recount', 'stReject', BTN2)); }
    if (t.status === 'Approved') out.push(b('Post Adjustments', 'stPost'));
    var kk = totals(t);
    if (t.status === 'Draft' || t.status === 'Counting') out.push('<button class="' + BTN2 + '" onclick="stImport(\'' + esc(t.id) + '\')">Import Count (CSV)</button>');
    if (kk.counted > 0 && !(blindNow(t) && !canApprove())) out.push(b(t.status === 'Draft' || t.status === 'Counting' ? 'Generate Variance Report' : 'Variance Report', 'stVariance'));
    out.push('<button class="' + BTN2 + '" onclick="stExport(\'' + esc(t.id) + '\')">Export (CSV)</button>');
    out.push('<button class="' + BTN2 + '" onclick="stPrint(\'' + esc(t.id) + '\')">Print Count Sheet</button>');
    return out.join(' ');
  }
  function flowHtml(t) {
    var steps = ['Draft', 'Counting', 'Submitted', 'Approved', 'Posted'], at = steps.indexOf(t.status);
    return '<div class="flex flex-wrap items-center gap-1 text-xs mb-3">' + steps.map(function (s, i) {
      return '<span class="px-2 py-0.5 rounded ' + (i === at ? 'bg-blue-900 text-white font-semibold' : i < at ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500') + '">' + (i < at ? '&#10003; ' : '') + s + '</span>' + (i < steps.length - 1 ? '<span class="text-gray-400">&rsaquo;</span>' : '');
    }).join('') + '</div>';
  }
  function renderSheet() {
    var root = rootEl(); if (!root) return;
    state.t = null; var t = byId(state.id); state.t = t || null;
    if (!t) { state = { view: 'register', id: null, t: null }; return renderRegister(); }
    var meta = function (l, v) { return v ? '<div><span class="text-gray-500">' + l + ':</span> ' + esc(v) + '</div>' : ''; };
    var hdrs = cols(t).map(function (c) { return '<th class="border p-2 text-' + (c.r ? 'right' : 'left') + ' whitespace-nowrap">' + c.h + '</th>'; }).join('') + (t.status === 'Draft' && t.method === 'Cycle Count' ? '<th class="border p-2"></th>' : '');
    root.innerHTML =
      '<div class="mb-2"><button class="text-sm text-blue-900 underline" onclick="stBack()">&larr; Back to Stock Take Register</button></div>' +
      '<div class="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3"><div><h2 class="text-sm font-bold">Stock Take: ' + esc(t.no) + ' <span class="ml-2 px-2 py-0.5 rounded text-xs ' + BADGE[t.status] + '">' + esc(t.status) + '</span></h2>' +
      '<div class="text-sm text-gray-700 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6">' + meta('Warehouse', t.warehouse) + meta('Date', fmtDate(t.date)) + meta('Method', t.method + (t.blind ? ' (blind)' : '')) + meta('Category', t.category) + meta('Assigned to', t.assignedTo) +
      meta('Counted by', t.countedBy) + meta('Submitted by', t.submittedBy) + meta('Approved by', t.approvedBy) + meta('Posted by', t.postedBy) + meta('Notes', t.notes) + '</div></div>' +
      '<div class="flex flex-wrap gap-2">' + actionsHtml(t) + '</div></div>' +
      flowHtml(t) +
      '<div id="stTotals" class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">' + totalsHtml(t) + '</div>' +
      (editable(t) ? '<div class="bg-white rounded shadow p-3 mb-3 flex flex-wrap items-center gap-2"><label class="text-sm font-semibold">Scan / enter barcode or SKU</label><input id="stScan" class="border rounded-md px-3 py-1.5 text-sm w-64" placeholder="Scan then press Enter" autocomplete="off"><span id="stMsg" class="text-xs text-gray-600"></span></div>'
        : (t.status === 'Draft' ? '<div class="text-xs text-gray-600 mb-3">Items are loaded. Click <b>Start Counting</b> to begin entering physical quantities.</div>' : '')) +
      '<div class="bg-white p-4 rounded shadow mb-6"><div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr>' + hdrs + '</tr></thead><tbody id="stBody">' +
      t.lines.map(function (l, i) { return rowHtml(t, l, i); }).join('') + '</tbody></table></div>' +
      (t.status === 'Posted' ? '<div class="text-xs text-gray-600 mt-2">' + (t.postedVia === 'Bulk Adjustment' ? 'Adjusted through Inventory &gt; Bulk Adjustment' + (t.postedDate ? ' on ' + esc(fmtDate(t.postedDate)) : '') + '. See the Bulk Adjustment log.' : 'Posted. Adjustments were added to Stock Activity under reference ' + esc(t.no) + '.') + '</div>' : '') + '</div>';
    var sc = $('stScan'); if (sc) sc.focus();
  }
  function render() { if (state.view === 'sheet') renderSheet(); else if (state.view === 'report') renderReport(); else renderRegister(); }

  /* ---------- editing the sheet (events on the whole page) ---------- */
  function persistSoon(t) { clearTimeout(saveTimer); saveTimer = setTimeout(function () { put(t); }, 250); }
  function onEdit(e) {
    var el = e.target; if (!el || !el.getAttribute) return; var f = el.getAttribute('data-f'); if (!f) return;
    var t = byId(state.id); if (!t || !editable(t)) return; var i = parseInt(el.getAttribute('data-i'), 10), l = t.lines[i]; if (!l) return;
    if (f === 'physicalQty') {
      if (el.value === '') { l.physicalQty = null; l.countedBy = ''; l.countedAt = ''; }
      else {
        var n = num(el.value); if (n < 0) { el.value = ''; return alert('Quantity cannot be negative.'); }
        l.physicalQty = n; l.countedBy = who(); l.countedAt = new Date().toISOString(); if (!t.countedBy) t.countedBy = who();
      }
      var k = calc(l), cls = k.v == null ? '' : k.v < 0 ? 'text-red-600 font-semibold' : k.v > 0 ? 'text-green-700 font-semibold' : 'text-gray-700';
      var v = $('stVar' + i), vv = $('stVal' + i), base = 'border p-1 align-middle text-right ';
      if (v) { v.textContent = k.v == null ? '' : signed(k.v); v.className = base + cls; }
      if (vv) { vv.textContent = k.val == null ? '' : money(k.val); vv.className = base + cls; }
      var tt = $('stTotals'); if (tt) tt.innerHTML = totalsHtml(t);
    } else if (f === 'reason' || f === 'remarks') l[f] = el.value;
    persistSoon(t);
  }
  document.addEventListener('input', function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute('data-f') === 'physicalQty') onEdit(e); });
  document.addEventListener('change', onEdit);
  document.addEventListener('click', function (e) {
    var rm = e.target && e.target.closest && e.target.closest('button[data-rm]');
    if (rm) { var t = byId(state.id); if (t && t.status === 'Draft') { var i = parseInt(rm.getAttribute('data-rm'), 10); if (confirm('Remove ' + t.lines[i].name + ' from this count?')) { t.lines.splice(i, 1); put(t); renderSheet(); } } return; }
    var nav = e.target && e.target.closest && e.target.closest('button[onclick*="' + TAB + '"]');
    if (nav) setTimeout(function () { state = { view: 'register', id: null, t: null }; render(); }, 0);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target || e.target.id !== 'stScan') return; e.preventDefault();
    var t = byId(state.id); if (!t || !editable(t)) return; var v = low(e.target.value); if (!v) return;
    var msg = $('stMsg'), idx = -1;
    t.lines.forEach(function (l, i) { if (idx < 0 && (low(l.sku) === v || low(l.barcode) === v || low(l.name) === v)) idx = i; });
    e.target.value = '';
    if (idx < 0) { if (msg) msg.innerHTML = '<span class="text-red-600">Not on this count sheet: ' + esc(v) + '</span>'; return; }
    var inp = document.querySelector('input[data-f="physicalQty"][data-i="' + idx + '"]'), row = $('stRow' + idx), l = t.lines[idx], k = calc(l);
    if (msg) msg.innerHTML = k.counted ? '<span class="text-yellow-700">' + esc(l.name) + ' is already counted (' + esc(l.physicalQty) + '). Change the quantity only if you are recounting.</span>' : esc(l.name);
    if (row) { row.style.background = '#fef9c3'; setTimeout(function () { row.style.background = ''; }, 1500); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    if (inp) { inp.focus(); inp.select(); }
  });
  /* Enter in a quantity box jumps to the next item's quantity box */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target || e.target.getAttribute('data-f') !== 'physicalQty') return; e.preventDefault();
    var n = document.querySelector('input[data-f="physicalQty"][data-i="' + (parseInt(e.target.getAttribute('data-i'), 10) + 1) + '"]');
    if (n) { n.focus(); n.select(); } else { var s = $('stScan'); if (s) s.focus(); }
  });

  /* ---------- workflow ---------- */
  function flush(t) { clearTimeout(saveTimer); put(t); }
  w.stStart = function (id) {
    var t = byId(id); if (!t || t.status !== 'Draft') return;
    t.status = 'Counting'; t.countStartedAt = new Date().toISOString(); put(t); renderSheet();
  };
  w.stSubmit = function (id) {
    var t = byId(id); if (!t || t.status !== 'Counting') return;
    var moved = refreshQty(t);
    if (moved) { put(t); renderSheet(); return alert('Inventory changed while you were counting: System Qty was updated on ' + moved + ' line(s) so the variance is against current stock. Please review the variance, then submit again.'); }
    var missing = t.lines.filter(function (l) { return !calc(l).counted; });
    if (missing.length) return alert(missing.length + ' item(s) are not counted yet (first: ' + missing[0].name + '). Enter a physical quantity for every item, or remove it from a cycle count before submitting.');
    var noReason = t.lines.filter(function (l) { var k = calc(l); return k.v !== 0 && !l.reason; });
    if (noReason.length) return alert('Please choose a reason for variance on ' + noReason.length + ' item(s) (first: ' + noReason[0].name + ').');
    if (!confirm('Submit stock take ' + t.no + ' for approval? Quantities can no longer be changed unless it is sent back.')) return;
    t.status = 'Submitted'; t.submittedBy = who(); t.submittedAt = new Date().toISOString(); if (!t.countedBy) t.countedBy = who(); put(t); renderSheet();
  };
  w.stReject = function (id) {
    var t = byId(id); if (!t || t.status !== 'Submitted') return;
    if (!canApprove()) return alert('Only an authorised person can send a count back.');
    if (!confirm('Send ' + t.no + ' back to Counting for a recount?')) return;
    t.status = 'Counting'; t.submittedBy = ''; put(t); renderSheet();
  };
  w.stApprove = function (id) {
    var t = byId(id); if (!t || t.status !== 'Submitted') return;
    if (!canApprove()) return alert('Only an authorised person (Admin or Accounts) can approve a stock take.');
    var k = totals(t);
    if (!confirm('Approve ' + t.no + '?\n' + k.diffLines + ' item(s) with variance, net ' + signed(k.net) + ' unit(s), value ' + money(k.val) + '.\nInventory will not change until you post the adjustments.')) return;
    t.status = 'Approved'; t.approvedBy = who(); t.approvedAt = new Date().toISOString(); put(t); renderSheet();
  };
  w.stPost = function (id) {
    var t = byId(id); if (!t || t.status !== 'Approved') return;
    if (!canApprove()) return alert('Only an authorised person (Admin or Accounts) can post adjustments.');
    var diff = t.lines.filter(function (l) { return calc(l).v !== 0 && !l.adjusted; }), k = totals(t);
    if (!confirm('Post ' + t.no + '? ' + diff.length + ' adjustment(s) will change the balances in ' + t.warehouse + ' and appear in Stock Activity. This cannot be undone.')) return;
    var inv = w.getInventory(t.warehouse) || [], acts = rd('stockActivities'), now = today();
    diff.forEach(function (l, n) {
      var v = calc(l).v, hit = (function () {
        var byN = inv.filter(function (x) { return x && low(x.name) === low(l.name); });
        if (byN.length === 1) return byN[0];
        if (byN.length > 1) return byN.filter(function (x) { return l.sku && low(x.sku) === low(l.sku); })[0] || byN[0];
        var bySku = l.sku ? inv.filter(function (x) { return x && x.sku && low(x.sku) === low(l.sku); }) : [];
        return bySku.length === 1 ? bySku[0] : undefined;
      })();
      if (!hit) { if (v < 0) return; hit = { name: l.name, sku: l.sku, category: l.category, qty: 0 }; inv.push(hit); }
      var before = num(hit.qty), after = Math.max(0, r4(before + v)), applied = r4(after - before);
      hit.qty = after; l.postedQty = applied; l.adjusted = true; l.adjustedVia = 'Stock take post';
      if (!applied) return;
      acts.push({ id: 'SA' + Date.now() + '_' + n, no: nextNo(acts, 'ACT-', 'no', 4), type: applied > 0 ? 'Adjustment (increase)' : 'Adjustment (decrease)', item: l.name, sku: l.sku || '', warehouse: t.warehouse,
        qin: applied > 0 ? applied : 0, qout: applied < 0 ? -applied : 0, date: now, reference: t.no, reason: 'Stock take' + (l.reason ? ': ' + l.reason : '') + (l.remarks ? ' - ' + l.remarks : ''), by: who() });
    });
    w.saveInventory(t.warehouse, inv); localStorage.setItem('stockActivities', JSON.stringify(acts));
    t.status = 'Posted'; t.postedBy = who(); t.postedAt = new Date().toISOString(); t.postedDate = now; put(t);
    try { if (window.__companySync && window.__companySync.pushAllCompanyKeys) window.__companySync.pushAllCompanyKeys(); if (window.__companySyncKick) window.__companySyncKick(); } catch (e) {}   /* send the new stock + activity to the cloud now so linked apps see it */
    ['renderInventoryTable', 'renderMovementTable', 'renderStockTransfer'].forEach(function (f) { try { if (typeof w[f] === 'function') w[f](); } catch (e) {} });
    alert('Posted. ' + diff.length + ' adjustment(s) were applied and sent to Stock Activity.'); renderSheet();
  };

  /* ---------- export / print (respects blind counting) ---------- */
  function sheetRows(t) {
    var blind = blindNow(t), head = cols(t).map(function (c) { return c.h; });
    var rows = t.lines.map(function (l) {
      var k = calc(l), r = [l.name, l.sku, l.category, l.warehouse];
      if (!blind) r.push(l.systemQty);
      r.push(k.counted ? l.physicalQty : '');
      if (!blind) r.push(k.v == null ? '' : k.v, num(l.unitCost), k.val == null ? '' : k.val);
      r.push(l.reason || '', l.remarks || ''); return r;
    });
    return [head].concat(rows);
  }
  /* ---------- CSV export / import ---------- */
  /* One column layout for every sheet. Blind counts leave out the system columns (indexes 6, 8, 9, 10). */
  var CSV_HEAD = ['Stock Take No.', 'Warehouse', 'Item Name', 'SKU', 'Barcode', 'Category', 'System Qty', 'Physical Qty', 'Variance', 'Unit Cost', 'Variance Value', 'Reason for Variance', 'Remarks'];
  var SYS_COLS = [6, 8, 9, 10];
  function pick(arr, withSys) { return withSys ? arr : arr.filter(function (v, i) { return SYS_COLS.indexOf(i) < 0; }); }
  function lineRow(no, l) {
    var k = calc(l);
    return [no || '', l.warehouse, l.name, l.sku || '', l.barcode || '', l.category || '', num(l.systemQty), k.counted ? l.physicalQty : '', k.v == null ? '' : k.v, num(l.unitCost), k.val == null ? '' : k.val, l.reason || '', l.remarks || ''];
  }
  function saveCsv(name, rows) {
    var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function safeName(s) { return String(s || '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'stock'; }

  /* Export of one stock take (open on the working sheet) */
  w.stExport = function (id) {
    var t = byId(id); if (!t) return; var sys = !blindNow(t);
    saveCsv(t.no + '-count-sheet.csv', [pick(CSV_HEAD, sys)].concat(t.lines.map(function (l) { return pick(lineRow(t.no, l), sys); })));
  };

  /* Export straight from the Stock module: physical qty and variance stay blank until the count is imported */
  function stockSheet(wh, cat) {
    try { topUpAll(); } catch (e) {}
    var open = takes().filter(function (t) { return t.warehouse === wh && (t.status === 'Draft' || t.status === 'Counting') && (!cat || !t.category || t.category === cat); })[0];
    if (open) {
      open = byId(open.id) || open; var sys = !blindNow(open);
      var ls = open.lines.filter(function (l) { return !cat || l.category === cat; });
      return { count: ls.length, rows: [pick(CSV_HEAD, sys)].concat(ls.map(function (l) { return pick(lineRow(open.no, l), sys); })) };
    }
    var seen = {}, lines = [];
    invOf(wh).forEach(function (it) {
      if (cat && catOf(it) !== cat) return;
      var key = low(it.name) + '|' + low(it.sku || ''); if (seen[key]) return; seen[key] = 1;
      lines.push({ warehouse: wh, name: it.name, sku: it.sku || '', barcode: it.barcode || '', category: catOf(it), systemQty: num(it.qty), unitCost: costOf(it), physicalQty: null, reason: '', remarks: '' });
    });
    return { count: lines.length, rows: [CSV_HEAD].concat(lines.map(function (l) { return lineRow('', l); })) };
  }
  w.stExportStock = function () {
    var old = $('stExpModal'); if (old) old.remove();
    var whs = warehouses(); if (!whs.length) return alert('No warehouses were found. Add a warehouse first.');
    var o = document.createElement('div'); o.id = 'stExpModal';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px';
    o.innerHTML = '<div style="background:#fff;border-radius:10px;max-width:420px;width:100%;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.3)">' +
      '<div style="font-weight:700;font-size:15px">Export Stock Sheet (CSV)</div>' +
      '<div style="font-size:12px;color:#6b7280;margin:4px 0 12px">Takes the current stock from the Stock module. Physical Qty and Variance are left blank: fill in Physical Qty while counting, then use Import Count (CSV).</div>' +
      '<label class="block text-sm font-semibold mb-1">Warehouse <span class="text-red-500">*</span></label><select id="stExpWh" class="' + INP + ' mb-3"><option value="">Select Warehouse</option>' + whs.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</select>' +
      '<label class="block text-sm font-semibold mb-1">Category <span class="text-xs font-normal text-gray-500">(optional)</span></label><select id="stExpCat" class="' + INP + ' mb-4"><option value="">All categories</option></select>' +
      '<div class="text-right space-x-2"><button class="' + BTN + ' font-semibold" id="stExpGo">Download CSV</button><button class="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600" id="stExpX">Cancel</button></div></div>';
    document.body.appendChild(o);
    o.addEventListener('mousedown', function (e) { if (e.target === o) o.remove(); });
    $('stExpX').onclick = function () { o.remove(); };
    $('stExpWh').onchange = function () {
      var cats = {}; invOf(this.value).forEach(function (it) { var c = catOf(it); if (c) cats[c] = 1; });
      $('stExpCat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    };
    $('stExpGo').onclick = function () {
      var wh = $('stExpWh').value, cat = $('stExpCat').value; if (!wh) return alert('Please choose the warehouse.');
      var sh = stockSheet(wh, cat); if (!sh.count) return alert('No items were found in this warehouse' + (cat ? ' and category' : '') + '.');
      saveCsv('stock-count-' + safeName(wh) + '-' + today() + '.csv', sh.rows); o.remove();
    };
  };

  /* ---- reading a CSV (or Excel, when the Excel library is loaded) ---- */
  function parseCsv(text) {
    text = String(text || '').replace(/^\ufeff/, '');
    var first = text.split(/\r?\n/)[0] || '', best = ',', bc = -1;
    [',', ';', '\t'].forEach(function (d) { var c = 0, q = false; for (var i = 0; i < first.length; i++) { var ch = first.charAt(i); if (ch === '"') q = !q; else if (!q && ch === d) c++; } if (c > bc) { bc = c; best = d; } });
    var rows = [], row = [], cur = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (q) { if (ch === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === best) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text.charAt(i + 1) === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }
  var HMAP = {
    no: ['stocktakeno', 'stocktake', 'countno', 'takeno', 'reference', 'ref'], wh: ['warehouse', 'location'],
    name: ['itemname', 'item', 'product', 'productname', 'name'], sku: ['sku', 'itemcode', 'productcode', 'code'], barcode: ['barcode'],
    phys: ['physicalqty', 'physicalquantity', 'physical', 'countedqty', 'counted', 'countqty', 'count', 'actualqty', 'actual', 'qtycounted'],
    reason: ['reasonforvariance', 'reason'], remarks: ['remarks', 'remark', 'notes', 'note']
  };
  function hk(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function findHeader(rows) {
    for (var i = 0; i < rows.length && i < 15; i++) {
      var c = {}; rows[i].forEach(function (h, ci) { var k = hk(h); Object.keys(HMAP).forEach(function (f) { if (c[f] == null && HMAP[f].indexOf(k) > -1) c[f] = ci; }); });
      if (c.phys != null && (c.sku != null || c.name != null || c.barcode != null)) return { h: i, c: c };
    }
    return null;
  }
  function parseQty(v) {
    var s = String(v == null ? '' : v).replace(/\s/g, ''); if (s === '') return null;
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    if (!/^-?\d*\.?\d+$/.test(s)) return NaN; return parseFloat(s);
  }
  function readTable(file, cb) {
    var isX = /\.xlsx?$/i.test(file.name), fr = new FileReader();
    fr.onerror = function () { alert('Could not read the file.'); };
    fr.onload = function () {
      try {
        var text;
        if (isX) { if (!w.XLSX) return alert('Excel files cannot be read here. Save the sheet as CSV and import that.'); var wb = w.XLSX.read(fr.result, { type: 'array' }); text = w.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); }
        else text = fr.result;
        var rows = parseCsv(text), hd = findHeader(rows);
        if (!hd) return alert('The columns were not recognised. The file needs a "Physical Qty" column and an "Item Name" or "SKU" column. Use the sheet from Export Stock Sheet.');
        cb({ rows: rows, h: hd.h, c: hd.c });
      } catch (e) { console.error('[stock take import]', e); alert('Could not read that file: ' + e.message); }
    };
    if (isX) fr.readAsArrayBuffer(file); else fr.readAsText(file);
  }
  function pickFile(cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.txt,text/csv' + (w.XLSX ? ',.xlsx,.xls' : ''); inp.style.display = 'none';
    inp.onchange = function () { var f = inp.files && inp.files[0]; inp.remove(); if (f) readTable(f, cb); };
    document.body.appendChild(inp); inp.click();
  }

  /* put the file's physical quantities on the stock take lines (matching on SKU, then barcode, then name) */
  function applyImport(t, tbl) {
    var c = tbl.c, idx = { sku: {}, bc: {}, name: {} }, touched = {}, res = { set: 0, blank: 0, unmatched: [], invalid: [], otherWh: 0, dup: 0 };
    var skuN = {}; t.lines.forEach(function (l) { if (l.sku) skuN[low(l.sku)] = (skuN[low(l.sku)] || 0) + 1; });
    t.lines.forEach(function (l, i) {
      if (l.sku && skuN[low(l.sku)] === 1 && idx.sku[low(l.sku)] == null) idx.sku[low(l.sku)] = i;   /* a SKU shared by several items (PCS, KGM ...) is not an identity: fall through to barcode / name */
      if (l.barcode && idx.bc[low(l.barcode)] == null) idx.bc[low(l.barcode)] = i;
      if (idx.name[low(l.name)] == null) idx.name[low(l.name)] = i;
    });
    tbl.rows.slice(tbl.h + 1).forEach(function (r) {
      var g = function (k) { return c[k] == null ? '' : String(r[c[k]] == null ? '' : r[c[k]]).trim(); };
      var name = g('name'), sku = g('sku'), bc = g('barcode'); if (!name && !sku && !bc) return;
      var wh = g('wh'); if (wh && low(wh) !== low(t.warehouse)) { res.otherWh++; return; }
      var i = sku && idx.sku[low(sku)] != null ? idx.sku[low(sku)] : bc && idx.bc[low(bc)] != null ? idx.bc[low(bc)] : name && idx.name[low(name)] != null ? idx.name[low(name)] : -1;
      if (i < 0) { res.unmatched.push(sku || name || bc); return; }
      var q = parseQty(g('phys'));
      if (q === null) { res.blank++; return; }
      if (isNaN(q) || q < 0) { res.invalid.push(t.lines[i].name + ' (' + g('phys') + ')'); return; }
      var l = t.lines[i]; if (touched[i]) res.dup++; touched[i] = 1;
      l.physicalQty = q; l.countedBy = who(); l.countedAt = new Date().toISOString();
      var rs = g('reason'), rm = g('remarks');
      if (rs) { var hit = REASONS.filter(function (x) { return low(x) === low(rs); })[0]; if (hit) l.reason = hit; else { l.reason = 'Other'; if (!rm) rm = rs; } }
      if (rm) l.remarks = rm;
      res.set++;
    });
    if (res.set && !t.countedBy) t.countedBy = who();
    return res;
  }
  function importNote(res) {
    var m = res.set + ' physical count(s) imported.';
    if (res.blank) m += '\n' + res.blank + ' row(s) had no Physical Qty and were left uncounted.';
    if (res.unmatched.length) m += '\n' + res.unmatched.length + ' row(s) were not found in this stock take and were ignored: ' + res.unmatched.slice(0, 5).join(', ') + (res.unmatched.length > 5 ? ', ...' : '');
    if (res.invalid.length) m += '\n' + res.invalid.length + ' row(s) had an invalid quantity and were skipped: ' + res.invalid.slice(0, 5).join(', ') + (res.invalid.length > 5 ? ', ...' : '');
    if (res.otherWh) m += '\n' + res.otherWh + ' row(s) belong to another warehouse and were skipped.';
    if (res.dup) m += '\n' + res.dup + ' item(s) appeared more than once; the last row was used.';
    return m;
  }
  function finishImport(t) {
    if (blindNow(t) && !canApprove()) { state = { view: 'sheet', id: t.id, t: null }; render(); return; }
    genVariance(t);
  }
  w.stImport = function (id) {
    var t0 = byId(id); if (!t0) return;
    if (t0.status !== 'Draft' && t0.status !== 'Counting') return alert('Counts can only be imported while the stock take is Draft or Counting.');
    pickFile(function (tbl) {
      var t = byId(id); if (!t) return;
      var res = applyImport(t, tbl);
      if (!res.set) return alert(importNote(res) + '\n\nNothing was changed.');
      if (t.status === 'Draft') { t.status = 'Counting'; t.countStartedAt = new Date().toISOString(); }
      put(t); alert(importNote(res)); finishImport(t);
    });
  };
  /* Import from the register: finds the stock take from the Stock Take No. / Warehouse columns, or starts a new one */
  w.stImportAny = function () {
    pickFile(function (tbl) {
      var c = tbl.c, noV = '', whs = {}, list = takes(), t = null, created = false;
      tbl.rows.slice(tbl.h + 1).forEach(function (r) {
        if (c.no != null && !noV) { var v = String(r[c.no] == null ? '' : r[c.no]).trim(); if (v) noV = v; }
        if (c.wh != null) { var x = String(r[c.wh] == null ? '' : r[c.wh]).trim(); if (x) whs[x] = 1; }
      });
      if (noV) {
        t = list.filter(function (x) { return low(x.no) === low(noV); })[0];
        if (!t) return alert('Stock take ' + noV + ' was not found.');
      } else {
        var names = Object.keys(whs);
        if (names.length !== 1) return alert(names.length ? 'The file contains more than one warehouse. Import one warehouse per file.' : 'Cannot tell which warehouse this file is for. Use the sheet from Export Stock Sheet (it has the Warehouse column), or open a stock take and use Import Count inside it.');
        var wh = warehouses().filter(function (n) { return low(n) === low(names[0]); })[0];
        if (!wh) return alert('Warehouse "' + names[0] + '" was not found.');
        t = list.filter(function (x) { return x.warehouse === wh && x.status !== 'Posted'; })[0];
        if (!t) {
          var seen = {}, lines = [];
          invOf(wh).forEach(function (it) {
            var key = low(it.name) + '|' + low(it.sku || ''); if (seen[key]) return; seen[key] = 1;
            lines.push({ key: key, itemId: it.id != null ? String(it.id) : '', name: it.name, sku: it.sku || '', barcode: it.barcode || '', category: catOf(it), warehouse: wh, systemQty: num(it.qty), unitCost: costOf(it), physicalQty: null, reason: '', remarks: '', countedBy: '', countedAt: '' });
          });
          if (!lines.length) return alert('No items were found in ' + wh + ' to count.');
          t = { id: 'STK' + Date.now(), no: nextNo(list, 'ST-', 'no', 3), date: today(), warehouse: wh, category: '', method: 'Full Count', assignedTo: who(), notes: 'Created from an imported count file', blind: false, status: 'Counting', countStartedAt: new Date().toISOString(),
            createdBy: who(), createdAt: new Date().toISOString(), countedBy: '', submittedBy: '', approvedBy: '', postedBy: '', lines: lines };
          created = true;
        }
      }
      t = byId(t.id) || t;
      if (t.status !== 'Draft' && t.status !== 'Counting') return alert('Stock take ' + t.no + ' is ' + t.status + ' and can no longer take a new count. ' + (t.status === 'Posted' ? 'Start a new stock take instead.' : 'Finish or post it first.'));
      var res = applyImport(t, tbl);
      if (!res.set) return alert(importNote(res) + '\n\nNothing was changed.');
      if (t.status === 'Draft') { t.status = 'Counting'; t.countStartedAt = new Date().toISOString(); }
      put(t);
      alert(importNote(res) + '\n\n' + (created ? 'A new stock take ' + t.no + ' was created for ' + t.warehouse + '.' : 'Counts were added to stock take ' + t.no + ' (' + t.warehouse + ').'));
      finishImport(t);
    });
  };

  /* ---------- variance report ---------- */
  function genVariance(t) {
    var k = totals(t);
    if (!k.counted) { alert('Enter or import at least one physical count first.'); return false; }
    if (blindNow(t) && !canApprove()) { alert('This is a blind count. Variances stay hidden until it is submitted.'); return false; }
    t.varianceAt = new Date().toISOString(); t.varianceBy = who(); put(t);
    state = { view: 'report', id: t.id, t: null }; render(); return true;
  }
  w.stVariance = function (id) {
    var t = byId(id); if (!t) return;
    if (t.status === 'Draft' || t.status === 'Counting') { flush(t); genVariance(t); }
    else { state = { view: 'report', id: id, t: null }; render(); }
  };
  function varLines(t) { var out = []; t.lines.forEach(function (l) { var k = calc(l); if (k.counted && k.v !== 0) out.push({ l: l, k: k }); }); return out; }
  function renderReport() {
    var root = rootEl(); if (!root) return;
    state.t = null; var t = byId(state.id); state.t = t || null;
    if (!t) { state = { view: 'register', id: null, t: null }; return renderRegister(); }
    var rows = varLines(t), k = totals(t), shortU = 0, shortV = 0, surU = 0, surV = 0, pending = 0;
    rows.forEach(function (x) { if (x.k.v < 0) { shortU += -x.k.v; shortV += x.k.val; } else { surU += x.k.v; surV += x.k.val; } if (!x.l.adjusted) pending++; });
    var card = function (l, v, cls) { return '<div class="bg-white rounded shadow p-3"><div class="text-xs text-gray-500">' + l + '</div><div class="text-lg font-bold ' + (cls || 'text-blue-900') + '">' + v + '</div></div>'; };
    var td = 'border p-2', tdr = td + ' text-right';
    var body = rows.length ? rows.map(function (x) {
      var l = x.l, v = x.k.v, cls = v < 0 ? 'text-red-600 font-semibold' : 'text-green-700 font-semibold';
      return '<tr><td class="' + td + '">' + esc(l.name) + '</td><td class="' + td + '">' + esc(l.sku) + '</td><td class="' + td + '">' + esc(l.category) + '</td><td class="' + tdr + '">' + esc(l.systemQty) + '</td><td class="' + tdr + '">' + esc(l.physicalQty) + '</td>' +
        '<td class="' + tdr + ' ' + cls + '">' + signed(v) + '</td><td class="' + tdr + '">' + money(num(l.unitCost)) + '</td><td class="' + tdr + ' ' + cls + '">' + money(x.k.val) + '</td><td class="' + td + '">' + esc(l.reason || '') + '</td>' +
        '<td class="' + td + '">' + (l.adjusted ? '<span class="px-2 py-0.5 rounded text-xs bg-green-100 text-green-800">Adjusted</span>' : '<span class="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800">Pending</span>') + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="text-center p-4 text-gray-500">No variances. Every counted item matches the system quantity.</td></tr>';
    var canGo = t.status !== 'Posted' && pending > 0;
    var tid = esc(t.id);
    root.innerHTML =
      '<div class="mb-2"><button class="text-sm text-blue-900 underline" onclick="stOpen(\'' + tid + '\')">&larr; Back to count sheet</button> <span class="text-gray-300 mx-1">|</span> <button class="text-sm text-blue-900 underline" onclick="stBack()">Stock Take Register</button></div>' +
      '<div class="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3"><div><h2 class="text-sm font-bold">Variance Report: ' + esc(t.no) + ' <span class="ml-2 px-2 py-0.5 rounded text-xs ' + BADGE[t.status] + '">' + esc(t.status) + '</span></h2>' +
      '<div class="text-sm text-gray-700 mt-1">Warehouse: ' + esc(t.warehouse) + ' &nbsp;|&nbsp; Count date: ' + esc(fmtDate(t.date)) + (t.category ? ' &nbsp;|&nbsp; Category: ' + esc(t.category) : '') + '</div></div>' +
      '<div class="flex flex-wrap gap-2"><button class="' + BTN2 + '" onclick="stExportVar(\'' + tid + '\')">Export Variance (CSV)</button><button class="' + BTN2 + '" onclick="stPrintVar(\'' + tid + '\')">Print</button>' +
      (canGo ? '<button class="' + BTN + ' font-semibold" onclick="stGoBulk(\'' + tid + '\')">Go to Bulk Adjustment</button>' : '') + '</div></div>' +
      flowHtml(t) +
      '<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">' + card('Counted', k.counted + ' of ' + k.total) + card('Items with variance', rows.length, rows.length ? 'text-red-600' : 'text-blue-900') + card('Shortage', '-' + r4(shortU) + ' (' + money(shortV) + ')', 'text-red-600') + card('Surplus', '+' + r4(surU) + ' (' + money(surV) + ')', 'text-green-700') + card('Net variance value', money(k.val), k.val < 0 ? 'text-red-600' : k.val > 0 ? 'text-green-700' : 'text-blue-900') + '</div>' +
      (k.total > k.counted ? '<div class="text-xs text-yellow-700 mb-2">' + (k.total - k.counted) + ' item(s) have not been counted. They are left out of this report and will not be adjusted.</div>' : '') +
      '<div class="bg-white p-4 rounded shadow mb-6"><div class="overflow-x-auto"><table class="w-full border-collapse border border-gray-300 text-sm"><thead class="bg-gray-100"><tr>' +
      ['Item Name', 'SKU', 'Category', 'System Qty', 'Physical Qty', 'Variance', 'Unit Cost', 'Variance Value', 'Reason', 'Adjustment'].map(function (h, i) { return '<th class="border p-2 text-' + (i > 2 && i < 8 ? 'right' : 'left') + ' whitespace-nowrap">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="text-xs text-gray-600 mt-2">' + (t.status === 'Posted' ? 'All variances in this count have been adjusted.' : canGo ? 'Next: open <b>Bulk Adjustment</b>, pick <b>' + esc(t.warehouse) + '</b> and the adjustment quantities are already filled in from this report. Review them and click Apply Adjustments.' : '') + '</div></div>';
  }
  w.stExportVar = function (id) {
    var t = byId(id); if (!t) return;
    var head = ['Stock Take No.', 'Warehouse', 'Item Name', 'SKU', 'Category', 'System Qty', 'Physical Qty', 'Variance', 'Unit Cost', 'Variance Value', 'Reason for Variance', 'Remarks', 'Adjustment'];
    saveCsv(t.no + '-variance-report.csv', [head].concat(varLines(t).map(function (x) { var l = x.l; return [t.no, l.warehouse, l.name, l.sku || '', l.category || '', num(l.systemQty), l.physicalQty, x.k.v, num(l.unitCost), x.k.val, l.reason || '', l.remarks || '', l.adjusted ? 'Adjusted' : 'Pending']; })));
  };
  w.stPrintVar = function (id) {
    var t = byId(id); if (!t) return;
    var pw = window.open('', '', 'width=1000,height=700'); if (!pw) return alert('Allow pop-ups to print.');
    var head = ['Item Name', 'SKU', 'Category', 'System Qty', 'Physical Qty', 'Variance', 'Unit Cost', 'Variance Value', 'Reason'], k = totals(t);
    var cell = 'border:1px solid #ccc;padding:6px;text-align:left;';
    var tbl = '<table style="width:100%;border-collapse:collapse;font-size:12px"><tr>' + head.map(function (h) { return '<th style="background:#1e3a8a;color:#fff;' + cell + '">' + h + '</th>'; }).join('') + '</tr>' +
      varLines(t).map(function (x) { var l = x.l; return '<tr>' + [l.name, l.sku, l.category, l.systemQty, l.physicalQty, signed(x.k.v), money(num(l.unitCost)), money(x.k.val), l.reason || ''].map(function (v) { return '<td style="' + cell + '">' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
    pw.document.write('<html><head><title>' + esc(t.no) + ' variance</title></head><body style="font-family:Arial,sans-serif;padding:16px;color:#333"><h2 style="color:#1e3a8a;margin:0">Stock Take Variance Report ' + esc(t.no) + '</h2>' +
      '<div style="margin:6px 0 12px;font-size:13px">Warehouse: ' + esc(t.warehouse) + ' &nbsp;|&nbsp; Date: ' + esc(fmtDate(t.date)) + ' &nbsp;|&nbsp; Net variance: ' + signed(k.net) + ' unit(s), ' + esc(money(k.val)) + '</div>' + tbl +
      '<div style="margin-top:30px;font-size:12px">Prepared by: ________________ &nbsp;&nbsp; Approved by: ________________ &nbsp;&nbsp; Date: ____________</div></body></html>');
    pw.document.close(); pw.focus(); setTimeout(function () { pw.print(); }, 300);
  };
  w.stGoBulk = function (id) {
    var t = byId(id); if (!t) return;
    if (typeof w.showTab !== 'function') return alert('Open Inventory > Bulk Adjustment and choose ' + t.warehouse + '.');
    w.showTab('BulkAdjustment');
    var tries = 0;
    (function pickWh() {
      var sel = $('baWarehouseSelect');
      if (sel && Array.prototype.some.call(sel.options, function (o) { return o.value === t.warehouse; })) { sel.value = t.warehouse; sel.dispatchEvent(new Event('change', { bubbles: true })); return; }
      if (tries++ < 20) setTimeout(pickWh, 150); else alert('Choose ' + t.warehouse + ' in the Warehouse list on the Bulk Adjustment page.');
    })();
  };

  w.stPrint = function (id) {
    var t = byId(id); if (!t) return;
    var rows = sheetRows(t), pw = window.open('', '', 'width=1000,height=700'); if (!pw) return alert('Allow pop-ups to print.');
    var blank = blindNow(t) || t.status === 'Draft' || t.status === 'Counting';
    var tbl = '<table style="width:100%;border-collapse:collapse;font-size:12px">' + rows.map(function (r, ri) {
      return '<tr>' + r.map(function (v, ci) {
        var isPhys = rows[0][ci] === 'Physical Qty', empty = blank && ri > 0 && isPhys && v === '';
        return (ri === 0 ? '<th style="background:#1e3a8a;color:#fff;' : '<td style="') + 'border:1px solid #ccc;padding:6px;text-align:left;' + (empty ? 'min-width:70px;height:22px' : '') + '">' + esc(v) + (ri === 0 ? '</th>' : '</td>');
      }).join('') + '</tr>';
    }).join('') + '</table>';
    pw.document.write('<html><head><title>' + esc(t.no) + '</title></head><body style="font-family:Arial,sans-serif;padding:16px;color:#333"><h2 style="color:#1e3a8a;margin:0">Stock Take ' + esc(t.no) + '</h2>' +
      '<div style="margin:6px 0 12px;font-size:13px">Warehouse: ' + esc(t.warehouse) + ' &nbsp;|&nbsp; Date: ' + esc(fmtDate(t.date)) + ' &nbsp;|&nbsp; Method: ' + esc(t.method) + (t.assignedTo ? ' &nbsp;|&nbsp; Assigned to: ' + esc(t.assignedTo) : '') + '</div>' + tbl +
      '<div style="margin-top:30px;font-size:12px">Counted by: ________________ &nbsp;&nbsp; Approved by: ________________ &nbsp;&nbsp; Date: ____________</div></body></html>');
    pw.document.close(); pw.focus(); setTimeout(function () { pw.print(); }, 300);
  };

  /* ---------- Variance feed for Inventory > Bulk Adjustment ---------- */
  /* A count is "ready" once its variance report has been generated (or it has been submitted/approved) and it is not posted yet.
   * Bulk Adjustment then shows the variance for that warehouse and pre-fills the adjustment quantity. After the adjustment is
   * applied the lines are marked adjusted, and the stock take becomes Posted when every variance line is done. */
  function allTakes() { return takes().map(function (t) { return state.t && state.t.id === t.id ? state.t : t; }); }
  function readyForBulk(t) { return !!t && t.status !== 'Posted' && t.status !== 'Draft' && (!!t.varianceAt || t.status === 'Submitted' || t.status === 'Approved'); }
  function lineKey(l) { return l.key || low(l.sku || l.name); }
  /* Lines are keyed 'name|sku' but Bulk Adjustment rows only know name and SKU, so the variance used to be stored under a key the page never looked up. Store it under every key a row can produce. */
  function lineKeys(l) { var o = [lineKey(l), low(l.name) + '|' + low(l.sku || ''), low(l.sku || l.name)]; return o.filter(function (k, i) { return k && o.indexOf(k) === i; }); }
  w.acxStockTakeVariance = function (wh) {
    var res = { map: {}, takes: [], items: 0, net: 0 };
    allTakes().forEach(function (t) {
      if (t.warehouse !== wh || !readyForBulk(t)) return;
      var n = 0, net = 0;
      t.lines.forEach(function (l) {
        if (l.adjusted) return; var k = calc(l); if (!k.counted || !k.v) return;
        var rec = { v: k.v, sys: num(l.systemQty), phys: k.p, no: t.no, ck: lineKey(l), reason: 'Stock take ' + t.no + (l.reason ? ': ' + l.reason : '') };
        lineKeys(l).forEach(function (kk) { res.map[kk] = rec; });
        n++; net += k.v;
      });
      res.takes.push({ no: t.no, date: t.date, items: n, net: r4(net) }); res.items += n; res.net = r4(res.net + net);
    });
    return res;
  };
  w.acxStockTakeMarkAdjusted = function (wh, items) {
    var now = new Date().toISOString(), changed = false;
    allTakes().forEach(function (t) {
      if (t.warehouse !== wh || !readyForBulk(t)) return;
      var hit = false;
      items.forEach(function (it) {
        t.lines.forEach(function (l) {
          if (lineKey(l) === it.key && !l.adjusted && calc(l).v) { l.adjusted = true; l.adjustedQty = it.applied; l.adjustedAt = now; l.adjustedBy = who(); l.adjustedVia = 'Bulk Adjustment'; hit = true; }
        });
      });
      if (!hit) return;
      var left = t.lines.filter(function (l) { var k = calc(l); return k.counted && k.v !== 0 && !l.adjusted; });
      if (!left.length) { t.status = 'Posted'; t.postedVia = 'Bulk Adjustment'; t.postedBy = who(); t.postedAt = now; t.postedDate = today(); }
      put(t); changed = true;
    });
    if (changed) { try { if (typeof w.renderBAProducts === 'function') w.renderBAProducts(); } catch (e) {} }
  };

  /* ---- Bulk Adjustment page: variance column, banner, pre-filled quantities ---- */
  function baHeader() {
    var body = $('baProductBody'); if (!body) return; var table = body.closest('table'); if (!table) return;
    var tr = table.querySelector('thead tr'); if (!tr || tr.querySelector('[data-ba-var]')) return;
    var th = document.createElement('th'); th.className = 'p-3.5'; th.setAttribute('data-ba-var', '1'); th.textContent = 'Stock Take Variance';
    var ref = tr.children[2]; tr.insertBefore(th, ref ? ref.nextSibling : null);
  }
  function baBanner() {
    var b = $('baVarBanner'); if (b) return b;
    var sel = $('baWarehouseSelect'); if (!sel || !sel.parentNode || !sel.parentNode.parentNode) return null;
    b = document.createElement('div'); b.id = 'baVarBanner'; sel.parentNode.parentNode.insertBefore(b, sel.parentNode.nextSibling); return b;
  }
  function baFill(tr, force) {
    var v = tr.getAttribute('data-ba-v'); if (v == null) return;
    var inp = tr.querySelector('.baAdjInput'), rs = tr.querySelector('.baReasonInput');
    if (inp && (force || !inp.value)) inp.value = v;
    if (rs && (force || !rs.value)) rs.value = tr.getAttribute('data-ba-reason') || '';
  }
  function baDecorate() {
    var body = $('baProductBody'); if (!body) return;
    baHeader();
    var sel = $('baWarehouseSelect'), wh = sel ? sel.value : '';
    var V = wh ? w.acxStockTakeVariance(wh) : { map: {}, takes: [], items: 0, net: 0 };
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr) {
      if (!tr.hasAttribute('data-id')) { var c1 = tr.querySelector('td[colspan="5"]'); if (c1) c1.setAttribute('colspan', '6'); return; }
      if (tr.getAttribute('data-ba-done')) return; tr.setAttribute('data-ba-done', '1');
      var tds = tr.children, name = (tds[0].textContent || '').trim(), sku = (tds[1].textContent || '').trim(); if (sku === '-') sku = '';
      var e = V.map[low(name) + '|' + low(sku)] || V.map[low(sku || name)], key = e ? e.ck : low(sku || name), ref = tds[3] || null, cell = document.createElement('td'); cell.className = 'p-3.5';
      if (e) {
        var cur = parseFloat((tds[2].textContent || '').trim()) || 0, moved = Math.abs(cur - e.sys) > 0.00001;
        cell.innerHTML = '<span class="font-semibold ' + (e.v < 0 ? 'text-red-600' : 'text-green-700') + '">' + signed(e.v) + '</span> <span class="text-xs text-gray-500">' + esc(e.no) + '</span>' +
          (moved ? ' <span class="text-amber-600" title="The system quantity was ' + esc(e.sys) + ' when this was counted and is ' + esc(cur) + ' now. Check the quantity before applying.">&#9888;</span>' : '');
        tr.setAttribute('data-ba-v', e.v); tr.setAttribute('data-ba-key', key); tr.setAttribute('data-ba-reason', e.reason); tr.style.background = '#fefce8';
        baFill(tr, false);
      } else cell.innerHTML = '<span class="text-gray-300">-</span>';
      tr.insertBefore(cell, ref);
    });
    var b = baBanner(); if (!b) return;
    if (wh && V.items) {
      var names = V.takes.filter(function (x) { return x.items; }).map(function (x) { return esc(x.no) + (x.date ? ' (' + esc(fmtDate(x.date)) + ')' : ''); }).join(', ');
      b.className = 'mx-4 mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center gap-2';
      b.innerHTML = '<span><b>Stock take variance loaded</b> from ' + names + ': ' + V.items + ' item(s) with variance, net ' + signed(V.net) + '. The Adjustment quantities are filled in from the count. Review them, then click Apply Adjustments.</span>' +
        '<button type="button" id="baVarRefill" class="ml-auto px-3 py-1 bg-white border border-amber-300 rounded-lg text-xs font-medium hover:bg-amber-100">Re-fill from stock take</button>';
    } else { b.className = 'hidden'; b.innerHTML = ''; }
  }
  function baWatch() {
    var body = $('baProductBody'); if (!body || body.__baObs) return !!body;
    body.__baObs = true; new MutationObserver(function () { try { baDecorate(); } catch (e) { console.error('[bulk adjustment variance]', e); } }).observe(body, { childList: true });
    try { baDecorate(); } catch (e) {} return true;
  }
  var baTries = 0; (function baGo() { if (!baWatch() && baTries++ < 40) setTimeout(baGo, 500); })();
  setTimeout(function () { try { baDecorate(); } catch (e) {} }, 1500);
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'baWarehouseSelect') setTimeout(function () { try { baDecorate(); } catch (x) {} }, 0); });
  function baLogLen(wh) { try { return (JSON.parse(localStorage.getItem('bulkAdjustments_' + wh) || '[]') || []).length; } catch (e) { return 0; } }
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    if (t.closest('#baVarRefill')) { Array.prototype.forEach.call(document.querySelectorAll('#baProductBody tr[data-ba-v]'), function (tr) { baFill(tr, true); }); return; }
    if (!t.closest('#applyBAAdjustmentsBtn')) return;
    /* capture phase: this runs before Bulk Adjustment applies, so remember which variance rows are about to be adjusted */
    var sel = $('baWarehouseSelect'); if (!sel || !sel.value) return; var wh = sel.value, snap = [];
    Array.prototype.forEach.call(document.querySelectorAll('#baProductBody tr[data-ba-v]'), function (tr) {
      var inp = tr.querySelector('.baAdjInput'), n = parseFloat(inp && inp.value || 0); if (n) snap.push({ key: tr.getAttribute('data-ba-key'), applied: n });
    });
    if (!snap.length) return;
    var before = baLogLen(wh), tries = 0;
    (function check() { if (baLogLen(wh) > before) w.acxStockTakeMarkAdjusted(wh, snap); else if (tries++ < 5) setTimeout(check, 150); })();
  }, true);


  /* ---------- MOBILE COUNTS (Acacia Stock Count app -> Assessment) ----------
   * The phone app (stocktake.html) pushes finished counts into the cloud key "stocktakeMobile" (one entry per count).
   * Books picks them up here: the counts go onto the matching Draft/Counting stock take (or a new one is started for that
   * warehouse) with the SAME matching rules as Import Count (CSV): SKU, then barcode, then name. Inventory is NOT changed;
   * the register shows a banner with a View Variance button. Posting still happens only from the stock take, as before. */
  var MKEY = 'stocktakeMobile';
  function mobileList() { return rd(MKEY); }
  function saveMobile(a) { localStorage.setItem(MKEY, JSON.stringify(a)); }
  function newTakeFor(list, wh, by) {
    var seen = {}, lines = [];
    invOf(wh).forEach(function (it) {
      var key = low(it.name) + '|' + low(it.sku || ''); if (seen[key]) return; seen[key] = 1;
      lines.push({ key: key, itemId: it.id != null ? String(it.id) : '', name: it.name, sku: it.sku || '', barcode: it.barcode || '', category: catOf(it), warehouse: wh, systemQty: num(it.qty), unitCost: costOf(it), physicalQty: null, reason: '', remarks: '', countedBy: '', countedAt: '' });
    });
    if (!lines.length) return null;
    return { id: 'STK' + Date.now(), no: nextNo(list, 'ST-', 'no', 3), date: today(), warehouse: wh, category: '', method: 'Full Count', assignedTo: by || '', notes: 'Created from a mobile count', blind: false, status: 'Counting', countStartedAt: new Date().toISOString(),
      createdBy: by || who(), createdAt: new Date().toISOString(), countedBy: '', submittedBy: '', approvedBy: '', postedBy: '', lines: lines };
  }
  function ingestMobile(silent) {
    var u = null; try { u = JSON.parse(localStorage.getItem('loggedInUser') || 'null'); } catch (e) {}
    if (!u || u.demo) return 0;
    var inbox = mobileList(), done = 0, changedInbox = false;
    inbox.forEach(function (sub) {
      if (!sub || sub.applied || !Array.isArray(sub.lines) || !sub.lines.length) return;
      var list = takes(), t = null, created = false, by = sub.by || 'Mobile app';
      if (sub.takeNo) t = list.filter(function (x) { return low(x.no) === low(sub.takeNo); })[0];
      else if (sub.warehouse) {
        var wh = warehouses().filter(function (n) { return low(n) === low(sub.warehouse); })[0];
        if (!wh) { sub.applied = 'rejected'; sub.note = 'Warehouse "' + sub.warehouse + '" was not found in Books.'; changedInbox = true; return; }
        t = list.filter(function (x) { return x.warehouse === wh && (x.status === 'Draft' || x.status === 'Counting'); })[0];
        if (!t) { t = newTakeFor(list, wh, by); created = !!t; }
      }
      if (!t) { sub.applied = 'rejected'; sub.note = sub.takeNo ? 'Stock take ' + sub.takeNo + ' was not found in Books.' : 'No stock take or warehouse to put this count on.'; changedInbox = true; return; }
      if (t.status !== 'Draft' && t.status !== 'Counting') { sub.applied = 'rejected'; sub.note = 'Stock take ' + t.no + ' is ' + t.status + ' and can no longer take a count.'; changedInbox = true; return; }
      var rows = [['Item Name', 'SKU', 'Barcode', 'Physical Qty', 'Remarks']];
      sub.lines.forEach(function (l) { rows.push([l.name || '', l.sku || '', l.barcode || '', l.qty, l.remarks || '']); });
      var from = new Date().toISOString(), res = applyImport(t, { c: { name: 0, sku: 1, barcode: 2, phys: 3, remarks: 4 }, rows: rows, h: 0 });
      t.lines.forEach(function (l) { if (l.countedAt && l.countedAt >= from) l.countedBy = by; });
      if (res.set) t.countedBy = by;
      if (!res.set) { sub.applied = 'rejected'; sub.note = 'None of the counted items matched this stock take.'; changedInbox = true; return; }
      if (t.status === 'Draft') { t.status = 'Counting'; t.countStartedAt = new Date().toISOString(); }
      if (created) { var all = takes(); all.push(t); setTakes(all); } else put(t);
      sub.applied = true; sub.appliedAt = new Date().toISOString(); sub.takeNo = t.no; sub.takeId = t.id; sub.warehouse = t.warehouse;
      sub.matched = res.set; sub.unmatched = res.unmatched.length; sub.viewed = false; sub.note = importNote(res);
      changedInbox = true; done++;
    });
    if (changedInbox) saveMobile(inbox);
    if (done) {
      try { if (typeof w.showNotification === 'function') w.showNotification(done + ' mobile count' + (done === 1 ? '' : 's') + ' received. Open Inventory > Assessment to see the variance.', 'success'); } catch (e) {}
      if (!silent && state.view === 'register' && rootEl() && rootEl().offsetParent !== null) renderRegister();
    }
    return done;
  }
  function mobileBanner() {
    var out = mobileList().filter(function (s) { return s && !s.viewed && (s.applied === true || s.applied === 'rejected'); });
    if (!out.length) return '';
    return '<div class="mb-3 space-y-2">' + out.map(function (s) {
      var ok = s.applied === true;
      return '<div class="flex flex-col md:flex-row md:items-center justify-between gap-2 rounded border p-3 text-sm ' + (ok ? 'bg-green-50 border-green-300 text-green-900' : 'bg-red-50 border-red-300 text-red-800') + '">' +
        '<div><b>' + (ok ? 'Mobile count received' : 'Mobile count not applied') + '</b> &middot; ' + esc(s.by || 'Mobile app') + ' &middot; ' + esc(s.warehouse || '') + (ok ? ' &middot; ' + esc(s.takeNo) + ' &middot; ' + esc(s.matched) + ' item(s) counted' + (s.unmatched ? ', ' + esc(s.unmatched) + ' not found' : '') : '') +
        (ok ? '' : '<div class="text-xs mt-1">' + esc(s.note || '') + '</div>') + '</div>' +
        '<div class="flex gap-2">' + (ok ? '<button class="' + BTN + '" onclick="stMobileView(\'' + esc(s.id) + '\')">View Variance</button>' : '') + '<button class="' + BTN2 + '" onclick="stMobileDismiss(\'' + esc(s.id) + '\')">Dismiss</button></div></div>';
    }).join('') + '</div>';
  }
  function markViewed(id) { var a = mobileList(); a.forEach(function (s) { if (s && s.id === id) s.viewed = true; }); saveMobile(a); }
  w.stMobileDismiss = function (id) { markViewed(id); renderRegister(); };
  w.stMobileView = function (id) {
    var s = mobileList().filter(function (x) { return x && x.id === id; })[0]; markViewed(id);
    if (s && s.takeId && byId(s.takeId)) w.stVariance(s.takeId); else renderRegister();
  };
  w.stIngestMobile = function () { return ingestMobile(false); };
  setTimeout(function () { try { ingestMobile(false); } catch (e) {} }, 5000);
  setInterval(function () { try { if (!document.hidden && mobileList().some(function (s) { return s && !s.applied; })) ingestMobile(false); } catch (e) {} }, 8000);

  /* ---------- mount ---------- */
  setTimeout(function () { var t = $(TAB); if (t && !t.classList.contains('hidden')) render(); }, 800);
  /* Reports > Stock Assessment opens on the register every time */
  var rtries = 0;
  (function hook() {
    if (w.__saRptHooked) return;
    if (typeof w.showReport !== 'function') { if (rtries++ < 40) setTimeout(hook, 500); return; }
    w.__saRptHooked = true; var orig = w.showReport;
    w.showReport = function (id) {
      var r = orig.apply(this, arguments);
      if (id === RPT) { try { state = { view: 'register', id: null, t: null }; render(); } catch (e) { console.error('[stock-assessment report]', e); } }
      return r;
    };
  })();
})(window);
  }
  if (document.readyState === 'complete') acxStockModulesInit(); else window.addEventListener('load', acxStockModulesInit);
})();

/* ===================================================================================
 * Acacia stock: repair + doctor + sync (were acacia-stock-repair.js, acacia-stock-doctor.js, acacia-stock-sync.js).
 * Each part starts once the page and every script have loaded, as the separate files effectively did.
 * =================================================================================== */
;(function () {
  function acxStock_repair() {
/* Acacia Books — targeted Stock / Inventory repair.
   Keeps the existing application and company storage architecture. */
(function (W) {
  "use strict";
  if (W.__acxStockRepair) return;
  W.__acxStockRepair = true;

  var LS = W.localStorage;
  var writing = false;
  var hooked = false;

  function user() {
    try { return JSON.parse(LS.getItem("loggedInUser") || "null"); }
    catch (e) { return null; }
  }

  function companyId() {
    var u = user(), cid = u && String(u.companyId || "").trim();
    if (!cid) return "";
    try {
      var ns = W.__companyNS;
      var active = ns && typeof ns.activeCompany === "function" ? String(ns.activeCompany() || "") : cid;
      if (active && active !== cid) return "";
    } catch (e) { return ""; }
    return cid;
  }

  function norm(v) {
    return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function hasId(item) {
    return !!item && item.id != null && item.id !== "" && typeof item.id !== "object";
  }

  function hash(value) {
    var h = 2166136261, s = String(value), i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function ensureItems(items, warehouse, cid, prior) {
    if (!Array.isArray(items) || !cid) return false;
    var changed = false, used = Object.create(null), priorByName = Object.create(null);
    (Array.isArray(prior) ? prior : []).forEach(function (item) {
      var name = norm(item && item.name);
      if (name && hasId(item)) (priorByName[name] || (priorByName[name] = [])).push(String(item.id));
    });

    items.forEach(function (item) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      var name = norm(item.name), id = hasId(item) ? String(item.id) : "";
      var canonicalWarehouse = String(warehouse || "");
      if (canonicalWarehouse && !String(item.warehouse || "").trim()) {
        item.warehouse = canonicalWarehouse;
        changed = true;
      }
      if (!id && name && priorByName[name] && priorByName[name].length) {
        while (priorByName[name].length && !id) {
          var candidate = priorByName[name].shift();
          if (!used[candidate]) id = candidate;
        }
      }
      if (!id && name) id = "acx-item-" + hash(cid + "|" + String(warehouse || "") + "|" + name);
      if (!id && !name) id = "acx-item-" + hash(cid + "|" + String(warehouse || "") + "|unnamed|" + items.indexOf(item));
      if (used[id]) {
        var suffix = 2, root = id;
        while (used[root + "-" + suffix]) suffix++;
        id = root + "-" + suffix;
      }
      if (String(item.id || "") !== id) {
        item.id = id;
        changed = true;
      }
      used[id] = true;
    });
    return changed;
  }

  W.acxEnsureItemIds = function (items, existing, persist, warehouse) {
    var cid = companyId();
    if (!cid || !Array.isArray(items)) return items;
    ensureItems(items, warehouse || "", cid, existing);
    return items;
  };

  function invalidate() {
    try { W.__invalidateInventoryCache && W.__invalidateInventoryCache(); } catch (e) {}
    try { W.__acxStockChanged && W.__acxStockChanged(); } catch (e) {}
  }

  function ensureWarehouse(warehouse) {
    var cid = companyId();
    if (!cid || !warehouse) return false;
    var key = "inventory_" + warehouse, raw = null, items;
    try { raw = LS.getItem(key); items = raw == null ? null : JSON.parse(raw); }
    catch (e) { return false; }
    if (!Array.isArray(items)) return false;
    if (!ensureItems(items, warehouse, cid, items)) return false;
    writing = true;
    try { LS.setItem(key, JSON.stringify(items)); }
    catch (e) { console.warn("[stock-repair] could not persist item identities", e); }
    finally { writing = false; }
    invalidate();
    return true;
  }

  function hookStorage() {
    var ns = W.__companyNS;
    if (!ns || typeof ns.onSetItem !== "function") return false;
    ns.onSetItem(function (key, value) {
      if (writing || !/^inventory_/.test(String(key || ""))) return;
      var cid = companyId();
      if (!cid) {
        console.error("[stock-repair] blocked company-unscoped inventory processing");
        return;
      }
      var items;
      try { items = JSON.parse(value || "null"); } catch (e) { return; }
      if (!Array.isArray(items)) return;
      var warehouse = String(key).slice("inventory_".length);
      if (!ensureItems(items, warehouse, cid, items)) return;
      writing = true;
      try { LS.setItem(key, JSON.stringify(items)); }
      catch (e) { console.warn("[stock-repair] identity save failed", e); }
      finally { writing = false; }
      invalidate();
    });
    hooked = true;
    return true;
  }

  function wrapInventoryFunctions() {
    if (typeof W.getInventory === "function" && !W.getInventory.__acxCompanyGuard) {
      var getInventory = W.getInventory;
      var guardedGet = function (warehouse) {
        if (!companyId()) return [];
        if (warehouse) ensureWarehouse(warehouse);
        else {
          for (var i = 0; i < LS.length; i++) {
            var key = LS.key(i);
            if (key && key.indexOf("inventory_") === 0) ensureWarehouse(key.slice("inventory_".length));
          }
        }
        return getInventory.apply(this, arguments);
      };
      guardedGet.__acxCompanyGuard = true;
      guardedGet.__acxOriginal = getInventory;
      W.getInventory = guardedGet;
    }

    if (typeof W.saveInventory === "function" && !W.saveInventory.__acxCompanyGuard) {
      var saveInventory = W.saveInventory;
      var guardedSave = function (warehouse, items) {
        var cid = companyId();
        if (!cid) {
          if (typeof W.showNotification === "function") W.showNotification("Select a valid company before saving stock.", "error");
          else W.alert("Select a valid company before saving stock.");
          return false;
        }
        if (!Array.isArray(items)) throw new Error("Inventory must be an array.");
        ensureItems(items, warehouse, cid, null);
        return saveInventory.apply(this, arguments);
      };
      guardedSave.__acxCompanyGuard = true;
      guardedSave.__acxOriginal = saveInventory;
      W.saveInventory = guardedSave;
    }

    if (typeof W.__getAllInventoriesCached === "function" && !W.__getAllInventoriesCached.__acxCompanyGuard) {
      var cachedAll = W.__getAllInventoriesCached;
      var guardedAll = function () {
        if (!companyId()) return [];
        return cachedAll.apply(this, arguments);
      };
      guardedAll.__acxCompanyGuard = true;
      guardedAll.__acxOriginal = cachedAll;
      W.__getAllInventoriesCached = guardedAll;
    }

    if (typeof W.getAllInventories === "function" && !W.getAllInventories.__acxCompanyGuard) {
      var all = W.getAllInventories;
      var guardedGetAll = function () {
        if (!companyId()) return [];
        return all.apply(this, arguments);
      };
      guardedGetAll.__acxCompanyGuard = true;
      guardedGetAll.__acxOriginal = all;
      W.getAllInventories = guardedGetAll;
    }

    if (typeof W.getMergedInventory === "function" && !W.getMergedInventory.__acxCompanyGuard) {
      var merged = W.getMergedInventory;
      var guardedMerged = function () {
        if (!companyId()) return [];
        return merged.apply(this, arguments);
      };
      guardedMerged.__acxCompanyGuard = true;
      guardedMerged.__acxOriginal = merged;
      W.getMergedInventory = guardedMerged;
    }
  }

  function wrapImport() {
    var original = W.importInventoryExcel;
    if (typeof original !== "function" || original.__acxStockCompanyGuard) return false;
    var guarded = function (event) {
      var cid = companyId();
      var input = event && event.target;
      var select = W.document.getElementById("warehouseSelect");
      var warehouse = select && select.value || "";
      var file = input && input.files && input.files[0];
      if (!cid) {
        W.alert("Stock import stopped: sign in to a company before importing inventory.");
        if (input) input.value = "";
        return;
      }
      if (!warehouse) {
        W.alert("Please select a warehouse before importing inventory.");
        if (input) input.value = "";
        return;
      }
      W.__acxStockImportContext = {
        companyId: cid,
        warehouse: warehouse,
        fileName: file && String(file.name || ""),
        token: String(Date.now()) + "-" + hash(cid + "|" + warehouse + "|" + (file && file.name || ""))
      };
      return original.apply(this, arguments);
    };
    guarded.__acxStockCompanyGuard = true;
    guarded.__acxOriginal = original;
    if (original.__syncSafe) guarded.__syncSafe = true;
    if (original.__stockFix) guarded.__stockFix = true;
    W.importInventoryExcel = guarded;
    return true;
  }

  function boot() {
    hookStorage();
    wrapInventoryFunctions();
    wrapImport();
    var cid = companyId();
    if (cid) {
      for (var i = 0; i < LS.length; i++) {
        var key = LS.key(i);
        if (key && key.indexOf("inventory_") === 0) {
          var warehouse = key.slice("inventory_".length);
          ensureWarehouse(warehouse);
        }
      }
    }
    invalidate();
  }

  W.__acxStockRepairStatus = function () {
    var cid = companyId(), count = 0;
    if (cid) {
      for (var i = 0; i < LS.length; i++) {
        var key = LS.key(i);
        if (key && key.indexOf("inventory_") === 0) {
          try {
            var items = JSON.parse(LS.getItem(key) || "[]");
            if (Array.isArray(items)) count += items.length;
          } catch (e) {}
        }
      }
    }
    return { active: !!cid, companyId: cid || null, inventoryItems: count, storageHooked: hooked };
  };

  boot();
  W.addEventListener("acx-idb-ready", boot);
  W.addEventListener("acx:company-changed", boot);
  W.addEventListener("storage", function (event) {
    if (event && event.key === "loggedInUser") setTimeout(boot, 0);
  });
})(window);

  }
  if (document.readyState === "complete") acxStock_repair(); else window.addEventListener("load", acxStock_repair);
})();

;(function () {
  function acxStock_doctor() {
/* acacia-stock-doctor.js - shows why stock does not match between this device and the cloud, and repairs it.
 *
 * Open it:  add  ?stockdoctor=1  to the Books address (e.g. https://acacia-books.vercel.app/?stockdoctor=1)
 *           or run  acxStockDoctor()  in the browser console.
 * Run it on the device that has the FULL stock. It never changes anything until you press a button.
 *   1. Compare   - items on this device vs the cloud, per warehouse (count, size, last saved, differences)
 *   2. Deletion markers - old "deleted" markers for stock items (these made other devices drop items)
 *   3. Repair    - remove stock deletion markers; push this device's stock to the cloud
 * Load LAST in index.html (after acacia-stock-repair.js). */
(function (W) {
  "use strict";
  if (W.__acxStockDoctor) return;
  W.__acxStockDoctor = true;

  var LS = W.localStorage, lastPushErr = "";

  /* remember the last real push error the sync engine reported */
  (function () {
    if (console.__acxDocHook) return;
    var ow = console.warn;
    console.warn = function () {
      try {
        var a = arguments;
        if (String(a[0] || "").indexOf("[companySync] push") === 0 && a[1]) {
          var e = a[1];
          lastPushErr = typeof e === "object" ? ((e.code ? "[" + e.code + "] " : "") + String(e.message || e.details || e.hint || "")) : String(e);
        }
      } catch (x) {}
      return ow.apply(this, arguments);
    };
    console.__acxDocHook = true;
  })();

  function J(k, d) { try { var v = JSON.parse(LS.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function cid() { var u = J("loggedInUser", null); return u && u.companyId ? String(u.companyId) : ""; }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function nm(v) { return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " "); }
  function hdr(x) { var h = { apikey: W.__SUPA_KEY__, Authorization: "Bearer " + W.__SUPA_KEY__ }; for (var k in (x || {})) h[k] = x[k]; return h; }
  var REST = function () { return W.__SUPA_URL__ + "/rest/v1/company_state"; };

  function toList(v) {
    var x = v, n = 0;
    while (typeof x === "string" && n < 4) { try { x = JSON.parse(x); } catch (e) { return null; } n++; }
    return Array.isArray(x) ? x : null;
  }
  function localWarehouses() {
    var out = [];
    for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf("inventory_") === 0) out.push(k); }
    return out.sort();
  }
  function getCloud(key) {
    var url = REST() + "?company_id=eq." + encodeURIComponent(cid()) + "&key=eq." + encodeURIComponent(key) + "&select=value,updated_at&limit=1";
    return fetch(url, { cache: "no-store", headers: hdr() }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { return { error: "HTTP " + r.status + " " + t.slice(0, 160) }; });
      return r.json().then(function (rows) {
        if (!rows.length) return { missing: true };
        var raw = rows[0].value, txt = typeof raw === "string" ? raw : JSON.stringify(raw);
        return { list: toList(raw), kb: Math.round(txt.length / 102.4) / 10, at: rows[0].updated_at, native: typeof raw !== "string" };
      });
    }).catch(function (e) { return { error: "network: " + (e && e.message || e) }; });
  }
  function cloudKeys() {
    var url = REST() + "?company_id=eq." + encodeURIComponent(cid()) + "&key=like." + encodeURIComponent("inventory_*") + "&select=key,updated_at";
    return fetch(url, { cache: "no-store", headers: hdr() }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }

  /* deletion markers that point at stock items */
  function stockMarkers(liveByKey) {
    var t = J("tombstones", {}), dead = 0, onLive = 0, cols = 0;
    Object.keys(t || {}).forEach(function (col) {
      if (col.indexOf("inventory_") !== 0) return;
      cols++;
      var live = liveByKey[col] || {};
      Object.keys(t[col] || {}).forEach(function (id) {
        var e = t[col][id]; if (!e || !e[1]) return;
        dead++;
        if (live[id]) onLive++;
      });
    });
    return { cols: cols, dead: dead, onLive: onLive };
  }

  async function diagnose() {
    var rows = [], liveByKey = {}, keys = localWarehouses();
    var cl = await cloudKeys();
    cl.forEach(function (r) { if (keys.indexOf(r.key) < 0) keys.push(r.key); });
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], loc = J(k, null), lst = Array.isArray(loc) ? loc : null;
      var o = { key: k, wh: k.slice(10), local: lst ? lst.length : null, localKb: lst ? Math.round(JSON.stringify(lst).length / 102.4) / 10 : 0 };
      if (lst) {
        var ids = {}, dupId = 0, noId = 0, sku = {}, live = {};
        lst.forEach(function (it) {
          if (!it) return;
          if (it.id == null || it.id === "") noId++; else { if (ids[it.id]) dupId++; ids[it.id] = 1; live["i:id:" + it.id] = 1; }
          var s = String(it.sku || "").toLowerCase(); if (s) sku[s] = (sku[s] || 0) + 1;
        });
        liveByKey[k] = live; o.noId = noId; o.dupId = dupId;
        o.sharedSku = Object.keys(sku).filter(function (x) { return sku[x] > 1; }).length;
      }
      var c = await getCloud(k); o.cloud = c;
      if (c.list && lst) {
        var byId = {}, byName = {};
        c.list.forEach(function (it) { if (!it) return; if (it.id != null && it.id !== "") byId[it.id] = it; byName[nm(it.name)] = it; });
        var lid = {}, lname = {};
        lst.forEach(function (it) { if (!it) return; if (it.id != null && it.id !== "") lid[it.id] = 1; lname[nm(it.name)] = 1; });
        o.onlyLocal = lst.filter(function (it) { return it && !(it.id != null && byId[it.id]) && !byName[nm(it.name)]; }).length;
        o.onlyCloud = c.list.filter(function (it) { return it && !(it.id != null && lid[it.id]) && !lname[nm(it.name)]; }).length;
        o.qtyDiff = lst.filter(function (it) {
          if (!it) return false; var m = (it.id != null && byId[it.id]) || byName[nm(it.name)];
          return m && Math.abs(num(m.qty) - num(it.qty)) > 0.000001;
        }).length;
      }
      rows.push(o);
    }
    return { rows: rows, markers: stockMarkers(liveByKey), pushErr: lastPushErr, dirty: (function () { try { return Object.keys(W.__companyNS.dirty || {}).filter(function (x) { return /^inventory_/.test(x); }); } catch (e) { return []; } })() };
  }

  /* ---- repairs ---- */
  function clearStockMarkers() {
    var t = J("tombstones", {}), n = 0;
    Object.keys(t).forEach(function (col) { if (col.indexOf("inventory_") === 0) { n += Object.keys(t[col] || {}).length; delete t[col]; } });
    LS.setItem("tombstones", JSON.stringify(t));       /* the normal storage hook marks it for cloud sync */
    try { W.__companySync && W.__companySync.pushDirty && W.__companySync.pushDirty(); } catch (e) {}
    return n;
  }
  /* ---- screen ---- */
  var box;
  function shell() {
    if (box) box.remove();
    box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:12px;font:14px/1.45 system-ui,sans-serif";
    box.innerHTML = '<div style="background:#fff;color:#111;max-width:860px;width:100%;max-height:92vh;overflow:auto;border-radius:12px;padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">Stock sync doctor</b><button id="sdClose" style="border:0;background:none;font-size:22px;cursor:pointer">&times;</button></div>' +
      '<div id="sdBody" style="margin-top:10px">Checking…</div></div>';
    document.body.appendChild(box);
    box.querySelector("#sdClose").onclick = function () { box.remove(); box = null; };
    return box.querySelector("#sdBody");
  }
  function btn(id, label, color) { return '<button id="' + id + '" style="margin:4px 6px 4px 0;padding:8px 12px;border:0;border-radius:8px;background:' + color + ';color:#fff;cursor:pointer;font:600 13px system-ui">' + label + '</button>'; }

  async function open() {
    if (!cid()) { alert("Sign in to a company first."); return; }
    if (!W.__SUPA_URL__ || !W.__SUPA_KEY__) { alert("Cloud is not configured on this page."); return; }
    var body = shell(), d;
    try { d = await diagnose(); } catch (e) { body.textContent = "Could not run the check: " + (e && e.message || e); return; }
    var h = '<div style="color:#555;margin-bottom:8px">Company <b>' + esc(cid()) + '</b>. Run this on the device that has the full stock.</div>';
    h += '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#f3f4f6;text-align:left"><th style="padding:6px">Warehouse</th><th>This device</th><th>Cloud</th><th>Only here</th><th>Only cloud</th><th>Qty differs</th><th>Items w/o id</th></tr>';
    d.rows.forEach(function (o) {
      var c = o.cloud, cs = c.error ? '<span style="color:#b91c1c">' + esc(c.error) + '</span>' : c.missing ? '<span style="color:#b91c1c">no row</span>' :
        !c.list ? '<span style="color:#b91c1c">unreadable format</span>' : c.list.length + " items, " + c.kb + " KB<br><small style='color:#666'>" + esc(String(c.at || "").replace("T", " ").slice(0, 19)) + (c.native ? " · native array" : "") + "</small>";
      h += '<tr style="border-top:1px solid #e5e7eb"><td style="padding:6px">' + esc(o.wh) + '</td><td>' + (o.local == null ? "-" : o.local + " items, " + o.localKb + " KB") + '</td><td>' + cs + '</td><td>' + (o.onlyLocal == null ? "-" : o.onlyLocal) + '</td><td>' + (o.onlyCloud == null ? "-" : o.onlyCloud) + '</td><td>' + (o.qtyDiff == null ? "-" : o.qtyDiff) + '</td><td>' + (o.noId == null ? "-" : o.noId + (o.dupId ? " (+" + o.dupId + " duplicate ids)" : "")) + '</td></tr>';
    });
    h += '</table>';
    h += '<div style="margin-top:12px;padding:10px;border-radius:8px;background:' + (d.markers.onLive ? "#fef2f2" : "#f9fafb") + '"><b>Deletion markers on stock:</b> ' + d.markers.dead + ' marked deleted' +
      (d.markers.onLive ? ' - <b style="color:#b91c1c">' + d.markers.onLive + ' of them point at items that exist on this device. Another device removes those items when it syncs.</b>' : ' (none point at current items)') + '</div>';
    h += '<div style="margin-top:8px;padding:10px;border-radius:8px;background:#f9fafb"><b>Waiting to upload:</b> ' + (d.dirty.length ? esc(d.dirty.join(", ")) : "nothing") + '<br><b>Last upload error:</b> ' + (d.pushErr ? '<span style="color:#b91c1c">' + esc(d.pushErr) + '</span>' : "none seen since this page opened") + '</div>';
    h += '<div style="margin-top:12px">' + btn("sdMark", "1. Remove stock deletion markers", "#7c3aed") + btn("sdAgain", "Check again", "#374151") + '</div>';
    h += '<div id="sdMsg" style="margin-top:8px;color:#374151;white-space:pre-wrap"></div>';
    body.innerHTML = h;
    var msg = body.querySelector("#sdMsg");
    body.querySelector("#sdAgain").onclick = open;
    body.querySelector("#sdMark").onclick = function () { var n = clearStockMarkers(); msg.textContent = "Removed " + n + " stock deletion marker(s) and queued the change for the cloud. The normal sync will upload the change."; };
  }

  W.acxStockDoctor = open;
  if (/[?&]stockdoctor=1/.test(String(location.search))) {
    var n = 0, iv = setInterval(function () { if ((cid() && W.__companySync) || ++n > 60) { clearInterval(iv); if (cid()) setTimeout(open, 1500); } }, 500);
  }
})(window);

  }
  if (document.readyState === "complete") acxStock_doctor(); else window.addEventListener("load", acxStock_doctor);
})();

;(function () {
  function acxStock_sync() {
;(function (W) {
  "use strict";
  /* acacia-stock-sync (wrapper) - stock now syncs through the SAME per-company engine as every other module
   * (window.__companySync in app-3.js). This wrapper only keeps window.acxStockSync / the Stock Sync panel working. */
  if (W.__acxStockSync) return;
  W.__acxStockSync = true;
  var LS = W.localStorage, status = { state: "idle", msg: "", at: 0, byWh: {} };
  function cs() { return W.__companySync || null; }
  function whs() { var o = []; try { for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf("inventory_") === 0) o.push(k.slice(10)); } } catch (e) {} return o.sort(); }
  function set(state, msg) { status.state = state; status.msg = msg || ""; status.at = Date.now(); whs().forEach(function (w) { status.byWh[w] = { state: state, msg: msg || "", at: status.at }; }); try { W.dispatchEvent(new CustomEvent("acx:stock-sync-status", { detail: status })); } catch (e) {} }
  function refresh() { try { W.__invalidateInventoryCache && W.__invalidateInventoryCache(); } catch (e) {}
    ["stTopUp", "renderInventoryTable", "renderInventorySummary", "renderStockValuation", "renderStockReports", "renderPriceListTable"].forEach(function (f) { try { if (typeof W[f] === "function") W[f](); } catch (e) {} }); }
  function syncAll() {
    var c = cs(); if (!c) { set("error", "Cloud sync is not ready"); return Promise.resolve(); }
    set("syncing", "Syncing with the rest of the company data");
    return Promise.resolve().then(function () { return c.pushDirty && c.pushDirty(); })
      .then(function () { return c.pullCompany && c.pullCompany(); })
      .then(function () { refresh(); set("ok", "Synced"); })
      .catch(function (e) { set("error", String(e && e.message || e)); });
  }
  W.acxStockSync = {
    syncNow: syncAll, syncAll: syncAll, status: function () { return status; },
    statusRows: function () { return whs().map(function (w) { return { warehouse: w, status: status.byWh[w] || { state: "pending", msg: "Synced with company data", at: 0 } }; }); }
  };
})(window);

  }
  if (document.readyState === "complete") acxStock_sync(); else window.addEventListener("load", acxStock_sync);
})();


/* ===== merged from acacia-session.js ===== */
/* acacia-session.js - sends the Acacia session token with every Supabase request.
 * Load FIRST in <head> (before supabase-js / any app script). Tokens come from the acx_login RPC. */
(function (w) {
  'use strict';
  if (w.AcxSession) return;
  var BASE = 'https://xglsampckermarjpczdf.supabase.co/rest/v1/';
  var ANON = 'sb_publishable_x-dPR7pzhvJgag9soW0I8w_yfKTmi6A';
  var KEY = 'acx_sessions', MAX = 8, rawFetch = w.fetch;

  function list() { try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(function (t) { return /^[0-9a-f]{64}$/.test(t); }) : []; } catch (e) { return []; } }
  function save(a) { try { if (a.length) localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX))); else localStorage.removeItem(KEY); } catch (e) {} }
  function add(t) { if (!/^[0-9a-f]{64}$/.test(String(t || ''))) return; var a = list().filter(function (x) { return x !== t; }); a.push(t); save(a); }
  function clear(logout) {
    var a = list(); save([]);
    if (logout && rawFetch) a.forEach(function (t) {
      try { rawFetch.call(w, BASE + 'rpc/acx_logout', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: t }), keepalive: true }); } catch (e) {}
    });
  }

  if (rawFetch) w.fetch = function (input, init) {
    try {
      var a = list();
      var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      if (a.length && url.indexOf(BASE) === 0) {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          var h = new Headers(input.headers); h.set('x-acx-session', a.join(',')); input = new Request(input, { headers: h });
        } else {
          init = Object.assign({}, init); var hh = new Headers(init.headers || {}); hh.set('x-acx-session', a.join(',')); init.headers = hh;
        }
      }
    } catch (e) {}
    return rawFetch.call(this, input, init);
  };

  /* Ask the server to check a login. Returns {status:'ok'|'denied'|'missing'|'error', rows:[...]}; rows carry no password fields and one 'session' each.
     Nothing is stored: the caller decides which row to accept and calls add(row.session). */
  var recent = { k: '', t: 0 };
  async function login(email, password, company) {
    try {
      var em = String(email || '').trim().toLowerCase();
      var r = await rawFetch.call(w, BASE + 'rpc/acx_login', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: em, p_password: password, p_company: company || null }) });
      if (r.status === 404) return { status: 'missing', rows: [] };
      if (!r.ok) return { status: 'error', rows: [] };
      var rows = await r.json(); rows = Array.isArray(rows) ? rows : [];
      if (rows.length) recent = { k: em, t: Date.now() };
      return { status: rows.length ? 'ok' : 'denied', rows: rows };
    } catch (e) { return { status: 'network', rows: [] }; }
  }

  /* For apps whose own login runs in the browser (Books): after it succeeds, ask the server for a session. */
  async function start(email, password, company) {
    if (recent.k && recent.k === String(email || '').trim().toLowerCase() && Date.now() - recent.t < 60000) return true;   /* login() just did this */
    try {
      var r = await rawFetch.call(w, BASE + 'rpc/acx_login', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: String(email || '').trim().toLowerCase(), p_password: password, p_company: company || null }) });
      if (!r.ok) return false;
      var rows = await r.json(); if (!Array.isArray(rows) || !rows.length) return false;
      rows.forEach(function (x) { if (x && x.session) add(x.session); });
      return true;
    } catch (e) { return false; }
  }

  /* Books: check the password on the server first. Only when acx_login is missing or unreachable does it use the old
     'fallback' (which reads the account row). Returns the account data to merge into the local users list, or null. */
  async function accountFirst(email, company, fallback) {
    var pass = ''; try { pass = String((w.document.getElementById('loginPass') || {}).value || '').trim(); } catch (e) {}
    if (!pass) return fallback();
    var res = await login(email, pass, company);
    if (res.status === 'missing' || res.status === 'network') return fallback();
    if (res.status !== 'ok') return null;
    var row = res.rows[0];
    if (company && w.acxCompanyMatches) {
      var m = res.rows.filter(function (x) { var d = Object.assign({}, x.data || {}); d.companyId = d.companyId || x.company_id; return w.acxCompanyMatches(d, company); })[0];
      if (m) row = m;
    }
    var u = Object.assign({}, row.data || {}); u.companyId = u.companyId || row.company_id;
    /* the server just confirmed this password, so keep a salted hash of it on this device for the app's own local check */
    var sb = new Uint8Array(16); w.crypto.getRandomValues(sb);
    var salt = Array.prototype.map.call(sb, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    var dig = await w.crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pass));
    u.passwordHash = Array.prototype.map.call(new Uint8Array(dig), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    u.passwordSalt = salt; delete u.password;
    if (row.session) add(row.session);
    return u;
  }

  w.AcxSession = { add: add, list: list, clear: clear, start: start, login: login, accountFirst: accountFirst };
})(window);

/* HTML helpers used by the escaping done in app-1/2/3.js. They are defined here because this file loads first. */
(function (w) {
  if (!w.__invEsc) w.__invEsc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  /* for fields that may hold formatted text (notes, terms, descriptions): keep simple formatting, drop scripts, handlers and unsafe links */
  w.__acxClean = function (v) {
    if (v == null) return ''; v = String(v);
    if (!/[<&]/.test(v)) return v;
    try {
      var d = new DOMParser().parseFromString('<body>' + v + '</body>', 'text/html');
      d.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,svg,math,template').forEach(function (n) { n.remove(); });
      d.querySelectorAll('*').forEach(function (el) {
        Array.prototype.slice.call(el.attributes).forEach(function (a) {
          var n = a.name.toLowerCase(), val = a.value;
          if (n.indexOf('on') === 0 || n === 'srcdoc' || n === 'formaction' || ((n === 'href' || n === 'src' || n === 'action' || n === 'xlink:href') && !/^\s*(https?:|mailto:|tel:|#|\/|data:image\/(png|jpe?g|gif|webp);)/i.test(val))) el.removeAttribute(a.name);
        });
      });
      return d.body.innerHTML;
    } catch (e) { return w.__invEsc(v); }
  };
})(window);



/* ===== merged from acacia-hub-drafts.js ===== */
/* Acacia Books — unified draft registers for Sales, Purchase, Funds, Accounting and Payroll.
   Inventory is intentionally excluded from the central draft register. */
(function () {
  "use strict";
  var HUBS = {
    sales: {
      title: "Sales Hub Drafts", tab: "invoicesTab",
      keys: /invoice|sales|quote|order|creditnote|credit_note|delivery|receipt|customerpayment|bulkInvoiceDrafts|recurringinvoice/i
    },
    purchase: {
      title: "Purchase Hub Drafts", tab: "supplierBillsTab",
      keys: /purchase|supplier|bill|grn|goodsreceived|debitnote|debit_note|purchasereturn|bulkBill|recurringpayment/i
    },
    funds: {
      title: "Funds Hub Drafts", tab: "bankAccountsTab",
      keys: /fund|bank|cash|payment|receipt|deposit|withdraw|transferfund|expense|income|pettycash|reconcil/i
    },
    accounting: {
      title: "Accountant Hub Drafts", tab: "manualJournalsTab",
      keys: /journal|account|equity|liabilit|asset|taxadjust|taxpayment|transactiondraft|operationalcost|budget|currencyadjust|chartofaccount/i
    },
    payroll: {
      title: "Payroll Hub Drafts", tab: "employeesTab",
      keys: /payroll|employee|payslip|grosspay|earnings|deduction|statutory|attendance|leave|overtime|salary|wage/i
    }
  };
  var KEY_HUBS = {
    sales: ["bulkInvoiceDrafts","invoiceDrafts","creditNoteDrafts","salesReturnDrafts","deliveryDrafts","invoices","bulkInvoices","quotes","orders","salesOrders","creditNotes","salesReturns","deliveries","receipts","customerPayments","recurringInvoices"],
    purchase: ["bulkBills","bills","supplierBills","purchaseOrders","purchaseOrderDrafts","grns","supplierDebitNotes","purchaseReturns","supplierQuotes","supplierDrafts","purchaseReturnDrafts","recurringBills","recurringPayments","billPayments"],
    funds: ["banks","bankMappings","bankAccounts","bankDrafts","funds","cashAccounts","cashTransactions","bankTransfers","fundTransfers","deposits","withdrawals","expenses","incomeRecords","pettyCash","receipts","customerPayments","supplierPayments","billPayments","paymentsMade","bankReconciliations"],
    accounting: ["manualJournalDraft","recurringJournalDraft","journalEntries","manualJournals","recurringJournals","manualTransactions","operationalCosts","equityRecords","currentAccounts","directorAccount","budgets","budgetHistory","budgetVariance","taxAdjustments","taxPayments","currencyAdjustments","chartOfAccountsDrafts","nonCurrentLiabilityDraft"],
    payroll: ["payrollDrafts","payrollRuns","payrollRecords","payslipDrafts","payslips","grossPayroll","earnings","deductions","statutoryDeductions","attendance","leaveRecords","overtime","employeeDrafts","salaryAdvances"]
  };
  var current = "sales";
  function parse(v) { try { return JSON.parse(v); } catch (_) { return null; } }
  function isDraft(v) {
    if (!v || typeof v !== "object") return false;
    if (v.isDraft === true || v.__isDraft === true) return true;
    var s = v.status || v.state || v.documentStatus || v.transactionStatus || "";
    return /^\s*draft\s*$/i.test(String(s));
  }
  function classify(haystack) {
    var s = String(haystack || "").toLowerCase();
    if (/payroll|payslip|grosspay|earnings|deduction|statutory|attendance|leave|overtime|salary|wage|employee/.test(s)) return "payroll";
    if (/fund|bank|cash|payment|receipt|deposit|withdraw|pettycash|reconcil|expense|income/.test(s)) return "funds";
    if (/journal|accounting|accountant|manualtransaction|taxadjust|taxpayment|equity|liabilit|asset|operationalcost|budget|currencyadjust|chartofaccount/.test(s)) return "accounting";
    if (/purchase|supplier|bill|grn|goodsreceived|debitnote|purchasereturn|recurringpayment/.test(s)) return "purchase";
    if (/invoice|sales|quote|creditnote|delivery|receipt|customerpayment|salesreturn|bulkorder/.test(s)) return "sales";
    return "";
  }
  function recordHint(v) {
    if (!v || typeof v !== "object") return "";
    return [v.type,v.documentType,v.module,v.source,v.category,v.section,v.sec,v.table,v.scope,v.label,v.name,v.description,v.hub,v.area].join(" ");
  }
  function nameOf(v, key) {
    if (v && typeof v === "object") {
      var fields = ["name","itemName","productName","customerName","supplierName","description","invoiceNumber","invoiceNo","invoiceNoBase","billNumber","orderNumber","reference","referenceNo","number","no","id"];
      for (var i=0;i<fields.length;i++) if (v[fields[i]] != null && typeof v[fields[i]] !== "object" && String(v[fields[i]]).trim()) return String(v[fields[i]]);
      if (Array.isArray(v.customers) && v.customers.length) return "Bulk invoice — " + v.customers.join(", ");
      if (Array.isArray(v.items) && v.items.length) return (v.items[0].name || v.items[0].itemName || "Draft document") + (v.items.length > 1 ? " +" + (v.items.length-1) + " items" : "");
    }
    return key || "Untitled draft";
  }
  function typeOf(key, v) {
    var s = (key + " " + recordHint(v)).toLowerCase();
    if (/invoice/.test(s)) return "Invoice";
    if (/quote/.test(s)) return "Quotation";
    if (/purchase.?order|supplierpurchaseorder/.test(s)) return "Purchase Order";
    if (/order/.test(s)) return "Sales Order";
    if (/bill/.test(s)) return "Purchase Bill";
    if (/journal/.test(s)) return "Journal Entry";
    if (/transfer/.test(s)) return "Stock Transfer";
    if (/assembly|bundle/.test(s)) return "Assembly / Bundle";
    if (/shipment/.test(s)) return "Shipment";
    if (/adjust/.test(s)) return "Adjustment";
    if (/cost/.test(s)) return "Costing";
    if (/credit/.test(s)) return "Credit Note";
    if (/debit/.test(s)) return "Debit Note";
    if (/receipt/.test(s)) return "Receipt";
    if (/delivery/.test(s)) return "Delivery";
    if (/bank/.test(s)) return "Bank Reconciliation";
    if (/asset|liabilit|equity/.test(s)) return "Accounting Entry";
    if (/inventory|stock|item/.test(s)) return "Inventory";
    return (v && (v.type || v.documentType)) || "Saved Draft";
  }
  function routeFor(key, v) {
    var s = (key + " " + recordHint(v)).toLowerCase();
    if (/quote/.test(s)) return "quotesTab";
    if (/purchase.?order|supplierpurchaseorder/.test(s)) return "supplierPurchaseOrdersTab";
    if (/order/.test(s)) return /purchase|supplier/.test(s) ? "supplierPurchaseOrdersTab" : "ordersTab";
    if (/bill|purchase|supplier/.test(s)) return "supplierBillsTab";
    if (/journal|transactiondraft|accounting/.test(s)) return "manualJournalsTab";
    if (/transfer|movement/.test(s)) return "movementTab";
    if (/bundle|assembly/.test(s)) return "BundleItems";
    if (/shipment/.test(s)) return "shipmentsTab";
    if (/cost/.test(s)) return "inventoryTab";
    if (/credit/.test(s)) return "creditNoteTab";
    if (/debit/.test(s)) return "supplierDebitNotesTab";
    if (/delivery/.test(s)) return "deliveryTab";
    if (/receipt/.test(s)) return "receiptsTab";
    if (/invoice|sales/.test(s)) return "invoicesTab";
    return HUBS[current].tab;
  }
  function add(out, key, index, record, hub, meta) {
    var id = record && record.id != null ? String(record.id) : "";
    var token = key + "|" + String(index) + "|" + id;
    if (out.some(function (x) { return x.token === token; })) return;
    var date = record && (record.date || record.createdAt || record.updatedAt || record.transactionDate || record.when || record.at) || "";
    var amount = record && (record.total || record.amount || record.grandTotal || record.netAmount || record.balance || "") || "";
    out.push({
      token: token, key: key, index: index, record: record, hub: hub, meta: meta || "",
      type: typeOf(key, record), name: nameOf(record, key), date: date,
      amount: amount, status: "Draft"
    });
  }
  function getDrafts(hub) {
    var out = [];
    for (var i=0; i<localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key) continue;
      var data = parse(localStorage.getItem(key));
      if (data == null) continue;

      /* Generic form drafts created by the universal Save as Draft buttons. */
      if (key === "acxUniversalDrafts" && Array.isArray(data)) {
        data.forEach(function (v, n) {
          var h = v && (v.hub || v.moduleHub) || classify(recordHint(v) + " " + String(v && v.sec || ""));
          if (!h && v && v.sec) { var sec = String(v.sec).toLowerCase(); if (/payroll|employee|payslip|attendance|earnings/.test(sec)) h = "payroll"; else if (/fund|bank|cash|payment|receipt/.test(sec)) h = "funds"; else if (/journal|account|asset|equity|liabilit|tax|budget/.test(sec)) h = "accounting"; else if (/purchase|supplier|bill|grn/.test(sec)) h = "purchase"; else if (/invoice|sales|quote|order|credit|delivery/.test(sec)) h = "sales"; }
          if (h === hub) add(out,key,n,v,h,"universal");
        });
        continue;
      }

      var keyHub = "";
      Object.keys(KEY_HUBS).some(function (h) {
        if (KEY_HUBS[h].some(function (k) { return k.toLowerCase() === key.toLowerCase(); }) || HUBS[h].keys.test(key)) {
          keyHub = h; return true;
        }
        return false;
      });
      var list = Array.isArray(data) ? data : null;
      if (list) {
        list.forEach(function (v,n) {
          if (!v || typeof v !== "object") return;
          var h = keyHub || classify(recordHint(v));
          if (h !== hub) return;
          if (isDraft(v) || /draft/i.test(key)) add(out,key,n,v,h,"array");
        });
      } else if (data && typeof data === "object") {
        /* Single-record draft keys (e.g. manualJournalDraft) and maps (e.g. bankDrafts). */
        if (isDraft(data) || /draft/i.test(key)) {
          if (keyHub === hub || classify(recordHint(data)) === hub) add(out,key,"",data,keyHub || hub,"single");
        } else if (/draft/i.test(key)) {
          Object.keys(data).forEach(function (subkey) {
            var v = data[subkey];
            if (v && typeof v === "object" && (keyHub === hub || classify(recordHint(v)) === hub)) add(out,key,subkey,v,keyHub || hub,"map");
          });
        }
      }
    }
    return out;
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});
  }
  function showTab(tab) {
    if (typeof window.showTab === "function") window.showTab(tab);
    else {
      var el = document.getElementById(tab);
      if (el) { document.querySelectorAll('[id$="Tab"]').forEach(function(n){n.classList.add("hidden");}); el.classList.remove("hidden"); }
    }
  }
  window.acxOpenHubDrafts = function(hub) {
    if (!HUBS[hub]) hub = "sales";
    current = hub;
    showTab("acxHubDraftsTab");
    var title = document.getElementById("acxDraftsTitle");
    if (title) title.textContent = HUBS[hub].title;
    window.acxRefreshHubDrafts();
  };
  window.acxRefreshHubDrafts = function() {
    Object.keys(HUBS).forEach(function(h) {
      var el = document.getElementById("acxDraftCount-" + h);
      if (el) { var n = getDrafts(h).length; el.textContent = n ? "(" + n + ")" : ""; }
    });
    var body = document.getElementById("acxHubDraftRows");
    if (!body) return;
    var rows = getDrafts(current);
    body.innerHTML = rows.length ? rows.map(function(d,i) {
      return '<tr class="border-b hover:bg-gray-50">' +
        '<td class="p-2">'+esc(d.type)+'</td><td class="p-2 font-medium">'+esc(d.name)+'</td>' +
        '<td class="p-2">'+esc(d.date ? String(d.date).slice(0,10) : "—")+'</td>' +
        '<td class="p-2">'+esc(d.amount || "—")+'</td>' +
        '<td class="p-2"><span class="inline-block rounded-full bg-amber-50 text-amber-800 px-2 py-1 text-xs font-semibold">DRAFT</span></td>' +
        '<td class="p-2 whitespace-nowrap"><button class="text-blue-800 font-semibold mr-3" onclick="acxContinueDraft('+i+')">Continue Editing</button>' +
        (d.meta === "universal" ? '<button class="bg-blue-900 text-white px-2 py-1 rounded text-xs mr-2" onclick="acxCompleteUniversalDraft(\''+esc(d.record.id)+'\')">Complete</button>' : '') +
        '<button class="text-red-700" onclick="acxDeleteHubDraft('+i+')">Delete</button></td></tr>';
    }).join("") : '<tr><td colspan="6" class="p-6 text-center text-gray-500">No drafts found in this hub yet. Save unfinished work as Draft in a module and it will appear here.</td></tr>';
  };
  window.acxContinueDraft = function(i) {
    var d = getDrafts(current)[i];
    if (!d) return;
    if (d.meta === "universal") {
      var sec = d.record && d.record.sec;
      if (sec && document.getElementById(sec)) showTab(sec);
      else showTab(HUBS[current].tab);
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("data-acx-edit", d.record.id);
      b.style.display = "none"; document.body.appendChild(b); b.click(); b.remove();
      return;
    }
    showTab(routeFor(d.key,d.record));
    if (d.key === "manualJournalDraft" && typeof window.restoreJournalDraft === "function") window.restoreJournalDraft();
    if (d.key === "bulkInvoiceDrafts" && d.record) {
      var r = d.record;
      function set(id,val) { var el=document.getElementById(id); if(el && val!=null) { el.value=val; el.dispatchEvent(new Event("change",{bubbles:true})); } }
      set("bulkInvoiceDate",r.date); set("bulkInvoiceNumber",r.invoiceNoBase); set("bulkInvoiceNetDays",r.netDays);
      set("bulkInvoiceCurrency",r.currency); set("bulkInvoiceCurrencyRate",r.rate); set("bulkChartAccountSelect",r.account); set("bulkInvoiceSalesPerson",r.salesPerson);
      var customers=document.getElementById("bulkInvoiceCustomers");
      if(customers && Array.isArray(r.customers)) Array.from(customers.options).forEach(function(o){o.selected=r.customers.indexOf(o.value)>=0;});
      try { window.bulkInvoiceItems = Array.isArray(r.items) ? JSON.parse(JSON.stringify(r.items)) : []; if(typeof window.renderBulkInvoiceItems==="function") window.renderBulkInvoiceItems(); if(typeof window.calculateBulkInvoiceTotals==="function") window.calculateBulkInvoiceTotals(); } catch(e) {}
    }
  };
  window.acxDeleteHubDraft = function(i) {
    var d = getDrafts(current)[i];
    if (!d || !window.confirm("Delete this saved draft? This cannot be undone.")) return;
    var data = parse(localStorage.getItem(d.key));
    if (d.meta === "universal") {
      var all = Array.isArray(data) ? data : [];
      localStorage.setItem(d.key,JSON.stringify(all.filter(function(x){return String(x.id)!==String(d.record.id);})));
    } else if (Array.isArray(data)) {
      data.splice(Number(d.index),1); localStorage.setItem(d.key,JSON.stringify(data));
    } else if (d.meta === "map") {
      delete data[d.index]; localStorage.setItem(d.key,JSON.stringify(data));
    } else {
      localStorage.removeItem(d.key);
    }
    window.acxRefreshHubDrafts();
  };

  /* Refresh immediately after native module save actions write to localStorage. */
  try {
    if (!Storage.prototype.__acxDraftRefreshHook) {
      var originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) {
        var result = originalSet.apply(this,arguments);
        if (this === window.localStorage && typeof window.acxRefreshHubDrafts === "function") window.acxRefreshHubDrafts();
        return result;
      };
      var originalRemove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function(k) {
        var result = originalRemove.apply(this,arguments);
        if (this === window.localStorage && typeof window.acxRefreshHubDrafts === "function") window.acxRefreshHubDrafts();
        return result;
      };
      Storage.prototype.__acxDraftRefreshHook = true;
    }
  } catch(e) {}
  window.addEventListener("storage",function(){window.acxRefreshHubDrafts();});
  document.addEventListener("DOMContentLoaded",function(){window.acxRefreshHubDrafts();});
  setInterval(function(){ if (typeof window.acxRefreshHubDrafts === "function") window.acxRefreshHubDrafts(); },2500);
})();



/* ===== merged from acacia-inventory-cleanup.js ===== */
/* Acacia Books — remove Inventory Hub Drafts and Packing Slips UI. */
(function () {
  "use strict";
  var running = false;
  function norm(value) { return String(value || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function removeNode(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }
  function clean() {
    if (running || !document.body) return;
    running = true;
    try {
      var nav = document.getElementById("inventorySubmenu");
      if (nav) Array.prototype.slice.call(nav.querySelectorAll("button,a,[role=menuitem],li")).forEach(function (el) {
        var t = norm(el.innerText || el.textContent);
        if (/^(drafts?|packing slips?)$/.test(t) || /packing.?slips?/.test(t)) removeNode(el.tagName === "LI" ? el : (el.closest("li") || el));
      });
      var inventory = document.getElementById("inventoryTab");
      if (inventory) {
        Array.prototype.slice.call(inventory.querySelectorAll("button,a,[role=button],table,[id],[data-section]")).forEach(function (el) {
          var id = norm(el.id);
          var label = norm(el.innerText || el.textContent);
          if (/^(save as draft|open drafts|inventory drafts|packing slips?)$/.test(label) ||
              /(inventory.?drafts?|packing.?slips?)/.test(id) ||
              /(packing.?slips?)/.test(label)) removeNode(el);
        });
        Array.prototype.slice.call(inventory.querySelectorAll('button[onclick*="saveDraft"],button[onclick*="openInventoryDraft"],button[onclick*="packingSlip"]')).forEach(removeNode);
      }
      Array.prototype.slice.call(document.querySelectorAll('[id*="packingSlip" i],[id*="packing-slips" i],[id*="inventoryDraft" i],[id*="stockDraft" i],[data-module="inventory-drafts" i],button[onclick*="packingSlip"],a[href*="packingSlip"]')).forEach(removeNode);
      var draftTabs = document.getElementById("acxDraftHubTabs");
      if (draftTabs) Array.prototype.slice.call(draftTabs.querySelectorAll("button")).forEach(function (el) {
        if (/inventory/i.test(el.innerText || el.textContent)) removeNode(el);
      });
    } catch (e) { console.warn("[acacia-inventory-cleanup]", e); }
    running = false;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", clean);
  else clean();
  if (window.MutationObserver) {
    var observer = new MutationObserver(function () { clean(); });
    function observe() { if (document.body) observer.observe(document.body, { childList: true, subtree: true }); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
    else observe();
  }
  window.addEventListener("load", clean);
})();



/* ===== merged from acacia-plan-sidebar.js ===== */
/* acacia-plan-sidebar.js - the sidebar only shows what the company's plan (and the user's role) includes.
 *
 * Why it was not working: filterSidebarByRole() looked for showTab('x') with SINGLE quotes, but the sidebar buttons are
 * written showTab("x") with double quotes, so no button ever matched and nothing was hidden.
 *
 * What this does:
 *   - hides every sidebar item whose module is not in the plan (Free / Starter / Pro / Business / Enterprise / All Access)
 *     or not allowed for the signed-in user's role;
 *   - hides a whole hub (Inventory Hub, Sales Hub ...) when none of its items are available;
 *   - keeps Dashboard and Plans always visible, so a company can always upgrade;
 *   - re-checks by itself when the plan, role or modules change (for example after an upgrade);
 *   - blocks opening a locked module by any other route (it also adds the plan test to acxCanOpenTab).
 * Load LAST in index.html. */
(function (W) {
  "use strict";
  if (W.__acxPlanSidebar) return;
  W.__acxPlanSidebar = true;

  var ORDER = ["free", "starter", "pro", "business", "enterprise", "all_access"];
  var ALWAYS = { dashboard: 1, plansTab: 1 };           /* never hidden */
  var KEEP_GROUPS = { plansSubmenu: 1 };

  function user() { try { return JSON.parse(localStorage.getItem("loggedInUser") || "null"); } catch (e) { return null; } }
  function companyPlan(u) {
    try {
      var id = String((u && u.companyId) || ""), list = JSON.parse(localStorage.getItem("companies") || "[]") || [];
      var c = list.filter(function (x) { return String(x.companyId || "") === id; })[0];
      return c && c.plan ? c.plan : "";
    } catch (e) { return ""; }
  }
  function planIndex(u) {
    var p = (u && u.plan) || companyPlan(u) || localStorage.getItem("selectedPlan") || "";
    var n = String(p).toLowerCase().replace(/[\s-]+/g, "_");
    if (n === "allaccess") n = "all_access";
    return ORDER.indexOf(n);                               /* -1 = unknown plan: do not filter by plan */
  }
  /* same rule the app already uses: an unregistered admin sees everything */
  function planApplies(u) { return !(u && String(u.role || "").toLowerCase() === "admin" && !u.registered); }
  function access() { try { return typeof submoduleAccess !== "undefined" ? submoduleAccess : null; } catch (e) { return null; } }

  /* does the plan include this module? */
  function planSees(tab, pi, sa) {
    if (ALWAYS[tab]) return true;
    sa = sa || access();
    if (!sa || pi < 0 || !Object.prototype.hasOwnProperty.call(sa, tab)) return true;
    var row = sa[tab];
    return !Array.isArray(row) || row[pi] !== false;
  }
  /* plan AND role/user permission */
  function canSee(tab, u) {
    if (ALWAYS[tab]) return true;
    if (planApplies(u) && !planSees(tab, planIndex(u))) return false;
    try { if (!origCanOpen(tab)) return false; } catch (e) {}
    return true;
  }

  var origCanOpen = typeof W.acxCanOpenTab === "function" ? W.acxCanOpenTab : function () { return true; };
  /* the same plan test when a module is opened by any other route (a link, a button, the quick-create menu) */
  W.acxCanOpenTab = function (tab) {
    if (!origCanOpen(tab)) return false;
    var u = user();
    return !planApplies(u) || planSees(tab, planIndex(u));
  };

  function tabOf(btn) {
    var m = String(btn.getAttribute("onclick") || "").match(/showTab\(\s*["']([^"']+)["']/);
    return m ? m[1] : "";
  }
  function setHidden(btn, hide) {
    var li = btn.closest ? btn.closest("li") : null;
    btn.classList.toggle("hidden", hide);
    if (li && li.querySelectorAll("button").length === 1) {
      if (hide) { li.setAttribute("data-acx-plan-hid", "1"); li.style.display = "none"; }
      else if (li.getAttribute("data-acx-plan-hid")) { li.removeAttribute("data-acx-plan-hid"); li.style.removeProperty("display"); }
    }
  }

  function apply() {
    var u = user(), sb = document.getElementById("sidebar");
    if (!u || !sb) return;
    /* 1. individual modules */
    var tabs = sb.querySelectorAll("button[onclick]");
    Array.prototype.forEach.call(tabs, function (b) {
      var id = tabOf(b); if (!id) return;
      setHidden(b, !canSee(id, u));
    });
    /* 2. hubs with nothing left inside */
    Array.prototype.forEach.call(sb.querySelectorAll("button[onclick]"), function (b) {
      var m = String(b.getAttribute("onclick") || "").match(/toggleSubmenu\(\s*["']([^"']+)["']/);
      if (!m || KEEP_GROUPS[m[1]]) return;
      var ul = document.getElementById(m[1]); if (!ul) return;
      var any = false;
      Array.prototype.forEach.call(ul.querySelectorAll("button[onclick]"), function (c) {
        var id = tabOf(c);
        if (id && !c.classList.contains("hidden")) any = true;
        else if (!id) any = true;                          /* a button that is not a module link: keep the hub */
      });
      setHidden(b, !any);
      if (!any) ul.classList.add("hidden");
    });
  }

  W.filterSidebarByRole = apply;                           /* the app calls this after sign-in */

  /* re-check when plan / role / modules change, and when the sidebar is (re)drawn */
  var last = "";
  function sig() { var u = user() || {}; return [u.plan, u.role, u.registered, JSON.stringify(u.modules || null), localStorage.getItem("selectedPlan"), localStorage.getItem("customModules")].join("|"); }
  function tick() { var s = sig(); if (s !== last) { last = s; try { apply(); } catch (e) { console.warn("[plan-sidebar]", e); } } }
  setInterval(tick, 1500);
  document.addEventListener("DOMContentLoaded", function () { setTimeout(function () { last = ""; tick(); }, 800); });
  W.addEventListener("storage", function () { tick(); });
  setTimeout(function () { last = ""; tick(); }, 1200);

  W.acxPlanSidebar = { apply: apply, planSees: planSees, planIndex: planIndex, canSee: canSee };
})(window);



/* ===== merged from workflow-rules.js ===== */
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
    invoices: 'Invoices', recurringInvoices: 'Recurring Invoices', bulkInvoices: 'Bulk Invoices',
    receipts: 'Receipts', customerPayments: 'Customer Payments', payments: 'Customer Payments',
    customers: 'Customers', quotes: 'Quotations', quotations: 'Quotations', quoteToInvoice: 'Quotations',
    orders: 'Sales Orders', deliveries: 'Delivery', deliveryOrders: 'Delivery',
    creditNotes: 'Credit Notes', salesReturns: 'Sales Returns',
    bills: 'Supplier Bills', supplierBills: 'Supplier Bills', bulkBills: 'Bulk Bills',
    purchaseOrders: 'Purchase Orders', goodsReceived: 'Goods Received', grns: 'Goods Received',
    supplierPayments: 'Supplier Payments', billPayments: 'Supplier Payments', purchaseReturns: 'Purchase Returns',
    supplierDebitNotes: 'Supplier Debit Notes', supplierQuotes: 'Supplier Quotations', suppliers: 'Suppliers',
    inventory: 'Inventory', stock: 'Inventory', products: 'Products', services: 'Services',
    stockActivities: 'Stock Activity', movements: 'Stock Movements', transfers: 'Stock Transfers',
    stockCounts: 'Stock Counts', warehouses: 'Warehouses', packages: 'Packages', bundles: 'Bundles', shipments: 'Shipments',
    transactions: 'Bank Transactions', banks: 'Banking Accounts', bankAccounts: 'Banking Accounts',
    manualTransactions: 'Bank Transactions', currentAccTransactions: 'Bank Transactions',
    expenses: 'Expenses', expenseClaims: 'Expense Claims', operationalCosts: 'Expenses',
    payrollRecords: 'Payroll', payrollPayments: 'Payroll Payments', employees: 'Employees', attendance: 'Attendance',
    journalEntries: 'Journals', manualJournals: 'Manual Journals', recurringJournals: 'Recurring Journals',
    taxPayments: 'Tax Payments', taxAdjustments: 'Tax Adjustments',
    chartOfAccounts: 'Chart of Accounts', budgets: 'Budgets', projects: 'Projects',
    otherIncomes: 'Other Income', assetDepreciationEvents: 'Asset Depreciation',
    customerDrafts: 'Customer Drafts', supplierDrafts: 'Supplier Drafts',
    writeOffs: 'Write-offs', amendments: 'Amendments',
    assetFiles: 'Fixed Assets', assetApprovalLogs: 'Asset Approvals', assetDepreciationEvents: 'Asset Depreciation',
    bankDrafts: 'Banking Drafts', bankMappings: 'Bank Mappings', branches: 'Branches',
    batchTracking: 'Batch Tracking', damagedStock: 'Damaged Stock', expiredItems: 'Expired Stock',
    budgets: 'Budgets', budgetData: 'Budgets', budgetHistory: 'Budget History', budgetVariance: 'Budget Variance',
    projects: 'Projects', projectExpenses: 'Project Expenses', projectRevenue: 'Project Revenue',
    projectProgress: 'Project Progress', projectTimeline: 'Project Timeline',
    attendance: 'Attendance', overtimeSummary: 'Overtime', actuals: 'Actuals', progressUpdates: 'Project Updates',
    userActivities: 'User Activity', auditLogs: 'Audit Logs', notifications: 'Notifications', systemAlerts: 'System Alerts',
    financialRecords: 'Financial Records', currentAccounts: 'Current Accounts', equityRecords: 'Equity Records',
    otherIncomes: 'Other Income', shareholderEquity: 'Shareholder Equity', writeOffLogs: 'Write-off Logs'
  };
  var seenModuleLabels = Object.create(null);
  var triggerModules = Object.keys(moduleMap).filter(function (key) { var label = moduleMap[key]; if (seenModuleLabels[label]) return false; seenModuleLabels[label] = true; return true; }).map(function (key) { return { key: key, label: moduleMap[key] }; });
  var operators = [
    ['equals', 'Equals'], ['not_equals', 'Does not equal'], ['contains', 'Contains'],
    ['not_contains', 'Does not contain'], ['greater_than', 'Greater than'],
    ['greater_or_equal', 'Greater than or equal'], ['less_than', 'Less than'],
    ['less_or_equal', 'Less than or equal'], ['is_empty', 'Is empty'], ['is_not_empty', 'Is not empty']
  ];
  var actionTypes = [
    ['task', 'Create follow-up task'], ['reminder', 'Create reminder'],
    ['notification', 'Create in-app notification'], ['review', 'Add to review queue'],
    ['set_status', 'Update triggering record status']
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
  function me() { try { return JSON.parse(W.localStorage.getItem('loggedInUser') || W.localStorage.getItem('currentUser') || 'null') || {}; } catch (e) { return {}; } }
  function companyId() {
    var user = me(), selected = '';
    try { selected = W.localStorage.getItem('currentCompanyId') || W.localStorage.getItem('lastCompanyId') || ''; } catch (e) {}
    return String(selected || user.companyId || user.company_id || user.company || '');
  }
  function scoped(list) { var cid = companyId(); return (Array.isArray(list) ? list : []).filter(function (item) { return String(item.companyId || '') === cid; }); }
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
  function performAction(action, rule, record, moduleName, eventType, dryRun, storageKey, recordIndex) {
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
    } else if (action.type === 'set_status') {
      if (eventType === 'deleted') throw new Error('A deleted record cannot have its status updated.');
      var nextStatus = String(action.statusValue || '').trim();
      if (!nextStatus) throw new Error('Enter a new status for the status-update action.');
      var key = storageKey || rule.moduleKey, records = read(key, null);
      if (!Array.isArray(records)) throw new Error('The triggering module data could not be located for a status update.');
      var recordId = identity(record, Number(recordIndex || 0)), found = false;
      records = records.map(function (item, index) {
        if (identity(item, index) !== recordId) return item;
        found = true; var updated = Object.assign({}, item, { status: interpolate(nextStatus, record, moduleName, eventType), updatedAt: stamp() }); return updated;
      });
      if (!found) throw new Error('The triggering record could not be found for a status update.');
      write(key, records);
    }
    return { type: action.type, title: title, success: true };
  }
  function execute(event) {
    if (!event || !event.moduleKey || !event.record) return;
    var rules = read(RULES_KEY, []);
    rules.forEach(function (rule) {
      if (!rule || !rule.enabled || rule.moduleKey !== event.moduleKey || rule.eventType !== event.type) return;
      if (String(rule.companyId || '') !== companyId()) return;
      if (!passes(rule, event.record)) return;
      var results = [];
      try {
        (rule.actions || []).forEach(function (action) { results.push(performAction(action, rule, event.record, event.moduleName, event.type, false, event.storageKey, event.recordIndex)); });
        rule.lastRunAt = stamp(); rule.lastRunStatus = 'Success'; rule.runCount = Number(rule.runCount || 0) + 1;
        pushRun({ id: uid('RUN'), ruleId: rule.id, ruleName: rule.name, module: event.moduleName, event: event.type, recordId: event.record.id || event.record._id || event.record.number || '', status: 'Success', createdAt: stamp(), companyId: companyId(), actions: results });
      } catch (error) {
        rule.lastRunAt = stamp(); rule.lastRunStatus = 'Failed';
        pushRun({ id: uid('RUN'), ruleId: rule.id, ruleName: rule.name, module: event.moduleName, event: event.type, recordId: event.record.id || event.record._id || event.record.number || '', status: 'Failed', error: error.message, createdAt: stamp(), companyId: companyId(), actions: results });
        console.error('[Acacia Workflow] Rule execution failed:', error);
      }
    });
    write(RULES_KEY, rules);
    renderIfOpen();
  }
  function emit(moduleKey, type, record, oldRecord, storageKey, recordIndex) {
    var event = { id: uid('EVT'), moduleKey: moduleKey, moduleName: moduleMap[moduleKey] || moduleKey, type: type, record: record || {}, oldRecord: oldRecord || null, storageKey: storageKey || moduleKey, recordIndex: Number(recordIndex || 0), createdAt: stamp() };
    W.dispatchEvent(new CustomEvent('acx:workflow:event', { detail: event }));
    execute(event);
  }
  W.acxWorkflowEmit = emit;

  function parseArray(value) { try { var parsed = JSON.parse(value || 'null'); return Array.isArray(parsed) ? parsed : null; } catch (e) { return null; } }
  function identity(record, index) { return String(record && (record.id || record._id || record.uuid || record.invoiceNumber || record.billNumber || record.number || record.sku || record.name) || ('index-' + index)); }
  function detectStorageChange(key, before, after) {
    var moduleKey = moduleMap[key] ? key : null;
    if (!moduleKey) {
      var aliases = Object.keys(moduleMap).sort(function (a, b) { return b.length - a.length; });
      for (var ai = 0; ai < aliases.length; ai++) {
        if (key.indexOf(aliases[ai] + '_') === 0 || key.indexOf(aliases[ai] + ':') === 0 || key.indexOf(aliases[ai] + '-') === 0) { moduleKey = aliases[ai]; break; }
      }
    }
    if (!moduleKey && /^inventory([:_-]|$)/i.test(key)) moduleKey = 'inventory';
    if (!moduleKey && /^stockActivities([:_-]|$)/i.test(key)) moduleKey = 'stockActivities';
    if (!moduleKey && /^stockCounts([:_-]|$)/i.test(key)) moduleKey = 'stockCounts';
    if (!moduleKey && /^warehouses([:_-]|$)/i.test(key)) moduleKey = 'warehouses';
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
      recentEvents[dedupe] = Date.now(); emit(moduleKey, type, record, old || null, key, index);
    });
    oldList.forEach(function (record, index) {
      var id = identity(record, index); if (newById[id]) return;
      var dedupe = key + ':' + id + ':deleted';
      if (recentEvents[dedupe] && Date.now() - recentEvents[dedupe] < 350) return;
      recentEvents[dedupe] = Date.now(); emit(moduleKey, 'deleted', record, record, key, index);
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
      if (W.Storage && W.Storage.prototype && !W.Storage.prototype.removeItem.__acxWorkflowWrapped) {
        var nativeRemove = W.Storage.prototype.removeItem;
        var removeWrapped = function (key) {
          var before = null;
          try { if (this === W.localStorage) before = this.getItem(String(key)); } catch (e) {}
          var result = nativeRemove.call(this, key);
          if (this === W.localStorage && !internalWrite && before != null) { try { detectStorageChange(String(key), before, null); } catch (e) { console.warn('[Acacia Workflow] Delete event detection:', e); } }
          return result;
        };
        removeWrapped.__acxWorkflowWrapped = true;
        W.Storage.prototype.removeItem = removeWrapped;
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
    return true;
  }
  function optionList(options, selected) { return options.map(function (option) { return '<option value="' + esc(option[0]) + '"' + (option[0] === selected ? ' selected' : '') + '>' + esc(option[1]) + '</option>'; }).join(''); }
  function statusPill(status) { return '<span class="wf-chip" style="' + (status === 'Failed' ? 'background:#fef2f2;color:#b91c1c' : status === 'Disabled' ? 'background:#f1f5f9;color:#64748b' : 'background:#ecfdf5;color:#047857') + '">' + esc(status) + '</span>'; }
  function metric(label, value, note) { return '<div class="wf-card" style="padding:14px"><div class="wf-muted">' + esc(label) + '</div><div style="font-size:24px;font-weight:800;margin-top:5px">' + esc(value) + '</div><div class="wf-muted" style="margin-top:3px">' + esc(note) + '</div></div>'; }
  function render() {
    var tab = D.getElementById('workflowRulesTab'); if (!tab) return;
    var rules = scoped(read(RULES_KEY, [])), runs = scoped(read(RUNS_KEY, [])), tasks = scoped(read(TASKS_KEY, [])), reminders = scoped(read(REMINDERS_KEY, [])), notices = scoped(read(NOTICES_KEY, [])), reviews = scoped(read(REVIEWS_KEY, []));
    var active = rules.filter(function (rule) { return rule.enabled; }).length;
    var failed = runs.filter(function (run) { return run.status === 'Failed'; }).length;
    var lastRun = runs[0] ? new Date(runs[0].createdAt).toLocaleString() : 'No executions yet';
    tab.innerHTML = '<div style="max-width:1500px;margin:0 auto">' +
      '<div class="wf-row" style="justify-content:space-between;margin-bottom:18px"><div><div style="font-size:22px;font-weight:800;color:#111827">Workflow Rules</div><div class="wf-muted" style="margin-top:4px">Run company-scoped rules across Sales, Purchases, Inventory, Banking, Expenses, Payroll, Projects and other connected modules.</div></div><button class="wf-btn primary" data-wf="new">＋ Create Workflow</button></div>' +
      '<div class="wf-grid" style="margin-bottom:16px">' + metric('Total workflows', rules.length, 'Saved rules') + metric('Active workflows', active, 'Currently enabled') + metric('Tasks & reminders', tasks.length + reminders.length, 'Created by workflows') + metric('Execution failures', failed, lastRun) + '</div>' +
      '<div class="wf-card" style="padding:15px;margin-bottom:15px"><div class="wf-row" style="justify-content:space-between"><div><div style="font-weight:800;font-size:14px">How automation works</div><div class="wf-muted" style="margin-top:4px">Acacia watches supported module data changes across the website, checks the active company’s rules, evaluates conditions and runs the selected actions. You can also connect custom screens with acxWorkflowEmit().</div></div><span class="wf-chip">Company-scoped rules</span></div><div class="wf-row" style="margin-top:12px;gap:8px"><span class="wf-chip">1. Trigger</span><span class="wf-muted">→</span><span class="wf-chip">2. Conditions</span><span class="wf-muted">→</span><span class="wf-chip">3. Actions</span><span class="wf-muted">→</span><span class="wf-chip">4. Execution log</span></div></div>' +
      '<div class="wf-card" style="overflow:hidden;margin-bottom:15px"><div class="wf-row" style="justify-content:space-between;padding:14px 15px"><div><div style="font-weight:800;font-size:14px">Your workflows</div><div class="wf-muted">Manage, test and monitor automation rules</div></div><div class="wf-row"><input id="wfSearch" class="wf-input" style="width:210px" placeholder="Search workflows"><select id="wfFilter" class="wf-select" style="width:140px"><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option></select></div></div><div style="overflow:auto"><table class="wf-table"><thead><tr><th>Workflow</th><th>Trigger</th><th>Actions</th><th>Last run</th><th>Status</th><th>Manage</th></tr></thead><tbody id="wfRulesBody"></tbody></table></div></div>' +
      '<div class="wf-card" style="padding:15px;margin-bottom:15px"><div class="wf-row" style="justify-content:space-between"><div><div style="font-weight:800;font-size:14px">Workflow-created work</div><div class="wf-muted">Tasks, reminders, notifications and review items generated by your rules.</div></div><span class="wf-chip">' + (tasks.length + reminders.length + notices.length + reviews.length) + ' items</span></div><div class="wf-grid" style="margin-top:12px"><div><div class="wf-muted">Follow-up tasks</div><b>' + tasks.length + '</b></div><div><div class="wf-muted">Reminders</div><b>' + reminders.length + '</b></div><div><div class="wf-muted">Notifications</div><b>' + notices.length + '</b></div><div><div class="wf-muted">Review queue</div><b>' + reviews.length + '</b></div></div><div class="wf-row" style="margin-top:12px"><button class="wf-btn" data-wf="tasks">View tasks</button><button class="wf-btn" data-wf="reminders">View reminders</button><button class="wf-btn" data-wf="reviews">View review queue</button><button class="wf-btn" data-wf="notifications">View notifications</button></div></div>' +
      '<div class="wf-card" style="overflow:hidden"><div style="padding:14px 15px;border-bottom:1px solid #eef0f3"><div style="font-weight:800;font-size:14px">Recent execution history</div><div class="wf-muted">Every matched rule execution is recorded here.</div></div><div style="overflow:auto"><table class="wf-table"><thead><tr><th>Time</th><th>Workflow</th><th>Module</th><th>Event</th><th>Record</th><th>Result</th></tr></thead><tbody id="wfRunsBody"></tbody></table></div></div>' +
      '</div>';
    renderRulesTable(); renderRunsTable();
  }
  function renderRulesTable() {
    var body = D.getElementById('wfRulesBody'); if (!body) return;
    var rules = scoped(read(RULES_KEY, [])), search = (D.getElementById('wfSearch') || {}).value || '', filter = (D.getElementById('wfFilter') || {}).value || 'all';
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
    var runs = scoped(read(RUNS_KEY, [])).slice(0, 30);
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
      (action.type === 'task' || action.type === 'reminder' ? '<div class="wf-row" style="margin:5px 0 10px 0;padding-left:4px"><label class="wf-muted">Due in days <input class="wf-input" style="width:75px;display:inline-block" type="number" min="0" max="365" data-action-days="' + index + '" value="' + esc(action.dueDays == null ? 1 : action.dueDays) + '"></label>' + (action.type === 'task' ? '<label class="wf-muted">Priority <select class="wf-select" style="width:110px;display:inline-block" data-action-priority="' + index + '">' + optionList([['Low', 'Low'], ['Normal', 'Normal'], ['High', 'High']], action.priority || 'Normal') + '</select></label>' : '') + '</div>' : '') +
      (action.type === 'set_status' ? '<div class="wf-row" style="margin:5px 0 10px 0;padding-left:4px"><label class="wf-muted">New record status <input class="wf-input" style="width:190px;display:inline-block" data-action-status="' + index + '" placeholder="e.g. Approved" value="' + esc(action.statusValue || '') + '"></label><span class="wf-muted">Updates the status field on the triggering record.</span></div>' : '');
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
      '<div style="margin-top:18px"><div class="wf-row" style="justify-content:space-between"><div><b style="font-size:13px">Actions</b><div class="wf-muted">Choose what Acacia should do when all trigger conditions are met. Status updates change the triggering record in its source module.</div></div><button class="wf-btn" data-wf="add-action">＋ Add action</button></div><div id="wfActions">' + actions.map(actionMarkup).join('') + '</div></div>' +
      '<div style="padding:12px;background:#f8fafc;border-radius:8px;margin-top:16px"><b style="font-size:12px">Available placeholders</b><div class="wf-muted" style="margin-top:4px">Use {{name}}, {{id}}, {{status}}, {{customer}}, {{total}}, {{balance}}, {{number}}, {{module}}, {{event}} and {{date}} in action titles and descriptions. The exact fields available depend on the selected module.</div></div>' +
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
      return { type: type, title: (D.querySelector('[data-action-title="' + index + '"]') || {}).value || '', description: (D.querySelector('[data-action-description="' + index + '"]') || {}).value || '', dueDays: Number((D.querySelector('[data-action-days="' + index + '"]') || {}).value || 1), priority: (D.querySelector('[data-action-priority="' + index + '"]') || {}).value || 'Normal', statusValue: (D.querySelector('[data-action-status="' + index + '"]') || {}).value || '' };
    });
    if (!acts.length) { toast('Add at least one action.', 'error'); return null; }
    if (acts.some(function (action) { return action.type === 'set_status' && !String(action.statusValue || '').trim(); })) { toast('Enter the new status for every status-update action.', 'error'); return null; }
    return { name: name.trim(), description: (D.getElementById('wfDescription').value || '').trim(), moduleKey: moduleKey, eventType: D.getElementById('wfEvent').value, conditionMode: D.getElementById('wfConditionMode').value, conditions: conds, actions: acts, enabled: D.getElementById('wfEnabled').value === 'true' };
  }
  function saveRule() {
    var data = collectBuilder(); if (!data) return;
    var rules = read(RULES_KEY, []), existing = rules.filter(function (rule) { return rule.id === currentEdit; })[0];
    if (existing) Object.assign(existing, data, { companyId: companyId(), updatedAt: stamp() });
    else rules.unshift(Object.assign({ id: uid('WF'), createdAt: stamp(), createdBy: me().username || me().email || 'System', companyId: companyId(), runCount: 0 }, data));
    write(RULES_KEY, rules); toast(existing ? 'Workflow updated.' : 'Workflow created.'); render();
  }
  function testRule(id) {
    var rule = read(RULES_KEY, []).filter(function (item) { return item.id === id; })[0]; if (!rule) return;
    var records = read(rule.moduleKey, []);
    if (!Array.isArray(records) && rule.moduleKey === 'inventory') records = [];
    if (!Array.isArray(records)) records = [];
    records = records.filter(function (record) { return !record.companyId || String(record.companyId) === companyId(); });
    var sample = records[0] || { id: 'SAMPLE-001', name: 'Sample record', status: 'Open', total: 1000, balance: 500, customer: 'Sample Customer' };
    var matched = passes(rule, sample);
    var previews = matched ? (rule.actions || []).map(function (action) { return performAction(action, rule, sample, moduleMap[rule.moduleKey], rule.eventType, true, rule.moduleKey); }) : [];
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
    var list = scoped(read(item[0], []));
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
    actions = actions.map(function (action, index) { return { type: (D.querySelector('[data-action-type="' + index + '"]') || {}).value || action.type, title: (D.querySelector('[data-action-title="' + index + '"]') || {}).value || '', description: (D.querySelector('[data-action-description="' + index + '"]') || {}).value || '', dueDays: Number((D.querySelector('[data-action-days="' + index + '"]') || {}).value || 1), priority: (D.querySelector('[data-action-priority="' + index + '"]') || {}).value || 'Normal', statusValue: (D.querySelector('[data-action-status="' + index + '"]') || {}).value || action.statusValue || '' }; });
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
    var activeCompany = companyId();
    if (activeCompany) { var savedRules = read(RULES_KEY, []), migrated = false; savedRules.forEach(function (rule) { if (!rule.companyId) { rule.companyId = activeCompany; migrated = true; } }); if (migrated) write(RULES_KEY, savedRules); }
    var tab = D.getElementById('workflowRulesTab');
    tab.addEventListener('click', handleClick);
    tab.addEventListener('input', handleInput);
    tab.addEventListener('change', handleInput);
    render();
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})(window, document);



/* ===== merged from acacia-multicurrency.js ===== */
/* Acacia Books — Multi-currency accounting layer
 * Backwards-compatible transaction metadata, historical FX snapshots and FX exposure reports.
 * Existing transaction amounts are never rewritten by this module.
 */
(function () {
  'use strict';
  if (window.__acxMultiCurrencyLoaded) return;
  window.__acxMultiCurrencyLoaded = true;
  var VERSION = 2;
  var KEYS = { history: 'acxExchangeRateHistory', audit: 'acxFxAudit', settings: 'exchangeRates' };
  var TX_KEYS = ['invoices','bills','quotes','supplierQuotes','purchaseOrders','creditNotes','creditNoteDrafts','receipts','customerPayments','billPayments','payments','manualJournals','journalEntries'];
  var busy = false;
  function read(k, fallback) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; } catch (_) { return fallback; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('[Acacia FX] storage write failed', k, e); } }
  function base() { try { return String(localStorage.getItem('appBaseCurrency') || (read('orgInfo', {}) || {}).baseCurrency || 'KES').replace(/"/g,'').toUpperCase(); } catch (_) { return 'KES'; } }
  function norm(c) { c = String(c || base()).trim().toUpperCase(); return c === 'KSH' || c === 'KSHS' ? 'KES' : c; }
  function round(n, dp) { var p = Math.pow(10, dp == null ? 6 : dp); return Math.round((Number(n) + Number.EPSILON) * p) / p; }
  function rates() { var r = read(KEYS.settings, {}) || {}; if (!r || typeof r !== 'object' || Array.isArray(r)) r = {}; var b = base(); r[b] = 1; return r; }
  function rate(c, date) {
    c = norm(c); if (c === base()) return 1;
    var h = read(KEYS.history, []), best = null, target = String(date || new Date().toISOString()).slice(0,10);
    for (var i=0;i<h.length;i++) { var x=h[i]; if (x && x.baseCurrency === base() && x.currency === c && String(x.effectiveDate || '').slice(0,10) <= target && Number(x.rate)>0 && (!best || String(x.effectiveDate)>String(best.effectiveDate) || (String(x.effectiveDate)===String(best.effectiveDate) && String(x.capturedAt||'')>String(best.capturedAt||'')))) best=x; }
    if (best) return Number(best.rate);
    var currencyHistory = h.filter(function(x){return x && x.baseCurrency===base() && x.currency===c && Number(x.rate)>0;});
    if (currencyHistory.length) {
      var first = currencyHistory.reduce(function(a,x){return String(x.effectiveDate)<String(a.effectiveDate)?x:a;},currencyHistory[0]);
      if (target < String(first.effectiveDate||'').slice(0,10)) return null;
    }
    var v = Number(rates()[c]); return v > 0 ? v : null;
  }
  function convert(amount, from, to, fxDate, explicitRate) {
    amount = Number(amount); if (!isFinite(amount)) return 0;
    from = norm(from); to = norm(to || base());
    if (from === to) return amount;
    var rf = from === base() ? 1 : (explicitRate > 0 && from !== base() && to === base() ? Number(explicitRate) : rate(from, fxDate));
    var rt = to === base() ? 1 : rate(to, fxDate);
    if (!(rf > 0 && rt > 0)) return null;
    return amount * rf / rt;
  }
  function snapshot(c, fxDate, explicit) {
    c = norm(c); var v = c === base() ? 1 : Number(explicit) > 0 ? Number(explicit) : rate(c, fxDate);
    if (!(v > 0)) return null;
    return { currency:c, baseCurrency:base(), rate:v, effectiveDate:String(fxDate || new Date().toISOString()).slice(0,10), capturedAt:new Date().toISOString(), source: explicit ? 'transaction' : 'rate-table' };
  }
  function amountOf(o) {
    if (!o) return 0;
    var candidates = ['foreignTotal','totalForeign','totalAmount','total','amount','subtotal'];
    for (var i=0;i<candidates.length;i++) { var n=Number(o[candidates[i]]); if (isFinite(n) && n !== 0) return n; }
    return 0;
  }
  function annotate(o, key) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    var sourceInvoice = (key === 'creditNotes' || key === 'creditNoteDrafts') && o.invoiceId ? (read('invoices',[]).find(function(x){return String(x.id)===String(o.invoiceId)||String(x.invoiceNumber)===String(o.invoiceId);}) || null) : null;
    var c = norm(o.currency || o.transactionCurrency || (sourceInvoice && sourceInvoice.currency) || ((key === 'quotes' || key === 'creditNotes' || key === 'creditNoteDrafts') ? selected(key === 'quotes' ? 'quote' : 'credit') : base()));
    var date = o.date || o.invoiceDate || o.billDate || o.createdAt || new Date().toISOString();
    var ex = Number(o.exchangeRate || o.currencyRate || o.fxRate || (sourceInvoice && sourceInvoice.exchangeRate) || ((key === 'quotes' || key === 'creditNotes' || key === 'creditNoteDrafts') ? selectedRate(key === 'quotes' ? 'quote' : 'credit') : 0));
    var snap = snapshot(c, date, ex);
    if (!snap) { o.fxStatus = 'rate-required'; return o; }
    o.currency = c; o.transactionCurrency = c;
    if (!(Number(o.exchangeRate)>0)) o.exchangeRate = snap.rate;
    o.baseCurrency = base();
    o.fxSnapshot = o.fxSnapshot || snap;
    var foreign = amountOf(o);
    if (key === 'bills') {
      // Legacy bills store total in base currency and subtotal/VAT in transaction currency.
      var legacyForeign = Number(o.subtotal || 0) + Number(o.vat || 0);
      if (legacyForeign > 0) { foreign = legacyForeign; o.foreignTotal = round(legacyForeign); o.baseTotal = Number(o.total) || round(legacyForeign * snap.rate); }
    } else if (key === 'invoices') {
      o.foreignTotal = Number(o.foreignTotal || o.total || 0);
      o.baseTotal = Number(o.totalKES || o.baseTotal || (Number(o.foreignTotal) * snap.rate));
    } else {
      o.foreignTotal = Number(o.foreignTotal || foreign || 0);
      o.baseTotal = Number(o.baseTotal || (o.foreignTotal * snap.rate));
    }
    o.fxStatus = 'captured';
    return o;
  }
  function appendHistory() {
    var c = base(), r = rates(), h = read(KEYS.history, []), today = new Date().toISOString().slice(0,10);
    Object.keys(r).forEach(function (cur) {
      var v = Number(r[cur]); if (!(v>0)) return;
      var found = h.some(function (x) { return x && x.baseCurrency===c && x.currency===cur && x.effectiveDate===today && Number(x.rate)===v; });
      if (!found) h.push({baseCurrency:c,currency:cur,rate:v,effectiveDate:today,capturedAt:new Date().toISOString(),source:'settings'});
    });
    if (h.length > 12000) h = h.slice(-12000);
    write(KEYS.history,h);
  }
  function recordAudit(action, data) { var a=read(KEYS.audit,[]); a.push({id:'FX-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),action:action,at:new Date().toISOString(),baseCurrency:base(),data:data||{}}); if(a.length>5000)a=a.slice(-5000);write(KEYS.audit,a); }
  function normalizeArray(key, value) {
    if (!Array.isArray(value)) return value;
    var changed=false, out=value.map(function (o) { if (!o || typeof o!=='object') return o; var before=JSON.stringify(o);
      if (['receipts','customerPayments','billPayments','payments'].indexOf(key)>=0) {
        var inv=read('invoices',[]), bills=read('bills',[]), ref=o.invoiceId||o.billId||o.documentId||o.linkedDocumentId;
        var linked=(inv||[]).find(function(d){return d&&(String(d.id)===String(ref)||String(d.invoiceNumber)===String(ref));}) || (bills||[]).find(function(d){return d&&(String(d.id)===String(ref)||String(d.billNumber)===String(ref));});
        if(linked){o.currency=o.currency||o.billCurrency||linked.currency||base();o.transactionCurrency=o.currency;o.exchangeRate=Number(o.exchangeRate||o.payRate||o.billRate||linked.exchangeRate||linked.currencyRate||1);o.baseCurrency=base();o.linkedFxSnapshot=linked.fxSnapshot||snapshot(linked.currency||base(),linked.date,linked.exchangeRate||linked.currencyRate);}
      }
      if (['receipts','customerPayments','billPayments','payments'].indexOf(key)>=0) {
        /* Payment schemas differ across modules. Preserve their amount fields; only attach a dated FX snapshot. */
        var pc=norm(o.currency||o.transactionCurrency||(o.linkedFxSnapshot&&o.linkedFxSnapshot.currency)||base());
        var pd=o.date||o.paymentDate||o.createdAt||new Date().toISOString();
        var pr=Number(o.exchangeRate||o.payRate||o.billRate||0);
        var ps=snapshot(pc,pd,pr);
        if(ps){o.currency=pc;o.transactionCurrency=pc;o.exchangeRate=Number(o.exchangeRate||ps.rate);o.baseCurrency=base();o.fxSnapshot=o.fxSnapshot||ps;o.fxStatus='captured';}
      } else annotate(o,key);
      if(before!==JSON.stringify(o))changed=true; return o; });
    return changed ? out : value;
  }
  function installStorageHook() {
    if (Storage.prototype.__acxFxHook) return;
    var nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && !busy && TX_KEYS.indexOf(String(key)) >= 0) {
        try { var parsed=JSON.parse(value); if(Array.isArray(parsed)){busy=true;value=JSON.stringify(normalizeArray(String(key),parsed));} } catch (_) {} finally { busy=false; }
      }
      var result=nativeSet.call(this,key,value);
      if (this===localStorage && key===KEYS.settings && !busy) { try { appendHistory(); } catch(e){} }
      return result;
    };
    Storage.prototype.__acxFxHook = true;
  }
  function ensureControl(container, id, label, selected) {
    if (!container || container.querySelector('[data-acx-fx="'+id+'"]')) return;
    var wrap=document.createElement('div'); wrap.className='mt-3 p-3 rounded-lg border'; wrap.style.cssText='border-color:#dbe3f2;background:#f8faff;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;';
    var cur=document.createElement('label'); cur.style.cssText='font-size:12px;font-weight:700;color:#1e3a8a'; cur.textContent='Currency';
    var sel=document.createElement('select'); sel.setAttribute('data-acx-fx',id); sel.style.cssText='display:block;width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:7px;background:white;color:#0f172a';
    var r=rates(), keys=Object.keys(r).filter(function(k){return Number(r[k])>0;}); if(keys.indexOf(base())<0)keys.unshift(base()); keys.sort();
    keys.forEach(function(k){var op=document.createElement('option');op.value=k;op.textContent=k;sel.appendChild(op)}); sel.value=selected||base();
    cur.appendChild(sel);
    var rateLabel=document.createElement('label');rateLabel.style.cssText='font-size:12px;font-weight:700;color:#1e3a8a';rateLabel.textContent='Rate (1 '+sel.value+' = '+base()+')';
    var rateInput=document.createElement('input');rateInput.type='number';rateInput.step='0.000001';rateInput.min='0.000001';rateInput.value=rate(sel.value)||1;rateInput.style.cssText='display:block;width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:7px;background:white;color:#0f172a';rateInput.setAttribute('data-acx-fx-rate',id);rateLabel.appendChild(rateInput);
    sel.addEventListener('change',function(){rateLabel.firstChild.textContent='Rate (1 '+sel.value+' = '+base()+')';rateInput.value=rate(sel.value)||'';});
    wrap.appendChild(cur);wrap.appendChild(rateLabel);container.appendChild(wrap);
  }
  function addQuoteAndCreditControls() {
    var q=document.getElementById('quoteDate'); if(q)ensureControl(q.closest('.space-y-4')||q.parentElement.parentElement,'quote','Quote currency',base());
    var c=document.getElementById('creditDate'); if(c)ensureControl(c.closest('.space-y-4')||c.parentElement.parentElement,'credit','Credit note currency',base());
    var sq=document.getElementById('quoteSupplier'); if(sq && document.getElementById('quoteDate')) { /* shared quote IDs are scoped by active tab */ }
  }
  function selected(id) { var e=document.querySelector('[data-acx-fx="'+id+'"]'); return e ? norm(e.value) : base(); }
  function selectedRate(id) { var e=document.querySelector('[data-acx-fx-rate="'+id+'"]'); var n=e?Number(e.value):rate(selected(id)); return n>0?n:rate(selected(id)); }
  function decorateFormData(key, doc) {
    if(!doc || typeof doc!=='object')return doc;
    var id=key==='quotes'?'quote':key==='creditNotes'?'credit':null;
    if(id){doc.currency=selected(id);doc.exchangeRate=selectedRate(id)||1;}
    annotate(doc,key);return doc;
  }
  function patchSave(name,key,kind) {
    var original=window[name]; if(typeof original!=='function'||original.__acxFxWrapped)return false;
    var wrapped=function(){
      var before=read(key,[]), beforeJson=Array.isArray(before)?before.map(function(x){return JSON.stringify(x)}):[];
      var result=original.apply(this,arguments);
      try {
        var list=read(key,[]);
        if(Array.isArray(list)&&list.length){
          var target=-1;
          for(var i=0;i<list.length;i++) if(beforeJson[i]!==JSON.stringify(list[i])) target=i;
          if(target<0 && list.length>beforeJson.length) target=list.length-1;
          if(target<0 && (name==='saveQuote'||name==='saveQuoteDraft') && typeof window.editingQuoteIndex==='number' && window.editingQuoteIndex>=0) target=window.editingQuoteIndex;
          if(target<0 && (name==='saveCreditNote'||name==='saveCreditNoteDraft') && window.editingCreditNoteId!=null) target=list.findIndex(function(x){return String(x.id)===String(window.editingCreditNoteId);});
          if(target>=0&&list[target]){decorateFormData(key,list[target]);write(key,list);}
        }
      }catch(e){console.warn('[Acacia FX] post-save',name,e)}
      return result;
    };
    wrapped.__acxFxWrapped=true;wrapped.__acxOriginal=original;window[name]=wrapped;return true;
  }
  function patchSaves() {
    patchSave('saveQuote','quotes'); patchSave('saveQuoteDraft','quotes');
    patchSave('saveCreditNote','creditNotes'); patchSave('saveCreditNoteDraft','creditNoteDrafts');
    patchSave('saveSupplierQuote','supplierQuotes'); patchSave('savePurchaseOrder','purchaseOrders');
    [['editQuote','quotes','quote'],['editCreditNote','creditNotes','credit']].forEach(function(x){
      var f=window[x[0]]; if(typeof f!=='function'||f.__acxFxWrapped)return;
      var w=function(i){var r=f.apply(this,arguments);addQuoteAndCreditControls();var a=read(x[1],[]),d;
        if(x[0]==='editQuote') d=a[Number(i)];
        else d=a.find(function(v){return String(v.id)===String(i);});
        if(d){var el=document.querySelector('[data-acx-fx="'+x[2]+'"]'),rateEl=document.querySelector('[data-acx-fx-rate="'+x[2]+'"]');
          if(el){var wanted=norm(d.currency||base());if(!Array.from(el.options).some(function(o){return o.value===wanted})){var op=document.createElement('option');op.value=wanted;op.textContent=wanted;el.appendChild(op);}el.value=wanted;}
          if(rateEl)rateEl.value=Number(d.exchangeRate||1);
        }return r;};
      w.__acxFxWrapped=true;window[x[0]]=w;
    });
  }
  function exposure() {
    var b=base(), now=new Date().toISOString().slice(0,10), inv=read('invoices',[]), bills=read('bills',[]), ar={},ap={}, rows=[];
    function add(map,c,foreign,baseBook,type,ref) { c=norm(c); if(c===b||!isFinite(foreign)||foreign<=0)return; map[c]=(map[c]||0)+foreign; var current=convert(foreign,c,b,now); if(current==null)return; rows.push({type:type,reference:ref,currency:c,foreign:foreign,bookBase:baseBook,currentBase:round(current,2),unrealised:round(current-baseBook,2)}); }
    inv.forEach(function(x){var ex=Number(x.exchangeRate||1),book=Number(x.balance);if(!isFinite(book))book=Number(x.baseBalanceDue);if(!isFinite(book))book=(x.paid===true||String(x.status||'').toLowerCase()==='paid')?0:Math.max(0,Number(x.totalKES||x.baseTotal||0)-Number(x.amountPaid||x.basePaidAmount||0));var bal=Number(x.foreignBalance);if(!isFinite(bal))bal=ex>0?Math.max(0,book/ex):0;add(ar,x.currency||b,bal,book,'Receivable',x.invoiceNumber||x.id);});
    bills.forEach(function(x){var ex=Number(x.exchangeRate||x.currencyRate||1),book=Number(x.balance);if(!isFinite(book))book=Number(x.baseBalanceDue);if(!isFinite(book))book=(String(x.status||'').toLowerCase()==='paid')?0:Math.max(0,Number(x.baseTotal||x.total||0)-Number(x.amountPaid||x.paidAmount||x.basePaidAmount||0));var foreign=Number(x.foreignBalance);if(!isFinite(foreign))foreign=ex>0?Math.max(0,book/ex):0;add(ap,x.currency||b,foreign,book,'Payable',x.billNumber||x.id);});
    return {baseCurrency:b,asOf:now,receivables:ar,payables:ap,openItems:rows,totalUnrealisedGain:round(rows.reduce(function(s,x){return s+Math.max(0,x.unrealised);},0),2),totalUnrealisedLoss:round(rows.reduce(function(s,x){return s+Math.max(0,-x.unrealised);},0),2),netUnrealised:round(rows.reduce(function(s,x){return s+x.unrealised;},0),2)};
  }
  function realised() {
    var invoices=read('invoices',[]), bills=read('bills',[]), payments=read('customerPayments',[]).concat(read('receipts',[]),read('billPayments',[]),read('payments',[])), sum=0, items=[], seen={};
    payments.forEach(function(p){
      if(!p || p.openingBalance || p.source==='fundsTransaction' && !p.invoiceId && !p.billId && !p.billNumber) return;
      var id=p.invoiceId||p.billId||p.documentId, doc=invoices.find(function(d){return String(d.id)===String(id)||String(d.invoiceNumber)===String(id);}), kind='Receivable';
      if(!doc){doc=bills.find(function(d){return String(d.id)===String(id)||String(d.billNumber)===String(id)||String(d.billNumber)===String(p.billNumber);});kind='Payable';}
      if(!doc && p.billIndex!=null) { doc=bills[Number(p.billIndex)]; kind='Payable'; }
      if(!doc)return;
      var dedupe=String(p.id||'')+'|'+String(doc.id||doc.invoiceNumber||doc.billNumber); if(seen[dedupe])return; seen[dedupe]=1;
      var c=norm(doc.currency||base()), original=Number(doc.exchangeRate||doc.currencyRate||1), paidBase=Number(p.amountBase||p.baseAmount||p.amount||0), payDate=p.date||new Date().toISOString().slice(0,10), payRate=Number(p.exchangeRate||p.payRate||p.billRate||rate(c,payDate));
      if(c===base()||!(paidBase>0&&original>0&&payRate>0))return;
      var foreignSettled=paidBase/payRate, carrying=foreignSettled*original, diff=round(kind==='Receivable'?paidBase-carrying:carrying-paidBase,2);
      sum+=diff; items.push({reference:doc.invoiceNumber||doc.billNumber||doc.id,type:kind,paidBase:paidBase,currency:c,invoiceRate:original,paymentRate:payRate,realisedFx:diff,date:payDate});
    });
    return {netRealisedFx:round(sum,2),items:items};
  }
  function renderReport() {
    var host=document.getElementById('acxFxReport'); if(!host)return;
    var e=exposure(), r=realised(), fmt=function(n){return Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});};
    host.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><div><b style="color:#1e3a8a">Foreign currency exposure</b><div style="font-size:12px;color:#64748b">Revaluation estimate · '+e.asOf+' · '+e.baseCurrency+'</div></div><button type="button" id="acxFxRefresh" style="padding:7px 12px;border:1px solid #1e3a8a;border-radius:7px;color:#1e3a8a">Refresh</button></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px;margin:12px 0"><div style="padding:10px;background:#f8fafc;border-radius:8px"><small>Unrealised gain</small><div style="font-weight:700;color:#15803d">'+e.baseCurrency+' '+fmt(e.totalUnrealisedGain)+'</div></div><div style="padding:10px;background:#f8fafc;border-radius:8px"><small>Unrealised loss</small><div style="font-weight:700;color:#b91c1c">'+e.baseCurrency+' '+fmt(e.totalUnrealisedLoss)+'</div></div><div style="padding:10px;background:#f8fafc;border-radius:8px"><small>Net unrealised FX</small><div style="font-weight:700">'+e.baseCurrency+' '+fmt(e.netUnrealised)+'</div></div><div style="padding:10px;background:#f8fafc;border-radius:8px"><small>Net realised FX (linked payments)</small><div style="font-weight:700">'+e.baseCurrency+' '+fmt(r.netRealisedFx)+'</div></div></div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:7px">Type</th><th style="text-align:left;padding:7px">Reference</th><th style="text-align:left;padding:7px">Currency</th><th style="text-align:right;padding:7px">Open amount</th><th style="text-align:right;padding:7px">Book value ('+e.baseCurrency+')</th><th style="text-align:right;padding:7px">Current value</th><th style="text-align:right;padding:7px">FX difference</th></tr></thead><tbody>'+e.openItems.map(function(x){return '<tr><td style="padding:7px;border-top:1px solid #e2e8f0">'+x.type+'</td><td style="padding:7px;border-top:1px solid #e2e8f0">'+String(x.reference||'').replace(/[&<>]/g,'')+'</td><td style="padding:7px;border-top:1px solid #e2e8f0">'+x.currency+'</td><td style="padding:7px;text-align:right;border-top:1px solid #e2e8f0">'+fmt(x.foreign)+'</td><td style="padding:7px;text-align:right;border-top:1px solid #e2e8f0">'+fmt(x.bookBase)+'</td><td style="padding:7px;text-align:right;border-top:1px solid #e2e8f0">'+fmt(x.currentBase)+'</td><td style="padding:7px;text-align:right;border-top:1px solid #e2e8f0">'+fmt(x.unrealised)+'</td></tr>';}).join('')+'</tbody></table></div><p style="font-size:11px;color:#64748b;margin-top:8px">Estimate only: review linked payment allocations and post approved revaluation journals before statutory reporting. Historical invoice and bill rates remain unchanged.</p>';
    var btn=document.getElementById('acxFxRefresh'); if(btn)btn.onclick=renderReport;
  }
  function addFxReport() {
    if(document.getElementById('acxFxReport'))return;
    var root=document.getElementById('reportsTab')||document.getElementById('settingsTab')||document.querySelector('#mainContent')||document.body;
    if(!root)return;
    var card=document.createElement('section');card.id='acxFxReport';card.className='mt-4 p-4 rounded-xl border';card.style.cssText='border-color:#dbe3f2;background:#fff;color:#0f172a';
    var title=document.createElement('h3');title.textContent='Multi-currency accounting · FX revaluation';title.style.cssText='font-weight:700;color:#1e3a8a;margin-bottom:10px';card.appendChild(title);root.appendChild(card);renderReport();
  }
  function init() {
    installStorageHook(); appendHistory();
    TX_KEYS.forEach(function(k){var a=read(k,null);if(Array.isArray(a)){var b=normalizeArray(k,a);if(JSON.stringify(a)!==JSON.stringify(b))write(k,b);}});
    patchSaves(); addQuoteAndCreditControls(); addFxReport();
    var mo=new MutationObserver(function(){patchSaves();addQuoteAndCreditControls();}); mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
    document.addEventListener('click',function(){setTimeout(function(){patchSaves();addQuoteAndCreditControls();},80);},true);
    window.addEventListener('acx:rates-updated',function(){appendHistory();renderReport();});
    window.addEventListener('acx-currency-rates-updated',function(){appendHistory();renderReport();});
    window.addEventListener('storage',function(e){if(e.key===KEYS.settings){appendHistory();renderReport();}});
    window.acxFX={version:VERSION,baseCurrency:base,rate:rate,convert:convert,snapshot:snapshot,exposure:exposure,realised:realised,renderReport:renderReport,history:function(){return read(KEYS.history,[]);},recordAudit:recordAudit};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();



/* ===== merged from acacia-inventory-costing.js ===== */
/* Acacia Books inventory costing: dual-method foundation + bulk costing tools.
   Preserves legacy buyPrice and existing inventory records. */
(function(){'use strict';
  var KEY='acxCostingSettingsV1';
  function read(k,f){try{var v=JSON.parse(localStorage.getItem(k)||'null');return v==null?f:v}catch(e){return f}}
  function write(k,v){localStorage.setItem(k,JSON.stringify(v))}
  function num(v){v=Number(String(v==null?0:v).replace(/,/g,''));return isFinite(v)?v:0}
  function base(){return window.__getBaseCurrencyEarly?window.__getBaseCurrencyEarly():(localStorage.getItem('baseCurrency')||'KES')}
  function settings(){var s=read(KEY,{});return Object.assign({defaultMethod:'weighted-average',landedAllocation:'value'},s)}
  function saveSettings(s){write(KEY,s)}
  function warehouses(){return typeof __invWarehouseNames==='function'?__invWarehouseNames():[]}
  function get(wh){return typeof getInventory==='function'?getInventory(wh):read('inventory_'+wh,[])}
  function put(wh,a){if(typeof saveInventory==='function')saveInventory(wh,a);else write('inventory_'+wh,a)}
  function method(item){return item.costingMethod||settings().defaultMethod}
  function ensure(item){if(!item.costingMethod)item.costingMethod=settings().defaultMethod;
    if(item.costingMethod==='fifo'&&!Array.isArray(item.costLayers)){
      var q=Math.max(0,num(item.qty)),c=num(item.buyPrice);
      item.costLayers=q>0?[{id:'OPEN-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),date:item.openingDate||item.createdAt||new Date().toISOString().slice(0,10),qtyIn:q,qtyRemaining:q,unitCost:c,currency:item.currency||base(),baseUnitCost:c,source:'Opening balance'}]:[];
    }
    if(item.costingMethod==='weighted-average'&&!isFinite(Number(item.averageCost)))item.averageCost=num(item.buyPrice);
    return item;
  }
  function sync(wh){var a=get(wh),dirty=false;a.forEach(function(it){if(it){var before=JSON.stringify([it.costingMethod,it.costLayers,it.averageCost]);ensure(it);if(before!==JSON.stringify([it.costingMethod,it.costLayers,it.averageCost]))dirty=true}});if(dirty)put(wh,a);return a}
  window.AcaciaCosting={settings:settings,saveSettings:saveSettings,method:method,ensure:ensure,
    receive:function(wh,index,qty,unitCost,currency,rate,date,source){var a=sync(wh),it=a[index];if(!it)throw Error('Product not found');qty=num(qty);unitCost=num(unitCost);rate=num(rate)||1;if(qty<=0||unitCost<0)throw Error('Enter a positive quantity and a valid unit cost');ensure(it);var bcost=unitCost*rate;
      if(method(it)==='fifo'){it.costLayers.push({id:'RCV-'+Date.now(),date:date||new Date().toISOString().slice(0,10),qtyIn:qty,qtyRemaining:qty,unitCost:unitCost,currency:currency||base(),exchangeRate:rate,baseUnitCost:bcost,source:source||'Stock receipt'});}
      else {var old=num(it.qty),avg=num(it.averageCost||it.buyPrice),next=old+qty;it.averageCost=next>0?((old*avg)+(qty*bcost))/next:bcost;it.buyPrice=it.averageCost;}
      it.qty=num(it.qty)+qty;it.costingUpdatedAt=new Date().toISOString();put(wh,a);return it;},
    issue:function(wh,index,qty){var a=sync(wh),it=a[index];if(!it)throw Error('Product not found');qty=num(qty);if(qty<=0||qty>num(it.qty))throw Error('Issue quantity exceeds available stock');ensure(it);var cost=0,alloc=[];
      if(method(it)==='fifo'){var left=qty;it.costLayers.slice().sort(function(x,y){return String(x.date||'').localeCompare(String(y.date||''))||String(x.id).localeCompare(String(y.id))}).forEach(function(layer){if(left<=0)return;var take=Math.min(left,num(layer.qtyRemaining));if(take>0){layer.qtyRemaining-=take;left-=take;cost+=take*num(layer.baseUnitCost==null?layer.unitCost:layer.baseUnitCost);alloc.push({layerId:layer.id,qty:take,baseUnitCost:num(layer.baseUnitCost==null?layer.unitCost:layer.baseUnitCost)})}});if(left>0.000001)throw Error('FIFO cost layers do not cover available quantity. Reconcile opening layers before posting.');}
      else cost=qty*num(it.averageCost||it.buyPrice);
      it.qty=num(it.qty)-qty;put(wh,a);return{quantity:qty,costBase:cost,unitCostBase:cost/qty,allocations:alloc,method:method(it)};},
    setMethod:function(wh,index,m){if(['fifo','weighted-average'].indexOf(m)<0)throw Error('Invalid costing method');var a=sync(wh),it=a[index];if(!it)throw Error('Product not found');if(m==='fifo'&&it.costingMethod!=='fifo'){it.costingMethod='fifo';it.costLayers=[{id:'CONV-'+Date.now(),date:new Date().toISOString().slice(0,10),qtyIn:num(it.qty),qtyRemaining:num(it.qty),unitCost:num(it.averageCost||it.buyPrice),baseUnitCost:num(it.averageCost||it.buyPrice),currency:base(),source:'Method conversion — current carrying cost'}].filter(function(x){return x.qtyIn>0})}else if(m==='weighted-average'&&it.costingMethod!=='weighted-average'){var q=num(it.qty),v=(it.costLayers||[]).reduce(function(s,l){return s+num(l.qtyRemaining)*num(l.baseUnitCost==null?l.unitCost:l.baseUnitCost)},0);it.averageCost=q>0?v/q:num(it.buyPrice);it.buyPrice=it.averageCost;it.costingMethod='weighted-average';}else it.costingMethod=m;put(wh,a);return it;},
    bulkLandedCost:function(wh,indices,total,allocation){var a=sync(wh),items=indices.map(function(i){return{index:i,item:a[i]}}).filter(function(x){return x.item});total=num(total);if(!items.length||total<0)throw Error('Select products and enter a valid landed cost');var weights=items.map(function(x){return allocation==='quantity'?Math.max(0,num(x.item.qty)):Math.max(0,num(x.item.qty)*num(x.item.buyPrice))}),sum=weights.reduce(function(s,x){return s+x},0);if(sum<=0)throw Error('Selected products have no quantity/value basis for allocation');items.forEach(function(x,i){var share=total*weights[i]/sum,it=x.item,q=Math.max(0,num(it.qty));if(!q)return;var add=share/q;ensure(it);if(method(it)==='fifo'){var layer=it.costLayers.slice().reverse().find(function(l){return num(l.qtyRemaining)>0});if(layer){layer.unitCost=num(layer.unitCost)+add;layer.baseUnitCost=num(layer.baseUnitCost==null?layer.unitCost-add:layer.baseUnitCost)+add;layer.landedCostAllocated=num(layer.landedCostAllocated)+share}else it.costLayers.push({id:'LAND-'+Date.now()+'-'+i,date:new Date().toISOString().slice(0,10),qtyIn:q,qtyRemaining:q,unitCost:add,baseUnitCost:add,currency:base(),source:'Bulk landed cost'})}else{it.averageCost=num(it.averageCost||it.buyPrice)+add;it.buyPrice=it.averageCost;}it.landedCostAllocated=num(it.landedCostAllocated)+share;});put(wh,a);return items.length;}
  };
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])})}
  function open(){var wh=(document.getElementById('warehouseSelect')||{}).value||'';if(!wh){alert('Select one warehouse to manage costing.');return}var a=sync(wh);var rows=a.map(function(it,i){return '<tr><td><input type="checkbox" class="acx-cost-check" value="'+i+'" checked></td><td>'+esc(it.name)+'</td><td>'+esc(it.sku||'')+'</td><td>'+num(it.qty)+'</td><td><select class="acx-cost-method" data-i="'+i+'"><option value="weighted-average" '+(method(it)==='weighted-average'?'selected':'')+'>Weighted Average</option><option value="fifo" '+(method(it)==='fifo'?'selected':'')+'>FIFO</option></select></td><td>'+num(it.averageCost||it.buyPrice).toFixed(2)+'</td><td>'+(it.costLayers||[]).length+'</td></tr>'}).join('');
    var old=document.getElementById('acxCostingModal');if(old)old.remove();var m=document.createElement('div');m.id='acxCostingModal';m.style.cssText='position:fixed;inset:0;background:#0f172a99;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';m.innerHTML='<div style="background:white;color:#172033;width:min(1050px,98vw);max-height:90vh;overflow:auto;border-radius:14px;padding:20px;box-shadow:0 20px 60px #0004"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><h2 style="font-size:20px;font-weight:800;color:#1e3a8a">Inventory Costing & Bulk Costing</h2><button id="acxCostClose" style="font-size:24px">×</button></div><p style="font-size:13px;color:#64748b;margin:6px 0 14px">Warehouse: <b>'+esc(wh)+'</b>. Choose a method per product or apply a method to selected products.</p><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;background:#f8fafc;padding:12px;border-radius:10px;margin-bottom:12px"><label style="font-size:13px">Business default<br><select id="acxCostDefault" style="border:1px solid #cbd5e1;padding:7px;border-radius:6px"><option value="weighted-average">Weighted Average</option><option value="fifo">FIFO</option></select></label><button id="acxCostSaveDefault" style="background:#1e3a8a;color:white;padding:8px 12px;border-radius:7px">Save default</button><label style="font-size:13px">Apply method to selected<br><select id="acxCostBulkMethod" style="border:1px solid #cbd5e1;padding:7px;border-radius:6px"><option value="weighted-average">Weighted Average</option><option value="fifo">FIFO</option></select></label><button id="acxCostApplyMethod" style="background:#1e3a8a;color:white;padding:8px 12px;border-radius:7px">Apply method</button></div><div style="overflow:auto;max-height:42vh"><table style="width:100%;font-size:13px;border-collapse:collapse"><thead><tr style="background:#eff6ff"><th>Select</th><th>Product</th><th>SKU</th><th>Qty</th><th>Method</th><th>Unit cost ('+esc(base())+')</th><th>FIFO layers</th></tr></thead><tbody>'+rows+'</tbody></table></div><h3 style="font-weight:700;margin:16px 0 8px">Bulk landed-cost allocation</h3><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><label style="font-size:13px">Additional shipment cost ('+esc(base())+')<br><input id="acxCostLanded" type="number" min="0" step="0.01" style="border:1px solid #cbd5e1;padding:8px;border-radius:6px;width:190px"></label><label style="font-size:13px">Allocate by<br><select id="acxCostBasis" style="border:1px solid #cbd5e1;padding:8px;border-radius:6px"><option value="value">Current inventory value</option><option value="quantity">Quantity</option></select></label><button id="acxCostAllocate" style="background:#b8892d;color:white;padding:9px 14px;border-radius:7px;font-weight:700">Allocate to selected</button></div><p style="font-size:12px;color:#64748b;margin-top:10px">FIFO uses dated receipt layers; weighted average updates the carrying cost. Changing method converts at the current carrying cost. Bulk landed-cost allocation updates inventory cost records, not historical supplier bills.</p></div>';document.body.appendChild(m);
    document.getElementById('acxCostDefault').value=settings().defaultMethod;
    function chosen(){return Array.from(m.querySelectorAll('.acx-cost-check:checked')).map(function(x){return Number(x.value)})}
    document.getElementById('acxCostClose').onclick=function(){m.remove()};m.addEventListener('click',function(e){if(e.target===m)m.remove()});
    document.getElementById('acxCostSaveDefault').onclick=function(){var s=settings();s.defaultMethod=document.getElementById('acxCostDefault').value;saveSettings(s);alert('Business default costing method saved. Existing products keep their assigned method.')};
    document.getElementById('acxCostApplyMethod').onclick=function(){var ids=chosen(),v=document.getElementById('acxCostBulkMethod').value;if(!ids.length)return alert('Select at least one product');if(!confirm('Apply '+v+' to '+ids.length+' product(s)?'))return;ids.forEach(function(i){window.AcaciaCosting.setMethod(wh,i,v)});m.remove();open()};
    m.querySelectorAll('.acx-cost-method').forEach(function(sel){sel.onchange=function(){window.AcaciaCosting.setMethod(wh,Number(sel.dataset.i),sel.value)}});
    document.getElementById('acxCostAllocate').onclick=function(){try{var ids=chosen(),cost=num(document.getElementById('acxCostLanded').value);if(!ids.length)return alert('Select at least one product');if(!confirm('Allocate '+cost.toFixed(2)+' '+base()+' across '+ids.length+' products?'))return;var n=window.AcaciaCosting.bulkLandedCost(wh,ids,cost,document.getElementById('acxCostBasis').value);alert('Landed cost allocated across '+n+' product(s).');m.remove();open()}catch(e){alert(e.message)}};
  }
  // Costing remains in Settings Hub, alongside the existing Costing and Bulk Costing pages.
  // Do not add controls to Inventory: these settings are intentionally managed from Settings.
  function mount(){
    [['#costingTab','acxCostingOpen','⚖️ Costing methods & product costs'],['#bulkCostingTab','acxBulkCostingOpen','🚢 Bulk costing tools']].forEach(function(cfg){
      var tab=document.querySelector(cfg[0]);if(!tab||document.getElementById(cfg[1]))return;
      var head=tab.querySelector('h2');if(!head)return;
      var b=document.createElement('button');b.id=cfg[1];b.type='button';b.textContent=cfg[2];
      b.style.cssText='display:block;margin:8px 0 14px;background:#1e3a8a;color:white;padding:8px 12px;border-radius:7px;font-weight:700';
      b.onclick=open;head.insertAdjacentElement('afterend',b);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
})();

