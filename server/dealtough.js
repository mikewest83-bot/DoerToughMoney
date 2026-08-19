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
 * DealTough's Comparable is {price, similarity?, source?, sold?,
 * distanceMiles?, condition?} — but callers naturally reach for a plain
 * array of numbers ([1200, 1350, 1180]). Number.isFinite(c.price) is false
 * for a bare number (c.price is undefined), so every comparable silently
 * failed validation and DealTough's engine saw zero usable comps —
 * valuationBasis came back "unknown" on every single analysis, no matter
 * how good the input was.
 *
 * This accepts numbers, numeric strings, or {price, ...} objects, and drops
 * (rather than zero-coerces) anything blank/null/non-positive — a blank
 * comparable becoming a false $0 comp is worse than just not counting it,
 * since it drags every valuation down.
 */
export function normalizeDealInput(dealInput) {
  const input = dealInput && typeof dealInput === "object" ? dealInput : {};
  const rawComparables = Array.isArray(input.comparables) ? input.comparables : [];

  const comparables = rawComparables
    .map((c) => {
      if (typeof c === "number" || typeof c === "string") {
        const price = Number(c);
        return Number.isFinite(price) && price > 0 ? { price } : null;
      }
      if (c && typeof c === "object") {
        const price = Number(c.price);
        return Number.isFinite(price) && price > 0 ? { ...c, price } : null;
      }
      return null;
    })
    .filter(Boolean);

  return { ...input, comparables };
}

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
    body: JSON.stringify(normalizeDealInput(dealInput)),
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
