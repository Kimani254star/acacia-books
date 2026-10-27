/* acacia-statement-mail.js - customer statements -> Acacia Mail.
 * 1) The "Email" button on Customer Statement now saves a DRAFT in the company's Acacia Mail (Drafts) instead of
 *    dropping a message straight into the Sent list.
 * 2) New panel on the Customer Statement screen:
 *      [x] Automatically create statements on each customer's statement day (covers the PREVIOUS month)
 *      [x] Send them automatically (otherwise they wait in Drafts for you to review and press Send)
 *      Month [ previous month ]  [Create statements now]   <- test button, ignores the "already sent this month" lock
 * 3) Drafts are queued the same way as every other Books mail button (acacia_books_to_mail + acacia_mail_queue).
 * Load AFTER app-2.js (last script in index.html). */
(function (W) {
  "use strict";
  if (W.__acxStmtMail) return; W.__acxStmtMail = true;

  /* Always go through the live window.localStorage: the app replaces it with a per-company layer
   * (invoices/receipts/customers live in the company store, e.g. invoices::c1), so never cache a reference. */
  function store() { return W.localStorage; }
  function J(k, d) { try { var v = JSON.parse(store().getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function cfg() { return Object.assign({ auto: false, send: false }, J("acxStmtMail", {})); }
  function setCfg(c) { try { store().setItem("acxStmtMail", JSON.stringify(c)); } catch (e) {} }
  function dp() { return W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2; }
  function fm(n) { return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: dp(), maximumFractionDigits: dp() }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function prevYM(d) { d = d || new Date(); return ymOf(new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function range(ym) {
    var p = ym.split("-"), y = +p[0], m = +p[1] - 1;
    return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59),
             label: new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" }) };
  }

  /* ---------- build a statement for one customer ---------- */
  function build(name, from, to) {
    var inv = J("invoices", []), rec = J("receipts", []), cn = J("creditNotes", []), rows = [];
    inv.filter(function (x) { return x.customer === name; }).forEach(function (x) { rows.push({ d: x.date, t: "Invoice", r: x.invoiceNumber || x.id, dr: parseFloat(x.total) || 0, cr: 0 }); });
    rec.filter(function (x) { return x.customer === name; }).forEach(function (x) { rows.push({ d: x.date, t: "Receipt", r: x.receiptNumber || x.id, dr: 0, cr: parseFloat(x.amount) || 0 }); });
    cn.filter(function (x) { return x.customer === name; }).forEach(function (x) { rows.push({ d: x.date, t: "Credit note", r: x.creditNumber || x.id, dr: 0, cr: parseFloat(x.total) || 0 }); });
    rows.sort(function (a, b) { return new Date(a.d) - new Date(b.d); });
    var open = 0, lines = [], bal;
    rows.forEach(function (x) {
      var dt = new Date(x.d);
      if (from && dt < from) { open += x.dr - x.cr; return; }
      if (to && dt > to) return;
      lines.push(x);
    });
    bal = open;
    var text = lines.map(function (x) {
      bal += x.dr - x.cr;
      return new Date(x.d).toLocaleDateString() + "  " + x.t + " " + x.r + "  " + (x.dr ? "Debit " + fm(x.dr) : "Credit " + fm(x.cr)) + "  Balance " + fm(bal);
    });
    return { open: open, close: bal, count: lines.length, lines: text };
  }

  function bodyFor(cust, org, s, label) {
    return "Dear " + cust.name + ",\n\nPlease find your statement of account" + (label ? " for " + label : "") + " from " + org + ".\n\n" +
      "Opening balance: " + fm(s.open) + "\n" +
      (s.lines.length ? s.lines.join("\n") : "No transactions in this period.") + "\n\n" +
      "Closing balance (amount due): " + fm(s.close) + "\n\nThank you for your business.\n" + org;
  }

  /* ---------- queue a draft in Acacia Mail (no new tab per mail) ---------- */
  function queueDraft(to, subject, body, autoSend) {
    try {
      var s = J("loggedInUser", {}) || {}, c = J("orgInfo", {}) || {}, d = s.companyName || c.name || c.companyName || "";
      if (!s.companyId || !String(d).replace(/[^a-zA-Z0-9]/g, "")) return null;
      var u = { bid: "bk_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7), company: d,
                slug: String(d).toLowerCase().replace(/[^a-z0-9]/g, ""), fromName: c.name || c.companyName || s.fullName || s.username || "Acacia Books",
                fromEmail: c.email || s.email || "", to: to, cc: "", bcc: "", subject: subject, body: body, time: Date.now(), autoSend: !!autoSend };
      var ns = W.__companyNS, g = (ns && ns.nGet) || Storage.prototype.getItem, st = (ns && ns.nSet) || Storage.prototype.setItem,
          real = (ns && ns.real) || W.localStorage, q = [];
      try { q = JSON.parse(g.call(real, "acacia_books_to_mail") || "[]") || []; } catch (e) { q = []; }
      q.push(u); st.call(real, "acacia_books_to_mail", JSON.stringify(q.slice(-200)));
      try { var bc = new BroadcastChannel("acacia_books_mail"); bc.postMessage("new"); bc.close(); } catch (e) {}
      if (W.__SUPA_URL__ && W.__SUPA_KEY__) {
        var v = { bid: u.bid, company_id: String(s.companyId), from_name: u.fromName, from_email: u.fromEmail, to: u.to, cc: "", subject: u.subject, body: u.body };
        fetch(W.__SUPA_URL__ + "/rest/v1/acacia_mail_queue", { method: "POST", keepalive: true,
          headers: { apikey: W.__SUPA_KEY__, Authorization: "Bearer " + W.__SUPA_KEY__, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify(v) }).catch(function () {});
      }
      return u;
    } catch (e) { return null; }
  }

  /* ---------- create statements for a month ---------- */
  function createForMonth(ym, onlyName, send) {
    var r = range(ym), org = (J("orgInfo", {}) || {}).companyName || (J("orgInfo", {}) || {}).name || "Company",
        made = 0, noEmail = [], list = J("customers", []);
    list.forEach(function (c) {
      if (onlyName && c.name !== onlyName) return;
      var to = c.primaryEmail || c.email || "";
      if (!to) { noEmail.push(c.name); return; }
      var s = build(c.name, r.from, r.to);
      if (!s.count && !s.close) return;                       /* nothing to say to this customer */
      if (queueDraft(to, org + " statement of account - " + r.label, bodyFor(c, org, s, r.label), send)) made++;
    });
    return { made: made, noEmail: noEmail, label: r.label };
  }

  function report(res, send) {
    var m = res.made + " statement" + (res.made === 1 ? "" : "s") + " for " + res.label +
      (send ? " queued to send from Acacia Mail." : " saved in Acacia Mail > Drafts - open Mail to review and press Send.");
    if (res.noEmail.length) m += "\n\nSkipped (no email on file): " + res.noEmail.join(", ");
    if (!res.made) m = "No statements were created for " + res.label + "." + (res.noEmail.length ? "\n\nNo email on file: " + res.noEmail.join(", ") : "\n\n(No customer has activity or a balance in that period.)");
    alert((res.made ? "\u2705 " : "") + m);
  }

  /* ---------- 1) the Email button on the Customer Statement screen ---------- */
  W.sendStatementByEmail = function () {
    var sel = document.getElementById("statementCustomer"), name = sel && sel.value;
    if (!name) return alert("\u274C Select a customer first");
    var c = J("customers", []).find(function (x) { return x.name === name; }) || {}, to = c.primaryEmail || c.email || prompt("Enter email for " + name + ":");
    if (!to) return alert("\u274C No email entered.");
    var f = (document.getElementById("statementFromDate") || {}).value, t = (document.getElementById("statementToDate") || {}).value,
        from = f ? new Date(f) : null, till = t ? new Date(t + "T23:59:59") : null, org = (J("orgInfo", {}) || {}).companyName || (J("orgInfo", {}) || {}).name || "Company",
        label = f || t ? (f || "start") + " to " + (t || "today") : "", s = build(name, from, till);
    if (!confirm("Create a draft of this statement for " + name + " (" + to + ") in Acacia Mail?")) return;
    var u = queueDraft(to, org + " statement of account" + (label ? " - " + label : ""), bodyFor({ name: name }, org, s, label), false);
    alert(u ? "\u2705 Draft saved in Acacia Mail > Drafts for " + to + "." : "\u274C Could not reach Acacia Mail. Log in to your company first.");
  };

  /* ---------- 2) scheduled run (replaces the old hourly sender) ---------- */
  W.__acxStmtAuto = function () {
    var c = cfg(); if (!c.auto) return;
    var now = new Date(), day = now.getDate(), stamp = ymOf(now), list = J("customers", []), changed = false, made = 0;
    var last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var ym = prevYM(now), r = range(ym), org = (J("orgInfo", {}) || {}).companyName || (J("orgInfo", {}) || {}).name || "Company";
    list.forEach(function (cu) {
      var sd = cu.statementDay ? parseInt(cu.statementDay, 10) : (cu.statementDate ? parseInt(String(cu.statementDate).split("/")[0], 10) : 0);
      if (!sd || day < Math.min(sd, last) || cu.lastStatementStamp === stamp) return;
      var to = cu.primaryEmail || cu.email || ""; if (!to) return;
      var s = build(cu.name, r.from, r.to);
      if (s.count || s.close) { if (queueDraft(to, org + " statement of account - " + r.label, bodyFor(cu, org, s, r.label), c.send)) made++; }
      cu.lastStatementStamp = stamp; cu.lastStatementSentAt = now.toISOString(); changed = true;
    });
    if (changed) { store().setItem("customers", JSON.stringify(list)); if (typeof W.renderCustomers === "function") W.renderCustomers(); }
  };

  /* ---------- 3) panel on the Customer Statement screen ---------- */
  function panel() {
    var sel = document.getElementById("statementCustomer");
    if (!sel || document.getElementById("acxStmtPanel")) return;
    var c = cfg(), box = document.createElement("div");
    box.id = "acxStmtPanel"; box.className = "border rounded p-3 mb-4 text-sm bg-gray-50";
    box.innerHTML =
      '<div class="font-bold mb-2">\u2709\uFE0F Statements by email (Acacia Mail)</div>' +
      '<label class="flex items-center gap-2 mb-1"><input type="checkbox" id="acxStmtAuto"> Automatically create each customer\'s statement on their statement day (covers the previous month)</label>' +
      '<label class="flex items-center gap-2 mb-2"><input type="checkbox" id="acxStmtSend"> Send them automatically (leave unticked to keep them in Drafts for review)</label>' +
      '<div class="flex flex-wrap items-end gap-2"><div class="flex flex-col"><label class="text-xs">Month</label><input type="month" id="acxStmtMonth" class="p-2 border rounded"></div>' +
      '<button type="button" id="acxStmtGo" class="border border-blue-900 text-white bg-blue-900 font-bold px-3 py-2 rounded">Create statements now (test)</button>' +
      '<span class="text-xs text-gray-500">Ignores the \u201Calready sent this month\u201D lock. Tick a customer above to do just that one.</span></div>';
    sel.parentNode.insertBefore(box, sel);
    var a = document.getElementById("acxStmtAuto"), s = document.getElementById("acxStmtSend"), m = document.getElementById("acxStmtMonth");
    a.checked = !!c.auto; s.checked = !!c.send; m.value = prevYM();
    a.onchange = s.onchange = function () { setCfg({ auto: a.checked, send: s.checked }); };
    document.getElementById("acxStmtGo").onclick = function () {
      if (!m.value) return alert("Choose a month.");
      var only = sel.value || "", who = only ? only : "ALL customers with an email";
      if (!confirm("Create the " + range(m.value).label + " statement for " + who + (s.checked ? " and queue it to SEND" : " as drafts in Acacia Mail") + "?")) return;
      report(createForMonth(m.value, only, s.checked), s.checked);
    };
  }
  document.addEventListener("click", function () { setTimeout(panel, 50); }, true);
  /* The app freezes setTimeout/setInterval (window.blockRender) for the first ~1.5s after load and silently drops
   * anything scheduled then, so wait until it lifts before starting the panel timer. */
  (function boot() {
    if (W.blockRender) { return W.requestAnimationFrame ? W.requestAnimationFrame(boot) : void 0; }
    panel(); setTimeout(panel, 1500); setInterval(panel, 4000);
  })();
})(window);
