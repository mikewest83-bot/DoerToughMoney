// dealtough.js
// The DoerToughMoney <-> DealTough integration point. Per the product
// direction: DealTough stays its own codebase/deploy, DoerToughMoney calls
// out to it rather than the two apps merging.
//
// IMPORTANT — what actually exists today vs. what's still needed:
//
// DealTough's live engine (POST /api/v1/deals/analyze, see DealTough's
// src/app.ts + src/engine.ts) scores a SPECIFIC FOR-SALE LISTING against
// market comparables — "is this $15k BMW X5 a good deal" — using a
// DealInput shaped around category ("vehicle" | "electronics" | "tools" |
// "furniture" | "outdoor_equipment"), askingPrice, condition, and comparable
// prices. That's a real, callable, no-auth endpoint, and analyzeDeal() below
// wires it up for real — useful the moment DoerToughMoney wants to sanity-
// check a one-time purchase a user logs (a Transaction, not a Bill).
//
// What the product vision actually asks for — "your car insurance is $184/mo,
// try to lower this bill," negotiating a recurring insurance/internet/phone
// bill — is a DIFFERENT capability. There's no comparable-listing market for
// "my Comcast bill"; that needs something like an LLM-drafted negotiation
// script/talking points referencing typical competitor pricing, which
// DealTough's current engine doesn't do. suggestBillNegotiation() below is a
// clearly-marked stub for that — it needs real design + engine work in the
// DealTough repo (or a new module) before this is more than a placeholder.
const DEALTOUGH_API_URL = process.env.DEALTOUGH_API_URL; // e.g. https://dealtough-production.up.railway.app

export const dealtoughConfigured = () => !!DEALTOUGH_API_URL;

/**
 * Call DealTough's real analyzer for a one-time purchase decision.
 * @param {object} dealInput  DealTough's DealInput shape — category, title,
 *   askingPrice, comparables, etc. (see DealTough's src/types.ts)
 * @returns DealTough's DealRecommendation (dealScore, verdict, fairMarketValue, ...)
 */
export async function analyzeDeal(dealInput) {
  if (!dealtoughConfigured()) {
    throw new Error("DEALTOUGH_API_URL is not configured — set it to the DealTough deployment's base URL.");
  }
  const res = await fetch(`${DEALTOUGH_API_URL}/api/v1/deals/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dealInput),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `DealTough analyze failed (${res.status})`);
  }
  return res.json();
}

/**
 * STUB — not implemented against a real engine yet. See the module comment
 * above for why this needs new work rather than just a new API call.
 * @param {object} bill  a DoerToughMoney Bill row
 */
export async function suggestBillNegotiation(_bill) {
  throw new Error(
    "suggestBillNegotiation() is a placeholder — DealTough's current engine analyzes one-time purchase " +
    "listings against market comparables, not recurring bills. Negotiating something like a car-insurance " +
    "or internet bill needs new logic (e.g. an LLM-drafted negotiation script + typical competitor pricing), " +
    "either as a new DealTough engine mode or a separate feature — it isn't there yet."
  );
}
