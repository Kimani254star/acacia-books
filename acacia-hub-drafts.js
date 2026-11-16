/* Acacia Books — unified draft registers for Sales, Purchase, Accounting and Inventory.
   Reads existing draft records only; never posts or changes transaction data. */
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
    },
    inventory: {
      title: "Inventory Drafts", tab: "inventoryTab",
      keys: /inventory|stock|transfer|bundle|assembly|package|costing|pricelist|shipment|adjustment|stocktake|damagedstock|expireditems/i
    }
  };
  var KEY_HUBS = {
    sales: ["bulkInvoiceDrafts","invoiceDrafts","creditNoteDrafts","salesReturnDrafts","deliveryDrafts","invoices","bulkInvoices","quotes","orders","salesOrders","creditNotes","salesReturns","deliveries","receipts","customerPayments","recurringInvoices"],
    purchase: ["bulkBills","bills","supplierBills","purchaseOrders","purchaseOrderDrafts","grns","supplierDebitNotes","purchaseReturns","supplierQuotes","supplierDrafts","purchaseReturnDrafts","recurringBills","recurringPayments","billPayments"],
    funds: ["banks","bankMappings","bankAccounts","bankDrafts","funds","cashAccounts","cashTransactions","bankTransfers","fundTransfers","deposits","withdrawals","expenses","incomeRecords","pettyCash","receipts","customerPayments","supplierPayments","billPayments","paymentsMade","bankReconciliations"],
    accounting: ["manualJournalDraft","recurringJournalDraft","journalEntries","manualJournals","recurringJournals","manualTransactions","operationalCosts","equityRecords","currentAccounts","directorAccount","budgets","budgetHistory","budgetVariance","taxAdjustments","taxPayments","currencyAdjustments","chartOfAccountsDrafts","nonCurrentLiabilityDraft"],
    payroll: ["payrollDrafts","payrollRuns","payrollRecords","payslipDrafts","payslips","grossPayroll","earnings","deductions","statutoryDeductions","attendance","leaveRecords","overtime","employeeDrafts","salaryAdvances"],
    inventory: ["inventoryDrafts","stockDrafts","inventoryItems","inventories","stockItems","stockAdjustments","stockTransfers","stocktakes","damagedStock","expiredItems","assemblies","bundles","shipments","inventoryCosting","itemDrafts"]
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
    if (/inventory|stock|transfer|bundle|assembly|package|costing|pricelist|shipment|adjustment|stocktake|damaged|expired/.test(s)) return "inventory";
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
          if (!h && v && v.sec) { var sec = String(v.sec).toLowerCase(); if (/payroll|employee|payslip|attendance|earnings/.test(sec)) h = "payroll"; else if (/fund|bank|cash|payment|receipt/.test(sec)) h = "funds"; else if (/journal|account|asset|equity|liabilit|tax|budget/.test(sec)) h = "accounting"; else if (/purchase|supplier|bill|grn/.test(sec)) h = "purchase"; else if (/inventory|stock|warehouse|shipment|bundle|movement/.test(sec)) h = "inventory"; else if (/invoice|sales|quote|order|credit|delivery/.test(sec)) h = "sales"; }
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
