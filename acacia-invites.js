/* acacia-invites.js - User Management > Invite User, sent by WhatsApp or email without needing an email domain.
 *
 * Replaces the invite code that used to live inside app-3.js (that copy is switched off). Same link format and same
 * "userInvites" data, so invitations you already sent keep working.
 *
 *   - the person's EMAIL is their account / login (as for every other user);
 *   - the company phone and email are read from Organization Profile and added to the message, so the new user knows who to contact;
 *   - one tap sends the link: WhatsApp (opens with the message ready, you pick the contact), Email (opens your mail app,
 *     addressed to them), the phone's Share sheet, or Copy message / Copy link;
 *   - the same buttons are on every row of the Invitations table, so a link can be re-sent any time.
 * Load LAST in index.html. */
(function (W) {
  "use strict";
  if (W.__acxInvitesV2) return;
  W.__acxInvitesV2 = true;

  var KEY = "userInvites", inviteMode = false, opening = false, saved = {};
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, USER_RE = /^[A-Za-z0-9._-]{3,40}$/;
  var BTN = "border:1px solid #1e3a8a;background:#1e3a8a;color:#fff;font-weight:700;padding:3px 9px;border-radius:4px;cursor:pointer;margin:2px 4px 2px 0;font-size:12px;text-decoration:none;display:inline-block";
  var BTN_WA = BTN.replace(/#1e3a8a/g, "#15803d"), BTN_GREY = BTN.replace(/#1e3a8a/g, "#4b5563");

  /* ---------- small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function me() { return jget("loggedInUser", {}) || {}; }
  function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
  function company() {
    var u = me(), id = String(u.companyId || ""), c = jget("companies", []).find(function (x) { return String(x.companyId || "") === id; });
    return { id: id, name: (c && c.companyName) || u.companyName || "", plan: u.plan };
  }
  function invites() { return jget(KEY, []); }
  function saveInvites(list) { localStorage.setItem(KEY, JSON.stringify(list)); try { W.uploadLocalStorage && W.uploadLocalStorage(); } catch (e) {} }
  function companyUsers(id) { return jget("users", []).filter(function (u) { return String(u.companyId || "") === String(id); }); }
  function loginOf(inv) { return inv.email || inv.username || ""; }
  function org() { var o = jget("orgInfo", {}) || {}; return { phone: String(o.phone || o.orgPhone || "").trim(), email: String(o.email || o.orgEmail || "").trim() }; }
  function roleLabel(inv) { return inv.role === "custom" ? (inv.customRole || "a custom role") : inv.role; }

  function status(inv) {
    if (inv.status === "revoked") return "Revoked";
    var key = String(loginOf(inv)).toLowerCase();
    var used = companyUsers(inv.companyId).some(function (u) {
      return u.invitedVia === inv.id || (key && ((u.email || "").toLowerCase() === key || (u.username || "").toLowerCase() === key));
    });
    if (inv.status === "accepted" || used) return "Accepted";
    return Date.now() > inv.expires ? "Expired" : "Pending";
  }

  /* the link (same format as before, so old links keep working) */
  function linkFor(inv) {
    var raw = btoa(JSON.stringify({ i: inv.id, s: inv.secret, c: inv.companyId, n: inv.companyName })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return location.href.split("#")[0].split("?")[0] + "?acxInvite=" + raw;
  }
  function messageFor(inv) {
    var who = me().username || "Your administrator", name = inv.name ? "Hello " + inv.name + ",\n\n" : "Hello,\n\n";
    return name + who + " has invited you to join " + (inv.companyName || "our company") + " on Acacia Books as " + roleLabel(inv) + ".\n\n" +
      "Open this link to set your password:\n" + linkFor(inv) + "\n\n" +
      "Company: " + (inv.companyName || "") + "\nLogin: " + loginOf(inv) + "\n\nThe link works until " + new Date(inv.expires).toDateString() + "." + contactLine();
  }
  function contactLine() {
    var o = org(), bits = [];
    if (o.phone) bits.push(o.phone);
    if (o.email) bits.push(o.email);
    return bits.length ? "\n\nQuestions? Contact " + bits.join(" · ") + "." : "";
  }
  function phoneDigits(raw) {
    var d = String(raw || "").replace(/[^\d+]/g, "");
    if (!d) return "";
    if (d.charAt(0) === "+") return d.slice(1).replace(/\D/g, "");
    d = d.replace(/\D/g, "");
    if (/^0\d{9}$/.test(d)) return "254" + d.slice(1);          /* 07xx / 01xx  -> Kenya */
    if (/^[17]\d{8}$/.test(d)) return "254" + d;                /* 7xx / 1xx */
    if (/^00\d+$/.test(d)) return d.slice(2);
    return d;
  }
  function waUrl(inv) { return "https://wa.me/" + phoneDigits(inv.phone) + "?text=" + encodeURIComponent(messageFor(inv)); }   /* no phone stored: WhatsApp lets you pick the contact */
  function mailUrl(inv) {
    return "mailto:" + encodeURIComponent(inv.email || "") + "?subject=" + encodeURIComponent("You are invited to join " + (inv.companyName || "our company") + " on Acacia Books") +
      "&body=" + encodeURIComponent(messageFor(inv));
  }
  function copyText(text, btn, what) {
    function done() { if (btn) { var t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = t; }, 1400); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { W.prompt("Copy this " + (what || "text") + ":", text); });
    else W.prompt("Copy this " + (what || "text") + ":", text);
  }
  function share(inv) {
    if (navigator.share) navigator.share({ title: "Join " + (inv.companyName || "Acacia Books"), text: messageFor(inv) }).catch(function () {});
    else copyText(messageFor(inv), null, "message");
  }

  /* one row of share buttons for an invitation */
  function actionsHtml(inv, idx) {
    var h = '<a style="' + BTN_WA + '" href="' + esc(waUrl(inv)) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      "";
    if (navigator.share) h += '<button type="button" style="' + BTN + '" data-sh="' + idx + '">Share…</button>';
    h += '<button type="button" style="' + BTN_GREY + '" data-cm="' + idx + '">Copy message</button>' +
      '<button type="button" style="' + BTN_GREY + '" data-cl="' + idx + '">Copy link</button>';
    if (inv.email) h = h.replace('<button type="button" style="' + BTN_GREY + '" data-cm', '<a style="' + BTN + '" href="' + esc(mailUrl(inv)) + '">✉️ Email</a><button type="button" style="' + BTN_GREY + '" data-cm');
    return h;
  }
  function wireActions(root, list) {
    root.querySelectorAll("[data-sh]").forEach(function (b) { b.onclick = function () { share(list[+b.dataset.sh]); }; });
    root.querySelectorAll("[data-cm]").forEach(function (b) { b.onclick = function () { copyText(messageFor(list[+b.dataset.cm]), b, "message"); }; });
    root.querySelectorAll("[data-cl]").forEach(function (b) { b.onclick = function () { copyText(linkFor(list[+b.dataset.cl]), b, "link"); }; });
  }
  function overlay(html) {
    var o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px";
    o.innerHTML = '<div style="background:#fff;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.3);max-width:600px;width:100%;max-height:90vh;overflow:auto;padding:20px;font-size:14px">' + html + "</div>";
    document.body.appendChild(o);
    return o;
  }

  /* ---------- the invite form (the existing Create User dialog, switched to invite mode) ---------- */
  function setInviteUI(on) {
    inviteMode = on;
    ["newUsername", "newPassword"].forEach(function (id) { var el = $(id); if (el) el.style.display = on ? "none" : ""; });
    var mail = $("mailAcctRow"); if (mail) mail.style.display = on ? "none" : "";
    var em = $("newEmail");
    if (em) {
      if (on) { saved.type = em.type; saved.ph = em.placeholder; em.type = "text"; em.placeholder = "Email address (separate several with commas)"; }
      else if (saved.type) { em.type = saved.type; em.placeholder = saved.ph; }
    }
    var hint = $("acxInvHint");
    if (on && em && !hint) {
      hint = document.createElement("div");
      hint.id = "acxInvHint"; hint.style.cssText = "font-size:12px;color:#6b7280;margin:-4px 0 8px";
      hint.textContent = "Their email is their login. After you create the invite you can send the link by WhatsApp or email.";
      em.parentNode.insertBefore(hint, em.nextSibling);
    }
    if (hint) hint.style.display = on ? "" : "none";
    if (on) { var t = $("modalTitle"); if (t) t.textContent = "✉️ Invite User"; }
    var btn = document.querySelector('#createUserModal button[onclick="saveUser()"]');
    if (btn) { if (on) { saved.btn = btn.textContent; btn.textContent = "Create invite link"; } else if (saved.btn) btn.textContent = saved.btn; }
  }

  var origOpen = W.openCreateUserModal, origClose = W.closeCreateUserModal, origSave = W.saveUser;
  W.openInviteUserModal = function () {
    opening = true;
    try { origOpen && origOpen(null); } finally { opening = false; }
    var m = $("createUserModal");
    if (m && !m.classList.contains("hidden")) setInviteUI(true);
  };
  W.openCreateUserModal = function () { if (!opening && inviteMode) setInviteUI(false); return origOpen.apply(this, arguments); };
  W.closeCreateUserModal = function () { if (inviteMode) setInviteUI(false); return origClose.apply(this, arguments); };
  W.saveUser = function () { return inviteMode ? submitInvite() : origSave.apply(this, arguments); };

  function submitInvite() {
    var entries = String($("newEmail").value || "").split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean)
      .filter(function (x, i, a) { return a.map(function (y) { return y.toLowerCase(); }).indexOf(x.toLowerCase()) === i; });
    if (!entries.length) return void alert("Enter the email address of the person to invite. It is the email they will log in with.");
    var bad = entries.filter(function (x) { return !EMAIL_RE.test(x); });
    if (bad.length) return void alert("Please fix these email addresses:\n" + bad.join("\n"));
    var co = company(); if (!co.id) return void alert("No company found for this login.");
    var role = $("newRole").value, custom = role === "custom" ? $("customRoleInput").value.trim() : null;
    if (role === "custom" && !custom) return void alert("Enter the custom role name.");
    var modules = Array.prototype.map.call(document.querySelectorAll('#moduleAccessList input[type="checkbox"]:checked:not(#moduleAccessSelectAll):not(.moduleGroupAll)'), function (x) { return x.value; });
    var rMode = (document.querySelector('input[name="reportAccessMode"]:checked') || {}).value || "all";
    var reports = rMode === "limited" ? Array.prototype.map.call(document.querySelectorAll("#reportAccessList input:checked"), function (x) { return x.value; }) : [];
    var all = invites(), users = companyUsers(co.id), skipped = [], fresh = [];
    entries.forEach(function (x) {
      var k = x.toLowerCase();
      var isUser = users.some(function (u) { return (u.email || "").toLowerCase() === k || (u.username || "").toLowerCase() === k; });
      var isPending = all.some(function (i) { return i.companyId === co.id && String(loginOf(i)).toLowerCase() === k && status(i) === "Pending"; });
      (isUser || isPending ? skipped : fresh).push(x);
    });
    if (!fresh.length) return void alert("Nothing to send: " + skipped.join(", ") + (skipped.length > 1 ? " are" : " is") + " already a user or has a pending invite.");
    var limit = W.planUserLimit ? W.planUserLimit(co.plan) : null;
    if (limit != null) {
      var pend = all.filter(function (i) { return i.companyId === co.id && status(i) === "Pending"; }).length;
      if (users.length + pend + fresh.length > limit) return void alert("User limit reached: the " + co.plan + " plan allows " + limit + " user(s) in total (" + users.length + " current, " + pend + " pending invite(s)). Upgrade your plan to invite more.");
    }
    var now = Date.now(), made = fresh.map(function (x) {
      return { id: "inv_" + rnd(6), secret: rnd(16), email: x.toLowerCase(), username: "", name: "", phone: "", role: role, customRole: custom, modules: modules, reportAccessMode: rMode, reports: reports,
        companyId: co.id, companyName: co.name, invitedBy: me().username || me().email || "", created: now, expires: now + 6048e5, status: "pending" };
    });
    saveInvites(all.concat(made));
    try { W.logAudit && W.logAudit("create", "User Management", "Invited " + fresh.join(", ")); } catch (e) {}
    W.closeCreateUserModal();
    renderSection();
    showResult(made, skipped);
  }

  function showResult(list, skipped) {
    var rows = list.map(function (inv, i) {
      return '<div style="border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-top:8px"><b>' + esc(loginOf(inv)) + "</b>" +
        '<div style="margin-top:8px">' + actionsHtml(inv, i) + "</div></div>";
    }).join("");
    var o = overlay('<h2 style="font-weight:700;font-size:15px">✅ Invitation' + (list.length > 1 ? "s" : "") + ' created</h2>' +
      '<p style="color:#4b5563;margin-top:4px">Send each person their link. WhatsApp opens with the message ready (choose the contact), and Email opens your mail app addressed to them. The link works for 7 days and lets them choose their own username and password.</p>' + rows +
      (skipped.length ? '<p style="color:#b45309;margin-top:8px">Skipped (already a user or already invited): ' + esc(skipped.join(", ")) + "</p>" : "") +
      '<div style="text-align:right;margin-top:14px"><button id="acxInvDone" style="background:#d1d5db;padding:6px 14px;border-radius:4px">Done</button></div>');
    wireActions(o, list);
    o.querySelector("#acxInvDone").onclick = function () { o.remove(); };
  }

  /* ---------- the Invitations table under the user list ---------- */
  function renderSection() {
    var tab = $("userManagementTab"); if (!tab) return;
    var box = $("acxInvitesSection");
    if (!box) {
      box = document.createElement("div"); box.id = "acxInvitesSection"; box.className = "mt-6";
      var c = $("userTableContainer"); if (c && c.nextSibling) tab.insertBefore(box, c.nextSibling); else tab.appendChild(box);
    }
    var co = company(), list = invites().filter(function (i) { return i.companyId === co.id; }).sort(function (a, b) { return b.created - a.created; });
    if (!list.length) { box.innerHTML = ""; return; }
    var colors = { Pending: "#b45309", Accepted: "#15803d", Expired: "#6b7280", Revoked: "#b91c1c" };
    box.innerHTML = '<h3 class="text-sm font-bold mb-2">✉️ Invitations</h3><div style="overflow-x:auto"><table class="w-full border text-sm"><thead class="bg-gray-100"><tr>' +
      ["Email", "Role", "Invited", "Expires", "Status", "Actions"].map(function (h) { return '<th class="border p-2 text-left">' + h + "</th>"; }).join("") + '</tr></thead><tbody class="bg-white">' +
      list.map(function (inv, i) {
        var st = status(inv), pend = st === "Pending", renew = pend || st === "Expired";
        return '<tr class="border-b"><td class="border p-2">' + esc(loginOf(inv)) + "</td>" +
          '<td class="border p-2">' + esc(roleLabel(inv)) + '</td><td class="border p-2">' + new Date(inv.created).toLocaleDateString() + '</td><td class="border p-2">' + new Date(inv.expires).toLocaleDateString() + "</td>" +
          '<td class="border p-2" style="font-weight:700;color:' + colors[st] + '">' + st + '</td><td class="border p-2">' +
          (pend ? actionsHtml(inv, i) : "") +
          (renew ? '<button style="' + BTN + '" data-act="renew" data-id="' + inv.id + '">' + (st === "Expired" ? "Renew" : "Extend") + "</button>" : "") +
          (st !== "Accepted" && st !== "Revoked" ? '<button style="' + BTN + '" data-act="revoke" data-id="' + inv.id + '">Revoke</button>' : "") +
          (st === "Accepted" || st === "Revoked" ? '<button style="' + BTN + '" data-act="remove" data-id="' + inv.id + '">Remove</button>' : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    wireActions(box, list);
    box.querySelectorAll("button[data-act]").forEach(function (b) {
      b.onclick = function () {
        if (!(W.hasRole && W.hasRole("admin"))) return void alert("🚫 You do not have permission to do that. Please contact your administrator.");
        var all = invites(), inv = all.find(function (x) { return x.id === b.dataset.id; }); if (!inv) return;
        var act = b.dataset.act;
        if (act === "renew") { inv.expires = Date.now() + 6048e5; inv.status = "pending"; }
        if (act === "revoke") { if (!confirm("Revoke the invitation for " + loginOf(inv) + "? Their link will stop working.")) return; inv.status = "revoked"; }
        if (act === "remove") all = all.filter(function (x) { return x.id !== inv.id; });
        saveInvites(all); renderSection();
      };
    });
  }

  /* ---------- the person opening the link ---------- */
  async function fetchInvite(p) {
    if (!W.supabase || !W.__SUPA_URL__) throw new Error("Could not reach the server. Check your internet connection and try again.");
    var c = W.supabase.createClient(W.__SUPA_URL__, W.__SUPA_KEY__, { auth: { storageKey: "acx-invite-check", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    var r = await c.from("company_state").select("value").eq("company_id", p.c).eq("key", KEY).maybeSingle();
    if (r.error) throw new Error("Could not verify the invitation: " + r.error.message);
    var v = r.data && r.data.value, n = 0;
    while (typeof v === "string" && n++ < 3) { try { v = JSON.parse(v); } catch (e) { v = []; } }
    var inv = (Array.isArray(v) ? v : []).find(function (x) { return x.id === p.i && x.secret === p.s; });
    if (!inv) throw new Error("This invitation was not found. It may have been revoked, or has not finished syncing yet. Ask your administrator to resend it.");
    return inv;
  }
  function b64d(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return JSON.parse(atob(s)); }

  async function startAccept() {
    var q = new URLSearchParams(location.search).get("acxInvite"); if (!q) return;
    var p; try { p = b64d(q); } catch (e) { return void overlay("<p>This invitation link is not valid.</p>"); }
    var ov = overlay("<p>Checking your invitation…</p>"), box = ov.firstChild, inv;
    function closeBox(msg, title) {
      box.innerHTML = '<h2 style="font-weight:700">' + title + '</h2><p style="margin-top:8px">' + esc(msg) + '</p><div style="text-align:right;margin-top:12px"><button id="acxX" style="background:#d1d5db;padding:6px 14px;border-radius:4px">Close</button></div>';
      box.querySelector("#acxX").onclick = function () { ov.remove(); };
    }
    try { inv = await fetchInvite(p); } catch (e) { return void closeBox(e.message, "Invitation problem"); }
    var bad = inv.status === "revoked" ? "This invitation has been revoked." : inv.status === "accepted" ? "This invitation has already been used." : Date.now() > inv.expires ? "This invitation has expired. Ask your administrator to renew it." : "";
    if (bad) return void closeBox(bad, "Invitation unavailable");
    var F = "width:100%;margin-top:8px;padding:8px;border:1px solid #d1d5db;border-radius:4px", byMail = !!inv.email;
    box.innerHTML = '<h2 style="font-weight:700;font-size:16px">Join ' + esc(inv.companyName) + '</h2><p style="color:#4b5563;margin-top:4px">You were invited by ' + esc(inv.invitedBy || "your administrator") +
      " as <b>" + esc(roleLabel(inv)) + "</b>. " + (byMail ? "Choose a username and password to finish." : "Set your password to finish.") + "</p>" +
      '<input id="acxAccLogin" style="' + F + ';background:#f3f4f6" value="' + esc(loginOf(inv)) + '" readonly>' +
      (byMail ? '<input id="acxAccName" style="' + F + '" placeholder="Username">' : '<input id="acxAccEmail" style="' + F + '" placeholder="Email (optional, for password reset)">') +
      '<input id="acxAccPass" type="password" style="' + F + '" placeholder="Password (min 6 characters)"><input id="acxAccPass2" type="password" style="' + F + '" placeholder="Confirm password">' +
      '<p id="acxAccMsg" style="color:#b91c1c;margin-top:8px;min-height:18px"></p><div style="text-align:right;margin-top:8px"><button id="acxAccGo" style="background:#1e3a8a;color:#fff;font-weight:700;padding:6px 16px;border-radius:4px">Accept &amp; create account</button></div>';
    var msg = box.querySelector("#acxAccMsg");
    box.querySelector("#acxAccGo").onclick = async function () {
      var pass = box.querySelector("#acxAccPass").value, pass2 = box.querySelector("#acxAccPass2").value;
      var uname = byMail ? box.querySelector("#acxAccName").value.trim() : inv.username;
      var mail = byMail ? inv.email : ((box.querySelector("#acxAccEmail").value || "").trim().toLowerCase());
      if (!uname) return void (msg.textContent = "Enter a username.");
      if (mail && !EMAIL_RE.test(mail)) return void (msg.textContent = "That email address does not look right.");
      if (pass.length < 6) return void (msg.textContent = "Password must be at least 6 characters.");
      if (pass !== pass2) return void (msg.textContent = "Passwords do not match.");
      var users = jget("users", []);
      var clash = users.some(function (u) {
        return String(u.companyId) === String(inv.companyId) && ((mail && (u.email || "").toLowerCase() === mail) || (u.username || "").toLowerCase() === uname.toLowerCase());
      });
      if (clash) return void (msg.textContent = "That username or email already exists in this company. Choose another one, or log in if you already have an account.");
      var rec = { username: uname, email: mail, role: inv.role, customRole: inv.customRole || null, modules: inv.modules || [], reportAccessMode: inv.reportAccessMode || "all",
        reports: inv.reports || [], companyId: String(inv.companyId), companyName: inv.companyName, registered: new Date().toISOString(), provider: "local", invitedVia: inv.id };
      await W.setUserPassword(rec, pass);
      users.push(rec); localStorage.setItem("users", JSON.stringify(users));
      try { W.uploadLocalStorage && W.uploadLocalStorage(); } catch (e) {}
      history.replaceState(null, "", location.href.split("?")[0]);
      var login = mail || uname;
      box.innerHTML = '<h2 style="font-weight:700;font-size:16px">✅ Account created</h2><p style="margin-top:8px">Log in with <b>' + esc(login) + "</b>, company <b>" + esc(inv.companyName) + '</b> and your new password.</p>' +
        '<div style="text-align:right;margin-top:12px"><button id="acxGoLogin" style="background:#1e3a8a;color:#fff;font-weight:700;padding:6px 16px;border-radius:4px">Go to login</button></div>';
      box.querySelector("#acxGoLogin").onclick = function () {
        ov.remove();
        var e1 = $("loginEmail"), e2 = $("loginCompanyId"); if (e1) e1.value = login; if (e2) e2.value = inv.companyName;
        try { W.openLogin && W.openLogin(); } catch (e) {}
      };
    };
  }

  function init() {
    renderSection();
    var tab = $("userManagementTab");
    if (tab) new MutationObserver(function () { if (!tab.classList.contains("hidden")) renderSection(); }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    startAccept();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  W.acxInvites = { linkFor: linkFor, messageFor: messageFor, waUrl: waUrl, mailUrl: mailUrl, status: status };
})(window);
