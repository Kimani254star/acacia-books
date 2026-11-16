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
