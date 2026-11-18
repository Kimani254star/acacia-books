// Vercel serverless function: relays Acacia Books -> KRA eTIMS OSCU.
// Browsers cannot call KRA directly (CORS), so the app posts here and this forwards to KRA.
// No secrets are stored here: KRA's OSCU is identified by PIN + branch + device serial + communication key,
// all of which the app sends. Nothing is logged or saved.
//
//   POST /api/etims   { env: "sandbox"|"production", path: "/selectInitOsdcInfo", tin, bhfId, cmcKey, body: {...} }
//
const BASE = { sandbox: "https://etims-api-sbx.kra.go.ke", production: "https://etims-api.kra.go.ke" };
const ALLOWED = ["/selectInitOsdcInfo", "/saveItems", "/saveTrnsSalesOsdc", "/selectCodeList", "/selectCustomer"];

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ resultCd: "ERR", resultMsg: "POST only" });
  let p = req.body;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { p = {}; } }
  p = p || {};
  const base = BASE[p.env === "production" ? "production" : "sandbox"];
  if (ALLOWED.indexOf(p.path) < 0) return res.status(400).json({ resultCd: "ERR", resultMsg: "Path not allowed" });
  if (!p.tin || !p.bhfId) return res.status(400).json({ resultCd: "ERR", resultMsg: "PIN and branch ID are required" });

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (p.path !== "/selectInitOsdcInfo") {
    if (!p.cmcKey) return res.status(400).json({ resultCd: "ERR", resultMsg: "Not connected: no communication key. Click Connect first." });
    headers.tin = String(p.tin); headers.bhfId = String(p.bhfId); headers.cmcKey = String(p.cmcKey);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(base + p.path, { method: "POST", headers, body: JSON.stringify(p.body || {}), signal: ctrl.signal });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch (e) { json = { resultCd: "ERR", resultMsg: "KRA returned a non-JSON response (HTTP " + r.status + ")", raw: text.slice(0, 300) }; }
    return res.status(200).json(json);
  } catch (e) {
    return res.status(200).json({ resultCd: "ERR", resultMsg: e.name === "AbortError" ? "KRA did not respond in time" : "Could not reach KRA: " + e.message });
  } finally { clearTimeout(timer); }
};
