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
