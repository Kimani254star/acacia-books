/* acacia-doc-preview.js
 * Invoice-style document previews for Acacia Books.
 *
 * Rebuilds the preview output for Stock Movement, Price List, Amendments /
 * Stock Adjustments, Bundle Items, Packages, Shipments, Delivery Notes and
 * Bulk Adjustments so every one of them renders in the same branded document
 * style used by the invoice preview (logo, company block, recipient block,
 * bordered tables, totals) and gains a "Share File" button that shares the
 * document as a standalone .html file (Web Share API on mobile, download
 * fallback on desktop).
 *
 * Loaded as the LAST script in index.html so it overrides the earlier
 * preview implementations.
 */
(function () {
  "use strict";
  var W = window;

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function esc(v) {
    return v == null ? "" : String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dp() {
    try { return W.__getDecimalPlaces ? W.__getDecimalPlaces() : 2; } catch (e) { return 2; }
  }

  function money(v) {
    var n = Number(v || 0);
    try { if (typeof W.formatCurrency === "function") return W.formatCurrency(n); } catch (e) {}
    return "KES " + n.toFixed(dp());
  }

  function fdate(v) {
    if (!v) return "-";
    try {
      var d = new Date(v);
      return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB");
    } catch (e) { return String(v); }
  }

  function org() {
    try { return JSON.parse(localStorage.getItem("orgInfo") || "{}") || {}; } catch (e) { return {}; }
  }

  function js(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]") || []; } catch (e) { return []; }
  }

  function today() { return fdate(new Date().toISOString()); }

  /* ------------------------------------------------------------------ */
  /* document CSS (shared by in-app modal + shared file + popup)         */
  /* ------------------------------------------------------------------ */

  var CSS =
    ".acx-doc{background:#fff;color:#111827;font-size:13.5px;line-height:1.55;padding:24px;border-radius:12px;font-family:inherit}" +
    ".acx-doc .acx-toprow{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;margin-bottom:20px}" +
    ".acx-doc .acx-doctitle{font-weight:800;font-size:15px;letter-spacing:.02em;color:#1e3a8a;text-align:center}" +
    ".acx-doc .acx-logowrap{text-align:center;margin-bottom:20px}" +
    ".acx-doc .acx-logo{max-width:260px;max-height:90px;object-fit:contain}" +
    ".acx-doc .acx-cols{display:flex;justify-content:space-between;gap:24px;margin-bottom:8px}" +
    ".acx-doc .acx-col-left{text-align:left;max-width:55%}" +
    ".acx-doc .acx-col-right{text-align:right;max-width:45%}" +
    ".acx-doc .acx-cols h4{font-weight:700;margin:0 0 8px;font-size:13px;color:#111827}" +
    ".acx-doc .acx-cols p{margin:0 0 2px;color:#374151;font-size:12.5px}" +
    ".acx-doc .acx-strong{font-weight:700;color:#111827;font-size:13.5px}" +
    ".acx-doc table.acx-meta{width:100%;border-collapse:collapse;margin-top:16px}" +
    ".acx-doc table.acx-meta th{text-align:left;padding:8px 12px;border:1px solid #e5e7eb;background:#f9fafb;color:#6b7280;font-weight:600;width:190px;font-size:12.5px;white-space:nowrap}" +
    ".acx-doc table.acx-meta td{padding:8px 12px;border:1px solid #e5e7eb;color:#111827}" +
    ".acx-doc table.acx-data{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}" +
    ".acx-doc table.acx-data th{background:#f3f4f6;border:1px solid #e5e7eb;padding:8px;text-align:left;font-weight:600;color:#374151}" +
    ".acx-doc table.acx-data td{border:1px solid #e5e7eb;padding:8px}" +
    ".acx-doc table.acx-data td.num{text-align:right}" +
    ".acx-doc .acx-totals{margin-top:18px;text-align:right;font-weight:600;font-size:13px}" +
    ".acx-doc .acx-totals div{margin:2px 0}" +
    ".acx-doc .acx-footer{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:8px;color:#6b7280;font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}" +
    ".acx-docbar{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb}" +
    ".acx-docbar button{background:#1e3a8a;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600}" +
    ".acx-docbar button.acx-secondary{background:#e5e7eb;color:#111827}" +
    ".acx-docbar button:hover{filter:brightness(1.08)}" +
    "@media print{.acx-docbar{display:none!important}.acx-doc{padding:0;border-radius:0}}";

  function ensureStyle() {
    if (!document.getElementById("acx-invdoc-style")) {
      var s = document.createElement("style");
      s.id = "acx-invdoc-style";
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }

  /* ------------------------------------------------------------------ */
  /* document builder                                                    */
  /* ------------------------------------------------------------------ */

  /* cfg: {
   *   title, ref, date,
   *   recipient: {heading, name, lines: []},
   *   meta: [[label, value]],
   *   table: {head: [], rows: [[]], rightCols: [idx]},
   *   totals: [[label, value]],
   *   company: {} (defaults to orgInfo)
   * } */
  function docHtml(cfg) {
    cfg = cfg || {};
    var o = cfg.company || org();
    var h = '<div class="acx-doc">';

    h += '<div class="acx-toprow"><div>' +
      (cfg.ref ? "<strong>Ref No:</strong> " + esc(cfg.ref) : "") +
      '</div><div class="acx-doctitle">' + esc(cfg.title || "Document") + "</div><div>" +
      (cfg.date ? "<strong>Date:</strong> " + esc(fdate(cfg.date)) : "") +
      "</div></div>";

    if (o.logo) h += '<div class="acx-logowrap"><img class="acx-logo" src="' + esc(o.logo) + '" alt="Company logo"></div>';

    h += '<div class="acx-cols">';
    var left = "";
    if (cfg.recipient && (cfg.recipient.name || (cfg.recipient.lines || []).length)) {
      left += "<h4>" + esc(cfg.recipient.heading || "Customer") + "</h4>";
      if (cfg.recipient.name) left += '<p class="acx-strong">' + esc(cfg.recipient.name) + "</p>";
      (cfg.recipient.lines || []).forEach(function (l) {
        if (l) left += "<p>" + esc(l) + "</p>";
      });
    }
    h += '<div class="acx-col-left">' + left + "</div>";

    var right = "<h4>Company</h4>";
    right += '<p class="acx-strong">' + esc(o.name || "My Company Ltd") + "</p>";
    if (o.address) right += "<p>" + esc(o.address) + "</p>";
    var contact = [o.email, o.phone].filter(Boolean).join(" | ");
    if (contact) right += "<p>" + esc(contact) + "</p>";
    if (o.pin) right += "<p>PIN: " + esc(o.pin) + "</p>";
    h += '<div class="acx-col-right">' + right + "</div></div>";

    if (cfg.meta && cfg.meta.length) {
      h += '<table class="acx-meta">' + cfg.meta.map(function (r) {
        return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
      }).join("") + "</table>";
    }

    if (cfg.table && cfg.table.head) {
      var rightCols = cfg.table.rightCols || [];
      h += '<table class="acx-data"><thead><tr>' +
        cfg.table.head.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
        "</tr></thead><tbody>" +
        (cfg.table.rows || []).map(function (r) {
          return "<tr>" + r.map(function (c, i) {
            return "<td" + (rightCols.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + esc(c) + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
    }

    if (cfg.totals && cfg.totals.length) {
      h += '<div class="acx-totals">' + cfg.totals.map(function (r) {
        return "<div>" + esc(r[0]) + ": " + esc(r[1]) + "</div>";
      }).join("") + "</div>";
    }

    h += '<div class="acx-footer"><span>Generated on ' + esc(new Date().toLocaleString()) + "</span>" +
      (o.name ? "<span>" + esc(o.name) + "</span>" : "") + "</div>";

    h += "</div>";
    return h;
  }

  /* Standalone HTML file for the Share File button. */
  function docFileHtml(cfg) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>" + esc(cfg.title || "Document") + "</title>" +
      "<style>" + CSS +
      "body{background:#f1f5f9;padding:24px;margin:0;font-family:Arial,Helvetica,sans-serif}" +
      ".acx-doc{max-width:820px;margin:0 auto;box-shadow:0 10px 30px -12px rgba(15,23,42,.25)}" +
      "@media print{body{background:#fff;padding:0}.acx-doc{box-shadow:none;max-width:none}}</style>" +
      "</head><body>" + docHtml(cfg) + "</body></html>";
  }

  /* ------------------------------------------------------------------ */
  /* share / print                                                       */
  /* ------------------------------------------------------------------ */

  function safeName(cfg) {
    var base = (cfg.title || "Document") + (cfg.ref ? "_" + cfg.ref : "");
    return base.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") + ".html";
  }

  function shareHtmlFile(filename, html) {
    var file = null;
    try {
      file = new File([html], filename, { type: "text/html" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: filename.replace(/\.html$/, "") }).catch(function () {});
        return;
      }
    } catch (e) {}
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 0);
    /* Inside an embedded preview frame downloads are often silently
     * blocked — also open the document in a new tab so something
     * always happens. The tab has its own Save button. */
    try {
      if (window.top !== window.self) {
        var w = window.open(url, "_blank");
        if (w) {
          setTimeout(function () {
            try {
              var bar = w.document.createElement("div");
              bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#1e3a8a;color:#fff;padding:10px 16px;font:14px Arial,sans-serif;text-align:center";
              bar.innerHTML = 'Opening <b>' + esc(filename) + '</b> in a new tab — if it did not download, use the button below.';
              var save = w.document.createElement("button");
              save.textContent = "⬇ Save File";
              save.style.cssText = "margin-left:12px;background:#fff;color:#1e3a8a;border:0;border-radius:4px;padding:6px 14px;font-weight:bold;cursor:pointer";
              save.onclick = function () {
                var a2 = w.document.createElement("a");
                a2.href = url; a2.download = filename;
                w.document.body.appendChild(a2); a2.click(); a2.remove();
              };
              bar.appendChild(save);
              w.document.body.appendChild(bar);
            } catch (e) {}
          }, 600);
        }
      }
    } catch (e) {}
  }

  function printModal(modal) {
    document.body.classList.add("uts-printing-doc");
    if (modal) modal.classList.add("uts-print-target");
    window.print();
  }

  /* ------------------------------------------------------------------ */
  /* modal plumbing                                                      */
  /* ------------------------------------------------------------------ */

  function attachShareToUtsFooter(modal, cfg) {
    var footer = modal.querySelector('[data-role="utsDocModalPrint"]') &&
      modal.querySelector('[data-role="utsDocModalPrint"]').parentElement;
    if (!footer) return null;
    var old = footer.querySelector("[data-acx-sharebtn]");
    if (old) old.remove();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-acx-sharebtn", "1");
    btn.className = "bg-blue-900 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-800";
    btn.textContent = "📤 Share File";
    btn.addEventListener("click", function () {
      shareHtmlFile(safeName(cfg), docFileHtml(cfg));
    });
    footer.insertBefore(btn, footer.lastElementChild);
    return btn;
  }

  function attachBarToWrapper(wrapper, modal, cfg) {
    var old = wrapper.querySelector(":scope > .acx-docbar");
    if (old) old.remove();
    var bar = document.createElement("div");
    bar.className = "acx-docbar";
    var mk = function (label, cls, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener("click", fn);
      return b;
    };
    bar.appendChild(mk("🖨 Print", "", function () { printModal(modal); }));
    bar.appendChild(mk("📤 Share File", "", function () {
      shareHtmlFile(safeName(cfg), docFileHtml(cfg));
    }));
    bar.appendChild(mk("✖ Close", "acx-secondary", function () {
      if (modal.id === "shipmentPreviewModal" && typeof W.closeShipmentPreview === "function") W.closeShipmentPreview();
      else if (modal.id === "deliveryPreviewModal" && typeof W.closeDeliveryPreview === "function") W.closeDeliveryPreview();
      else modal.classList.add("hidden");
    }));
    wrapper.appendChild(bar);
    return bar;
  }

  /* Open cfg as an invoice-style document inside modalId/wrapperId.
   * Falls back to a popup window when the modal does not exist. */
  function openIn(modalId, wrapperId, cfg, opts) {
    opts = opts || {};
    ensureStyle();
    var modal = document.getElementById(modalId);
    var wrapper = document.getElementById(wrapperId);
    if (!modal || !wrapper) {
      var w = window.open("", "_blank", "width=900,height=760");
      if (!w) { alert("Please allow pop-ups for this site to preview documents."); return; }
      var file = docFileHtml(cfg);
      var bar = '<div class="acx-docbar" style="max-width:820px;margin:16px auto 0">' +
        '<button onclick="window.print()">🖨 Print PDF</button>' +
        '<button id="acxShareBtn">📤 Share File</button>' +
        '<button class="acx-secondary" onclick="window.close()">✖ Close</button></div>' +
        "<script>document.getElementById('acxShareBtn').onclick=function(){" +
        "var html=document.querySelector('.acx-doc').parentElement.innerHTML;" +
        "var full='<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(cfg.title || "Document") + "</title></head><body style=\"font-family:Arial,sans-serif\">'+html+'</body></html>';" +
        "try{var f=new File([full],'" + safeName(cfg) + "',{type:'text/html'});" +
        "if(navigator.canShare&&navigator.canShare({files:[f]})){navigator.share({files:[f]});return;}}catch(e){}" +
        "var b=new Blob([full],{type:'text/html'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='" + safeName(cfg) + "';document.body.appendChild(a);a.click();a.remove();};<\/script>";
      w.document.write(file.replace("</body></html>", bar + "</body></html>"));
      w.document.close();
      if (opts.autoPrint) setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 350);
      return;
    }
    wrapper.innerHTML = docHtml(cfg);
    if (!attachShareToUtsFooter(modal, cfg)) attachBarToWrapper(wrapper, modal, cfg);
    modal.classList.remove("hidden");
    if (opts.autoPrint) setTimeout(function () { printModal(modal); }, 200);
  }

  /* ------------------------------------------------------------------ */
  /* public API                                                          */
  /* ------------------------------------------------------------------ */

  W.acaciaDocPreview = {
    open: openIn,
    docHtml: docHtml,
    docFileHtml: docFileHtml,
    shareHtmlFile: shareHtmlFile,
    helpers: { esc: esc, money: money, fdate: fdate, js: js, org: org, today: today }
  };

  /* ------------------------------------------------------------------ */
  /* module previews, all in invoice style                               */
  /* ------------------------------------------------------------------ */

  /* 1. Stock Movement */
  W.previewMovement = function (i) {
    var n = js("movements")[i];
    if (!n) return;
    openIn("movementPreviewModal", "movementTemplateWrapper", {
      title: "Stock Movement",
      date: n.date,
      meta: [["Item", n.item], ["From Warehouse", n.from], ["To Warehouse", n.to], ["Quantity", n.quantity]]
    });
  };

  /* 2. Price List */
  W.previewPrice = function (i, warehouse) {
    var o = js("priceList").filter(function (r) { return r.warehouse === warehouse; })[i];
    if (!o) { alert("Price list record not found!"); return; }
    openIn("pricelistPreviewModal", "pricelistTemplateWrapper", {
      title: "Price List",
      meta: [
        ["Warehouse", o.warehouse],
        ["Item", o.item],
        ["Selling Price", money(o.sellingPrice)],
        ["Cost Price", money(o.costPrice)],
        ["Margin", money(Number(o.sellingPrice || 0) - Number(o.costPrice || 0))],
        ["Effective Date", o.effectiveDate ? fdate(o.effectiveDate) : "-"]
      ]
    });
  };

  /* 3. Amendments / stock adjustment documents (preview + auto print) */
  W.previewStockAdjustmentDoc = function (e, t) {
    t = t || {};
    e = e || {};
    var rows = (e.rows || []).map(function (r) {
      return [r.product, r.sku || "-", r.oldQty != null ? r.oldQty : "-",
        r.newQty != null ? r.newQty : "-", r.change != null ? r.change : "-",
        r.reason || "-", r.status || "-"];
    });
    openIn("valueadjustmentPreviewModal", "valueadjustmentTemplateWrapper", {
      title: e.docTitle || "Stock Adjustment",
      ref: e.refNo,
      date: e.date,
      meta: [["Warehouse", e.warehouse || "-"]],
      table: {
        head: ["Product", "SKU", "Old Qty", "New Qty", "Change", "Reason", "Status"],
        rows: rows,
        rightCols: [2, 3, 4]
      }
    }, { autoPrint: t.autoPrint });
  };

  /* 4. Packages */
  W.viewPackage = function (id) {
    var a = js("orders").find(function (x) { return String(x.id) === String(id); });
    if (!a) { alert("Package not found"); return; }
    openIn("packagePreviewModal", "packageTemplateWrapper", {
      title: "Package Slip",
      ref: a.orderNo || a.packageNo || "",
      date: a.date,
      recipient: { heading: "Customer", name: a.customerName },
      meta: [["Status", a.packageStatus || "Not Shipped"]],
      table: {
        head: ["Item", "Qty", "Amount"],
        rows: (a.items || []).map(function (x) {
          return [x.desc || "-", x.qty != null ? x.qty : 0, (x.currency || "KES") + " " + (x.amount != null ? x.amount : 0)];
        }),
        rightCols: [2]
      },
      totals: a.total != null ? [["Total", a.total]] : []
    });
  };

  /* 5. Bundle Items */
  W.previewBundle = function (i) {
    var b;
    try { b = (typeof W.getBundles === "function" ? W.getBundles() : js("bundles"))[i]; } catch (e) { b = js("bundles")[i]; }
    if (!b) { alert("Bundle not found"); return; }
    var rows = (b.items || []).map(function (it) {
      var inv = null;
      try {
        if (typeof W.getInventory === "function") {
          inv = (W.getInventory(it.warehouse || "Unknown") || []).find(function (x) {
            return x.sku === it.item || x.name === it.item;
          });
        }
      } catch (e) {}
      return [it.item, it.qtyUsed != null ? it.qtyUsed : (it.qty != null ? it.qty : "-"),
        it.warehouse || "Unknown", inv && inv.qty != null ? inv.qty : "N/A"];
    });
    openIn("bundleitemPreviewModal", "bundleitemTemplateWrapper", {
      title: "Bundle / Composite Item",
      date: b.date,
      meta: [
        ["Name", b.name],
        ["Bundle Quantity", b.qty != null ? b.qty : 0],
        ["Destination Warehouse", b.toWarehouse || "-"]
      ],
      table: { head: ["Item", "Qty Used", "Source Warehouse", "Stock Qty"], rows: rows, rightCols: [1, 3] },
      totals: [
        ["Buy Cost", money(b.buyPrice)],
        ["Sell Price", money(b.sellPrice)],
        ["Margin", money(Number(b.sellPrice || 0) - Number(b.buyPrice || 0))]
      ]
    });
  };

  /* 6. Shipments */
  W.previewShipment = function (i) {
    var n = js("shipments")[i];
    if (!n) return;
    var c = js("customers").find(function (x) { return x.name === n.customer; }) || {};
    openIn("shipmentPreviewModal", "shipmentPreviewContentWrapper", {
      title: "Shipment Note",
      ref: n.shipmentNo,
      date: n.date,
      recipient: {
        heading: "Customer",
        name: c.name || n.customer,
        lines: [c.email, c.phone, c.address]
      },
      meta: [
        ["Item", n.item],
        ["Origin", n.origin || "-"],
        ["Destination", n.destination || "-"],
        ["Carrier", n.carrier || "-"],
        ["Tracking No.", n.trackingNo || "-"]
      ]
    });
  };

  /* 7. Delivery Notes */
  W.previewDelivery = function (i) {
    var n = js("deliveries")[i];
    if (!n) return;
    var c = js("customers").find(function (x) { return x.name === n.customer; }) || {};
    openIn("deliveryPreviewModal", "deliveryPreviewContentWrapper", {
      title: "Delivery Note",
      ref: n.dn,
      date: n.date,
      recipient: {
        heading: "Customer",
        name: c.name || n.customer,
        lines: [c.email, c.phone, c.address]
      },
      meta: [
        ["Location", n.location || "-"],
        ["Truck No.", n.truckNumber || "-"],
        ["Driver", n.driver || "-"],
        ["Tracking No.", n.trackNumber || "-"]
      ],
      table: {
        head: ["Item", "Qty"],
        rows: (n.items || []).map(function (x) { return [x.desc, x.qty != null ? x.qty : ""]; }),
        rightCols: [1]
      }
    });
  };

  /* 8. Bulk Adjustments — the log table becomes a proper document */
  W.exportBulkAdjustmentsPDF = function () {
    var body = document.getElementById("baLogBody");
    var rows = [];
    if (body) {
      Array.prototype.forEach.call(body.querySelectorAll("tr"), function (tr) {
        var tds = tr.querySelectorAll("td");
        if (tds.length < 7) return;
        var first = (tds[1].textContent || "").trim();
        if (/no adjustments/i.test(first)) return;
        rows.push([tds[1].textContent.trim(), tds[2].textContent.trim(), tds[3].textContent.trim(),
          tds[4].textContent.trim(), tds[5].textContent.trim(), tds[6].textContent.trim(),
          tds[7] ? tds[7].textContent.trim() : "-"]);
      });
    }
    if (!rows.length) { alert("No adjustments recorded yet to preview."); return; }
    var wh = "";
    try { wh = (document.getElementById("baWarehouseSelect") || {}).value || ""; } catch (e) {}
    openIn("valueadjustmentPreviewModal", "valueadjustmentTemplateWrapper", {
      title: "Bulk Adjustments",
      date: today(),
      meta: wh ? [["Warehouse", wh], ["Entries", rows.length]] : [["Entries", rows.length]],
      table: {
        head: ["Date", "Warehouse", "Product", "SKU", "Old Qty", "New Qty", "Change"],
        rows: rows,
        rightCols: [4, 5, 6]
      }
    });
  };
})();
