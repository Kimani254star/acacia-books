(function () {
  "use strict";
  var KEY = "acxUniversalDrafts";
  var completing = Object.create(null);
  var beforeClick = null;
  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }
  function write(rows) { localStorage.setItem(KEY, JSON.stringify(rows)); }
  function snapshot() {
    var out = Object.create(null);
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k !== KEY) out[k] = localStorage.getItem(k);
    }
    return out;
  }
  function changed(a, b) {
    var keys = Object.keys(a).concat(Object.keys(b));
    for (var i = 0; i < keys.length; i++) if (a[keys[i]] !== b[keys[i]]) return true;
    return false;
  }
  function removeDraft(id) { write(read().filter(function (x) { return String(x.id) !== String(id); })); }
  function exactSaveButton(scope, section) {
    if (!scope) return null;
    var root = section || document;
    var nodes = Array.prototype.slice.call(root.querySelectorAll("button,input[type=submit]"));
    function token(el) {
      var raw = (el.getAttribute("onclick") || "").trim();
      var match = raw.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
      return match ? match[1] : (el.id || "");
    }
    return nodes.find(function (el) { return token(el) === scope && !el.disabled && !el.hidden; }) || null;
  }
  function finishAfterSave(id) {
    if (!beforeClick) return;
    var old = beforeClick;
    beforeClick = null;
    var now = snapshot();
    if (changed(old, now)) {
      removeDraft(id);
      delete completing[id];
      if (typeof window.acxRefreshHubDrafts === "function") window.acxRefreshHubDrafts();
      if (typeof window.showNotification === "function") window.showNotification("Draft completed and posted successfully.", "success");
    } else {
      delete completing[id];
      alert("The module did not save any transaction changes. The draft has been kept; check required fields and try again.");
    }
  }
  window.acxOnDraftSave = function (id) { window.setTimeout(function () { finishAfterSave(id); }, 800); };
  document.addEventListener("click", function (ev) {
    var target = ev.target && ev.target.closest ? ev.target.closest("button,input[type=submit]") : null;
    if (!target) return;
    beforeClick = snapshot();
  }, true);
  function addButtons() {
    document.querySelectorAll("tr[data-acx-draft]").forEach(function (row) {
      var id = row.getAttribute("data-acx-draft");
      var actions = row.querySelector("td:last-child");
      if (!actions || actions.querySelector("[data-acx-complete]")) return;
      var edit = actions.querySelector("[data-acx-edit]");
      if (!edit) return;
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = "Complete";
      button.className = "bg-blue-900 text-white px-2 py-1 rounded text-xs ml-1";
      button.setAttribute("data-acx-complete", id);
      actions.appendChild(button);
    });
  }
  window.acxCompleteUniversalDraft = function (id) {
    id = String(id);
    if (completing[id]) return;
    var record = read().find(function (x) { return String(x.id) === id; });
    if (!record) { alert("This draft no longer exists. Refresh the table."); return; }
    if (!record.scope) { alert("This draft has no saved module action. Open it with Edit and complete it using the module's normal Save button."); return; }
    var section = record.sec ? document.getElementById(record.sec) : null;
    var save = exactSaveButton(record.scope, section);
    if (!save) { alert("The original Save action for this draft could not be found in its module. The draft has not been changed."); return; }
    completing[id] = true;
    var edit = document.createElement("button");
    edit.type = "button"; edit.hidden = true; edit.setAttribute("data-acx-edit", id);
    document.body.appendChild(edit); edit.click(); edit.remove();
    beforeClick = snapshot();
    try { save.click(); }
    catch (e) { delete completing[id]; beforeClick = null; alert("The module could not complete this draft: " + (e.message || e)); return; }
    window.setTimeout(function () {
      if (completing[id]) finishAfterSave(id);
    }, 1200);
  };
  document.addEventListener("click", function (ev) {
    var button = ev.target && ev.target.closest ? ev.target.closest("[data-acx-complete]") : null;
    if (!button) return;
    ev.preventDefault(); ev.stopPropagation();
    window.acxCompleteUniversalDraft(button.getAttribute("data-acx-complete"));
  }, true);
  var observer = new MutationObserver(addButtons);
  function start() { addButtons(); observer.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
