/* acacia-ai-recon.js — AI bank statement matching inside Funds > Reconciliation.
 * Upload a CSV / Excel / PDF statement; AI matches each line to an open invoice
 * (money in) or bill (money out). High-confidence matches are marked paid
 * automatically; everything else is flagged as unmatched for review.
 */
(function () {
  "use strict";
  var W = window, D = document;
  var AUTO_PAY_CONFIDENCE = 0.85;
  var URL_KEY = "aiReconServiceUrl";
  var DEFAULT_URL = W.ACACIA_AI_RECON_URL || "";
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(n) { var dp = W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2; return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function serviceUrl() { return (localStorage.getItem(URL_KEY) || DEFAULT_URL || "").replace(/\/+$/, ""); }
  function loadScript(src) { return new Promise(function (ok, no) { var s = D.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { no(new Error("Could not load " + src)); }; D.head.appendChild(s); }); }

  /* ---------- statement parsing ---------- */
  function parseCSV(text) {
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === "," || c === ";" || c === "\t") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }
  function toISO(v) {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    var s = String(v || "").trim(), m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) { var y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
    var d = new Date(s); return isNaN(d) ? s : d.toISOString().slice(0, 10);
  }
  function rowsToLines(rows) {
    var hi = rows.findIndex(function (r) { return r.some(function (c) { return /date/i.test(c); }); });
    if (hi < 0) hi = 0;
    var h = rows[hi].map(function (c) { return String(c).toLowerCase().trim(); });
    function col(re) { return h.findIndex(function (c) { return re.test(c); }); }
    var cDate = col(/date/), cDesc = col(/desc|narr|detail|particular|memo|reference|payee/),
      cIn = col(/credit|deposit|money in|paid in|receipt/), cOut = col(/debit|withdraw|money out|paid out|payment/),
      cAmt = col(/^amount|amount$|value/);
    var lines = [];
    rows.slice(hi + 1).forEach(function (r) {
      var amt = 0;
      if (cIn >= 0 || cOut >= 0) amt = num(cIn >= 0 ? r[cIn] : 0) - Math.abs(num(cOut >= 0 ? r[cOut] : 0));
      else if (cAmt >= 0) amt = num(r[cAmt]);
      if (!amt) return;
      var desc = cDesc >= 0 ? r[cDesc] : r.filter(function (_, i) { return i !== cDate; }).join(" ");
      lines.push({ line: lines.length, date: toISO(cDate >= 0 ? r[cDate] : ""), description: String(desc || "").trim().slice(0, 200), amount: amt });
    });
    return lines;
  }
  function readFile(file) {
    var name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      return new Promise(function (ok, no) {
        var fr = new FileReader();
        fr.onload = function () { ok({ pdfBase64: String(fr.result).split(",")[1] }); };
        fr.onerror = no; fr.readAsDataURL(file);
      });
    }
    if (/\.(xlsx|xls)$/.test(name)) {
      return (W.XLSX ? Promise.resolve() : loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js")).then(function () {
        return file.arrayBuffer();
      }).then(function (buf) {
        var wb = W.XLSX.read(buf, { type: "array", cellDates: true });
        var rows = W.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
        return { lines: rowsToLines(rows) };
      });
    }
    return file.text().then(function (t) { return { lines: rowsToLines(parseCSV(t)) }; });
  }

  /* ---------- open documents ---------- */
  function openInvoices() {
    return J("invoices", []).filter(function (x) { return x && String(x.status || "").toLowerCase() !== "paid" && String(x.status || "").toLowerCase() !== "void"; })
      .map(function (x) {
        var t = num(x.totalKES != null ? x.totalKES : x.total), bal = x.balance != null ? num(x.balance) : t - num(x.amountPaid);
        return { id: String(x.id), no: x.invoiceNumber || "", customer: x.customer || "", balance: +bal.toFixed(2), date: x.date || "", due: x.dueDate || "" };
      }).filter(function (x) { return x.balance > 0; });
  }
  function openBills() {
    return J("bills", []).map(function (x, i) {
      if (!x || String(x.status || "").toLowerCase() === "paid") return null;
      var bal = x.balance != null ? num(x.balance) : num(x.total) - num(x.paidAmount);
      return bal > 0 ? { id: String(i), no: x.billNumber || "", supplier: x.supplier || x.vendor || "", balance: +bal.toFixed(2), date: x.date || "", due: x.dueDate || "" } : null;
    }).filter(Boolean);
  }

  /* ---------- auto-mark paid ---------- */
  function payInvoice(row, bank) {
    var inv = J("invoices", []), rec = J("receipts", []), cp = J("customerPayments", []);
    var c = inv.find(function (x) { return String(x.id) === row.docId; }); if (!c) return null;
    var total = num(c.totalKES != null ? c.totalKES : c.total), paid = num(c.amountPaid);
    var amt = Math.min(Math.abs(row.amount), Math.max(total - paid, 0)); if (amt <= 0) return null;
    c.amountPaid = paid + amt; c.balance = Math.max(total - c.amountPaid, 0);
    c.status = c.balance <= 0.005 ? "Paid" : "Partial"; if (c.status === "Paid") { c.balance = 0; c.paid = true; }
    var id = Date.now() + Math.floor(Math.random() * 1e3), bi = J("banks", []).findIndex(function (b) { return b.name === bank; });
    var ref = "Invoice " + (c.invoiceNumber || c.id) + " — AI bank match: " + row.description;
    rec.push({ id: id, date: row.date, customer: c.customer, invoiceId: c.id, amount: amt, method: "Bank", bankIndex: bi, reference: ref, source: "aiBankMatch" });
    cp.push({ id: "PAY-" + id, date: row.date, customer: c.customer, invoiceId: c.id, amount: amt, method: "Bank", bank: bank, receiptId: id, source: "aiBankMatch" });
    S("invoices", inv); S("receipts", rec); S("customerPayments", cp);
    return { label: "Invoice " + (c.invoiceNumber || c.id), status: c.status };
  }
  function payBill(row, bank) {
    var bills = J("bills", []), bp = J("billPayments", []), i = parseInt(row.docId, 10), b = bills[i]; if (!b) return null;
    var total = num(b.total), paid = num(b.paidAmount != null ? b.paidAmount : b.amountPaid);
    var amt = Math.min(Math.abs(row.amount), Math.max(total - paid, 0)); if (amt <= 0) return null;
    b.paidAmount = paid + amt; b.amountPaid = b.paidAmount; b.balance = Math.max(total - b.paidAmount, 0);
    b.status = b.balance <= 0.005 ? "Paid" : "Partial"; if (b.status === "Paid") b.balance = 0;
    bp.push({ id: Date.now() + Math.floor(Math.random() * 1e3), billNumber: b.billNumber, date: row.date, supplier: b.supplier, amount: amt, mode: "Bank", bank: bank, billIndex: i, source: "aiBankMatch" });
    S("bills", bills); S("billPayments", bp);
    return { label: "Bill " + (b.billNumber || "#" + i), status: b.status };
  }
  function refreshScreens() {
    ["renderInvoices", "renderReceipts", "renderAccountsReceivable", "loadSupplierBills", "renderSupplierPayments", "recalculateCustomerReceivables", "renderDashboard", "updateDashboard", "renderReceivablesAging"].forEach(function (n) {
      try { if (typeof W[n] === "function") W[n](); } catch (e) {}
    });
    try { W.FundsRecon && W.FundsRecon.refresh(); } catch (e) {}
  }

  /* ---------- UI ---------- */
  var state = { rows: [], bank: "", file: "" };
  function panel() {
    var p = D.getElementById("aiReconPanel");
    if (p) return p;
    var root = D.getElementById("rcRoot"); if (!root) return null;
    p = D.createElement("div"); p.id = "aiReconPanel"; p.className = "rc-card";
    p.innerHTML =
      '<div class="rc-head sm"><div><h4 class="rc-h4">✨ AI statement matching</h4>' +
      '<p class="rc-sub">Upload a bank statement (CSV, Excel or PDF). AI matches money in to open invoices and money out to open bills. Confident matches are marked paid automatically; the rest are flagged for you.</p></div>' +
      '<div class="rc-actions"><button type="button" class="rc-btn" id="aiReconUpload">Upload statement</button>' +
      '<button type="button" class="rc-btn ghost sm" id="aiReconSettings" title="AI service address">⚙</button></div></div>' +
      '<input type="file" id="aiReconFile" accept=".csv,.txt,.xlsx,.xls,.pdf" style="display:none">' +
      '<div id="aiReconStatus" class="rc-notice hidden" role="status"></div><div id="aiReconResult"></div>';
    root.insertBefore(p, root.children[1] || null);
    D.getElementById("aiReconUpload").onclick = function () {
      var bank = (D.getElementById("reconcileBank") || {}).value;
      if (!bank) return status("Choose a bank account above first.", "warn");
      if (!serviceUrl()) { askUrl(); if (!serviceUrl()) return; }
      var f = D.getElementById("aiReconFile"); f.value = ""; f.click();
    };
    D.getElementById("aiReconSettings").onclick = askUrl;
    D.getElementById("aiReconFile").onchange = function (e) { var f = e.target.files[0]; if (f) run(f); };
    return p;
  }
  function askUrl() {
    var v = prompt("AI matching service address (e.g. https://your-app.lovable.app):", serviceUrl());
    if (v != null) localStorage.setItem(URL_KEY, v.trim().replace(/\/+$/, ""));
  }
  function status(msg, kind) {
    var s = D.getElementById("aiReconStatus"); if (!s) return;
    s.className = "rc-notice " + (kind || "info") + (msg ? "" : " hidden"); s.innerHTML = msg || "";
  }
  function run(file) {
    var bank = D.getElementById("reconcileBank").value;
    state = { rows: [], bank: bank, file: file.name };
    D.getElementById("aiReconResult").innerHTML = "";
    status("Reading " + esc(file.name) + "…");
    readFile(file).then(function (payload) {
      if (payload.lines && !payload.lines.length) throw new Error("No transactions found. Check the file has Date, Description and Amount (or Debit/Credit) columns.");
      payload.invoices = openInvoices(); payload.bills = openBills();
      status("AI is matching " + (payload.lines ? payload.lines.length + " transactions" : "the PDF statement") + " to " + payload.invoices.length + " open invoices and " + payload.bills.length + " open bills… this can take up to a minute.");
      return fetch(serviceUrl() + "/api/public/bank-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "AI matching failed (" + r.status + ")."); return j; }); });
    }).then(function (res) {
      var used = {};
      state.rows = (res.rows || []).map(function (r) {
        r.amount = num(r.amount); r.confidence = num(r.confidence);
        var key = r.kind + ":" + r.docId;
        if (r.kind !== "none" && used[key]) { r.kind = "none"; r.reason = "Document already matched to another line."; }
        if (r.kind === "invoice" && r.amount <= 0 || r.kind === "bill" && r.amount >= 0) { r.kind = "none"; r.reason = "Direction does not fit the document."; }
        if (r.kind !== "none") used[key] = 1;
        r.result = null;
        if (r.kind !== "none" && r.confidence >= AUTO_PAY_CONFIDENCE) r.result = r.kind === "invoice" ? payInvoice(r, bank) : payBill(r, bank);
        return r;
      });
      var log = J("aiReconLog", []); log.unshift({ at: new Date().toISOString(), bank: bank, file: file.name, rows: state.rows }); S("aiReconLog", log.slice(0, 20));
      refreshScreens(); render();
    }).catch(function (e) { status("⚠️ " + esc(e.message || e), "warn"); });
  }
  function docLabel(r) {
    if (r.kind === "invoice") { var i = J("invoices", []).find(function (x) { return String(x.id) === r.docId; }); return i ? "Invoice " + esc(i.invoiceNumber || i.id) + " · " + esc(i.customer) : "Invoice"; }
    if (r.kind === "bill") { var b = J("bills", [])[parseInt(r.docId, 10)]; return b ? "Bill " + esc(b.billNumber || "") + " · " + esc(b.supplier || "") : "Bill"; }
    return "";
  }
  function render() {
    var paid = state.rows.filter(function (r) { return r.result; }), review = state.rows.filter(function (r) { return !r.result && r.kind !== "none"; }), un = state.rows.filter(function (r) { return r.kind === "none"; });
    status("✅ " + paid.length + " marked paid · 🟡 " + review.length + " suggested (needs your OK) · 🔴 " + un.length + " unmatched", "ok");
    var h = '<div style="overflow-x:auto"><table class="rc-table" style="width:100%"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Matched to</th><th>Confidence</th><th>Result</th></tr></thead><tbody>';
    state.rows.forEach(function (r, i) {
      var res = r.result ? '<span style="color:#15803d;font-weight:600">✅ Marked ' + esc(r.result.status) + "</span>"
        : r.kind !== "none" ? '<button type="button" class="rc-btn sm" data-ai-accept="' + i + '">Accept & mark paid</button>'
        : '<span style="color:#b91c1c;font-weight:600">🔴 Unmatched</span>';
      h += "<tr" + (r.kind === "none" ? ' style="background:rgba(220,38,38,.06)"' : "") + "><td>" + esc(r.date) + "</td><td>" + esc(r.description) + '<div class="rc-sub" style="font-size:11px">' + esc(r.reason) + '</div></td><td class="num">' + fmt(r.amount) + "</td><td>" + (docLabel(r) || "—") + "</td><td>" + (r.kind === "none" ? "—" : Math.round(r.confidence * 100) + "%") + "</td><td>" + res + "</td></tr>";
    });
    h += '</tbody></table></div><div class="rc-actions" style="margin-top:8px"><button type="button" class="rc-btn ghost sm" id="aiReconCsv">Download unmatched (CSV)</button></div>';
    var box = D.getElementById("aiReconResult"); box.innerHTML = h;
    box.querySelectorAll("[data-ai-accept]").forEach(function (b) {
      b.onclick = function () {
        var r = state.rows[+b.getAttribute("data-ai-accept")];
        r.result = r.kind === "invoice" ? payInvoice(r, state.bank) : payBill(r, state.bank);
        if (!r.result) alert("This document is already fully paid.");
        refreshScreens(); render();
      };
    });
    D.getElementById("aiReconCsv").onclick = function () {
      var csv = "Date,Description,Amount,Reason\n" + un.map(function (r) { return [r.date, r.description, r.amount, r.reason].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
      var a = D.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "unmatched_bank_lines.csv"; a.click();
    };
  }
  function init() { if (!panel()) setTimeout(init, 800); }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", init); else init();
  W.AcaciaAIRecon = { run: run, setServiceUrl: function (u) { localStorage.setItem(URL_KEY, u); } };
})();
