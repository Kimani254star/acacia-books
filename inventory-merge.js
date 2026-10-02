/* Inventory "Merge" button: merges items that share the same Name + SKU (same warehouse). */
(function () {
  'use strict';
  var norm = function (s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); };
  var num = function (v) { return parseFloat(v) || 0; };
  var note = function (m, t) { return typeof showNotification === 'function' ? showNotification(m, t) : alert(m); };

  /* Keep Merge visible exactly when Bulk Delete is visible */
  function syncVisibility() {
    var del = document.getElementById('bulkDeleteBtn');
    var mrg = document.getElementById('bulkMergeBtn');
    if (del && mrg) mrg.classList.toggle('hidden', del.classList.contains('hidden'));
  }
  function watch() {
    var del = document.getElementById('bulkDeleteBtn');
    if (!del) return setTimeout(watch, 500);
    syncVisibility();
    new MutationObserver(syncVisibility).observe(del, { attributes: true, attributeFilter: ['class'] });
  }

  function mergeGroup(list) {
    var first = list[0];
    var merged = Object.assign({}, first);
    var totalQty = 0, totalCost = 0, batchMap = {}, batchOrder = [], hist = [];
    list.forEach(function (it) {
      var q = num(it.qty);
      totalQty += q; totalCost += q * num(it.buyPrice);
      (it.batches || []).forEach(function (b) {
        var k = norm(b.batchNo) + '|' + (b.expiryDate || '');
        if (batchMap[k]) batchMap[k].qty = num(batchMap[k].qty) + num(b.qty);
        else { batchMap[k] = Object.assign({}, b, { qty: num(b.qty) }); batchOrder.push(k); }
      });
      hist = hist.concat(Array.isArray(it.history) ? it.history : []);
    });
    merged.batches = batchOrder.map(function (k) { return batchMap[k]; });
    merged.qty = merged.batches.length ? merged.batches.reduce(function (a, b) { return a + num(b.qty); }, 0) : totalQty;
    if (totalQty > 0) merged.buyPrice = +(totalCost / totalQty).toFixed(4); /* weighted average cost */
    merged.active = list.some(function (it) { return it.active !== false; });
    var user = '-';
    try { var me = JSON.parse(localStorage.getItem('loggedInUser') || 'null'); if (me && me.username) user = me.username; } catch (e) {}
    hist.push({ date: new Date().toISOString().slice(0, 10), type: 'Merged', qty: merged.qty, ref: 'Merged ' + list.length + ' duplicate items', user: user, buyPrice: merged.buyPrice });
    merged.history = hist;
    return merged;
  }

  window.bulkMergeInventory = function () {
    var run = function () {
      var sel = document.getElementById('warehouseSelect');
      var whFilter = sel ? sel.value : '';
      var checked = Array.from(document.querySelectorAll('.itemCheckbox:checked'));

      /* Which items are in scope: ticked rows, otherwise everything in the current view */
      var scope = {}; /* wh -> Set(index) or null = all */
      if (checked.length) {
        checked.forEach(function (cb) {
          var wh = cb.getAttribute('data-wh') || whFilter;
          if (!wh) return;
          (scope[wh] = scope[wh] || new Set()).add(parseInt(cb.dataset.index));
        });
      } else if (whFilter) {
        scope[whFilter] = null;
      } else {
        (typeof __invWarehouseNames === 'function' ? __invWarehouseNames() : []).forEach(function (w) { scope[w] = null; });
      }

      var plans = [];
      Object.keys(scope).forEach(function (wh) {
        var items = getInventory(wh);
        var groups = {};
        items.forEach(function (it, i) {
          if (!it || (scope[wh] && !scope[wh].has(i))) return;
          var k = norm(it.name) + '||' + norm(it.sku);
          (groups[k] = groups[k] || []).push(i);
        });
        var dup = Object.keys(groups).filter(function (k) { return groups[k].length > 1; });
        if (dup.length) plans.push({ wh: wh, items: items, groups: dup.map(function (k) { return groups[k]; }) });
      });

      if (!plans.length) {
        return note(checked.length
          ? 'Selected items have no duplicates (same name + SKU) to merge.'
          : 'No duplicate items found (same name + SKU).', 'error');
      }

      var count = 0, lines = [];
      plans.forEach(function (p) {
        p.groups.forEach(function (g) {
          count += g.length;
          var it = p.items[g[0]];
          lines.push('• ' + (it.name || '-') + ' [' + (it.sku || 'no SKU') + '] — ' + g.length + ' lines (' + p.wh + ')');
        });
      });
      var shown = lines.slice(0, 15).join('\n') + (lines.length > 15 ? '\n…and ' + (lines.length - 15) + ' more' : '');
      if (!confirm('Merge ' + count + ' items into ' + lines.length + ' item(s)?\n\n' + shown +
        '\n\nQuantities and batches are added together; buying price becomes the weighted average.')) return;

      plans.forEach(function (p) {
        var drop = new Set(), replace = {};
        p.groups.forEach(function (g) {
          replace[g[0]] = mergeGroup(g.map(function (i) { return p.items[i]; }));
          g.slice(1).forEach(function (i) { drop.add(i); });
        });
        var out = [];
        p.items.forEach(function (it, i) {
          if (drop.has(i)) return;
          out.push(replace[i] || it);
        });
        saveInventory(p.wh, out);
      });

      if (typeof __invRefreshCaches === 'function') { try { __invRefreshCaches(); } catch (e) {} }
      if (typeof syncInventoryBalancesToCOA === 'function') { try { syncInventoryBalancesToCOA(); } catch (e) {} }
      if (typeof renderInventoryTable === 'function') renderInventoryTable();
      ['renderProfitMargin', 'renderAccounts', 'renderBalanceSheet', 'renderSimpleWarehouseMovement', 'renderStockReports'].forEach(function (fn) {
        if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} }
      });
      note('🔗 Merged ' + count + ' items into ' + lines.length, 'success');
    };
    if (typeof guardAction === 'function') guardAction('canEdit', run, '🚫 Only Admin or Account can merge items.');
    else run();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
