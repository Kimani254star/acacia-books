/* Acacia Books – real payments shim.
 * Load AFTER the app scripts:  <script defer src="payments-real.js"></script>
 *
 * What it does (sign-up / subscription payments only – customer invoice gateways keep working as before):
 *   M-Pesa + Airtel  -> uses the server backend by default (no per-browser gateway setup needed)
 *   Card             -> Paystack / Stripe / Flutterwave checkout opened in a popup, confirmed by the server
 *   PayPal           -> after the browser captures the order, the server asks PayPal if it really was paid
 *   Bank / cheque    -> a unique reference is recorded on the server so you can confirm the money arrived
 */
(function () {
  "use strict";
  if (window.__acxRealPayments) return;
  window.__acxRealPayments = true;

  var CFG = Object.assign(
    {
      base: (window.__SUPA_URL__ || "https://xglsampckermarjpczdf.supabase.co") + "/functions/v1/pay",
      cardProvider: "paystack", // "paystack" | "stripe" | "flutterwave"
      paypalClientId: "",       // paste your PayPal Client ID here to show the PayPal button at sign-up
      kesPerUsd: 129,           // PayPal cannot take KES, so prices are converted to USD at this rate
      pollMs: 4000,
      maxWaitMs: 10 * 60 * 1000,
    },
    window.ACX_PAY_CONFIG || {}
  );

  var inSignup = 0; // >0 while a sign-up payment handler is running (synchronous part)

  function J(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; }
  }
  function me() { return J("loggedInUser", null) || {}; }
  function url(path) { return CFG.base.replace(/\/$/, "") + path; }

  function post(path, body) {
    return fetch(url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; });
    });
  }
  function get(path) {
    return fetch(url(path)).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  /* ---------- 1. M-Pesa / Airtel: default to the server during sign-up ---------- */
  var origGateway = window.acxActiveGateway;
  if (typeof origGateway === "function") {
    window.acxActiveGateway = function (name) {
      var g = origGateway.apply(this, arguments);
      if (g || !inSignup) return g;
      if (name === "M-Pesa (Daraja)") return { name: name, active: true, stkEndpoint: url("/mpesa"), mode: "Server" };
      if (name === "Airtel Money") return { name: name, active: true, stkEndpoint: url("/airtel"), mode: "Server" };
      return g;
    };
  }

  /* ---------- 2. Card checkout (server-created, server-verified) ---------- */
  var origCard = window.acxRealCardCheckout;
  window.acxRealCardCheckout = function (opts) {
    if (!inSignup && typeof origCard === "function") return origCard.apply(this, arguments);
    opts = opts || {};
    var onStatus = opts.onStatus || function () {};
    var prov = String(CFG.cardProvider || "paystack").toLowerCase();
    var email = opts.email || me().email || "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      onStatus({ status: "error", message: "A valid email address is needed for card payments." });
      return;
    }

    // Must open the window inside the click so the browser doesn't block it.
    var win = window.open("", "acx_pay", "width=520,height=720");
    if (!win) {
      onStatus({ status: "error", message: "Your browser blocked the payment window. Allow pop-ups for this site and try again." });
      return;
    }
    try { win.document.write("<p style='font:16px sans-serif;padding:24px'>Opening secure checkout…</p>"); } catch (e) {}

    var initPath = prov === "stripe" ? "/stripe/create-checkout-session" : "/" + prov + "/init";
    post(initPath, {
      amount: opts.amount,
      email: email,
      accountReference: opts.accountRef || "",
      transactionDesc: opts.description || "Payment",
      description: opts.description || "Payment",
      returnUrl: new URL("pay-return.html", location.href).href,
    }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.url || !d.checkoutRequestId) throw new Error(d.error || "Couldn't start card checkout.");
      win.location.href = d.url;
      onStatus({ status: "pending", checkoutRequestId: d.checkoutRequestId });
      pollStatus("/" + prov + "/status/" + encodeURIComponent(d.checkoutRequestId), win, onStatus);
    }).catch(function (err) {
      try { win.close(); } catch (e) {}
      onStatus({ status: "error", message: err.message });
    });
  };

  function pollStatus(path, win, onStatus) {
    var started = Date.now(), closedAt = 0, done = false;
    (function tick() {
      if (done) return;
      get(path).then(function (d) {
        if (d.status === "success") { done = true; try { win.close(); } catch (e) {} return onStatus({ status: "success", receipt: d.receipt }); }
        if (d.status === "failed") { done = true; try { win.close(); } catch (e) {} return onStatus({ status: "failed", message: d.message }); }
        var closed = false; try { closed = win.closed; } catch (e) {}
        if (closed && !closedAt) closedAt = Date.now();
        // popup closed without a result: give the provider ~20s to confirm, then stop
        if (closedAt && Date.now() - closedAt > 20000) { done = true; return onStatus({ status: "failed", message: "Checkout was closed before payment completed." }); }
        if (Date.now() - started > CFG.maxWaitMs) { done = true; return onStatus({ status: "failed", message: "Timed out waiting for payment." }); }
        setTimeout(tick, CFG.pollMs);
      }).catch(function () { setTimeout(tick, CFG.pollMs); });
    })();
  }

  /* ---------- 3. PayPal: charge in USD, then confirm with PayPal before activating ---------- */
  var origRender = window.acxRenderPaypalButton;
  window.acxRenderPaypalButton = function (containerId, scope) {
    if (!CFG.paypalClientId) {
      var c0 = document.getElementById(containerId);
      if (c0) c0.innerHTML = '<p class="text-sm text-gray-500">PayPal is not switched on yet.</p>';
      return;
    }
    var container = document.getElementById(containerId);
    if (!container) return;
    var kes = 0, desc = "Acacia Books subscription";
    if (scope === "register") { kes = Number(me().price) || 0; if (me().plan) desc = me().plan + " plan"; }
    else {
      var pe = document.getElementById("price-input"), ple = document.getElementById("plan-input");
      kes = parseFloat(pe && pe.value) || 0; if (ple && ple.value) desc = ple.value + " plan";
    }
    var usd = Math.max(1, Math.ceil((kes / (Number(CFG.kesPerUsd) || 129)) * 100) / 100);
    window.__acxPaypalExpectUsd = usd;
    container.innerHTML = '<p class="text-sm text-gray-600 mb-2">You will be charged <b>USD ' + usd.toFixed(2) + '</b> (KES ' + kes + ').</p><div></div>';
    var holder = container.lastChild;
    var load = typeof window.acxLoadScript === "function" ? window.acxLoadScript : function (src) {
      return new Promise(function (res, rej) { var sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    };
    load("https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(CFG.paypalClientId) + "&currency=USD").then(function () {
      if (!window.paypal || !window.paypal.Buttons) { holder.innerHTML = '<p class="text-sm text-red-600">Couldn\'t load PayPal.</p>'; return; }
      window.paypal.Buttons({
        createOrder: function (d, actions) {
          return actions.order.create({ purchase_units: [{ amount: { value: usd.toFixed(2), currency_code: "USD" }, description: desc }] });
        },
        onApprove: function (d, actions) {
          return actions.order.capture().then(function (details) { window.acxHandlePaypalCapture(details, scope); });
        },
        onError: function () { alert("PayPal checkout error. Please try again."); },
      }).render(holder);
    }).catch(function () { holder.innerHTML = '<p class="text-sm text-red-600">Couldn\'t load PayPal.</p>'; });
  };

  var origPaypal = window.acxHandlePaypalCapture;
  if (typeof origPaypal === "function") {
    window.acxHandlePaypalCapture = function (details, scope) {
      var orderId = details && details.id;
      var expect = Number(window.__acxPaypalExpectUsd) || 0;
      if (!orderId) return alert("PayPal did not return an order number. Please try again.");
      get("/paypal/verify/" + encodeURIComponent(orderId) + "?expect=" + encodeURIComponent(expect))
        .then(function (d) {
          if (d.status === "success") return origPaypal.call(window, details, scope);
          alert(d.status === "pending"
            ? "PayPal hasn't confirmed this payment yet. Please wait a moment and try again."
            : "We couldn't verify this PayPal payment" + (d.message ? ": " + d.message : d.error ? ": " + d.error : "") + ".");
        })
        .catch(function () { alert("We couldn't reach the payment server to verify PayPal. Please try again."); });
    };
  }

  /* ---------- 4. Wrap the sign-up handlers; record bank / cheque references ---------- */
  function wrapSignup(name, methodGetter) {
    var orig = window[name];
    if (typeof orig !== "function" || orig.__acxWrapped) return;
    var wrapped = function () {
      var method = methodGetter();
      if (method === "bank" || method === "cheque") recordManual(method);
      inSignup++;
      try { return orig.apply(this, arguments); } finally { inSignup--; }
    };
    wrapped.__acxWrapped = true;
    window[name] = wrapped;
  }

  function val(id) { var el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; }

  function recordManual(kind) {
    var u = me();
    var ref = kind === "bank" ? val("regBankRef") : (val("regChequeNumber") + " / " + val("regChequeBank"));
    if (!ref || ref === " / ") return; // original handler will ask the user to fill it in
    post("/bank/record", {
      kind: kind,
      amount: u.price,
      email: u.email || "",
      accountReference: u.companyId || u.username || "",
      customerReference: ref,
      transactionDesc: (u.plan || "Subscription") + " plan",
    }).then(function (res) {
      if (res.ok && res.data && res.data.reference) {
        try { localStorage.setItem("acx_lastManualPaymentRef", res.data.reference); } catch (e) {}
      }
    }).catch(function () {});
  }

  function install() {
    wrapSignup("completeRegPayment", function () { return val("regPaymentMethod"); });
    wrapSignup("completeRegistrationPayment", function () {
      var el = document.getElementById("payment-method");
      return el ? String(el.value || "") : "";
    });
  }
  install();
  window.addEventListener("load", install);
})();
