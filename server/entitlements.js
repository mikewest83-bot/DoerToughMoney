// ── Entitlements ─────────────────────────────────────────
// The single place that answers "is this user paying, and what does that
// buy them?" Every paid-feature check in the app goes through here, so the
// answer can never drift between two routes.
//
// What Pro unlocks, and why these and not others:
//   • Unlimited linked banks. Plaid bills per connected Item — that is, per
//     bank login — so this is the one limit where our price tracks our cost
//     instead of fighting it. Free accounts get FREE_BANK_LIMIT (default 1),
//     which is enough for the app to be genuinely useful.
//   • Insights — the category breakdown and month-over-month view.
//   • Bills, including negotiable-bill detection.
//   • Affordability — joining a DealTough verdict to real balances. The deal
//     verdict itself stays free for everyone: it's the hook, and it costs us
//     nothing per call beyond DealTough's own budget.
//
// Deliberately inert until PAYWALL_ENABLED is set. Shipping this without the
// variable changes nothing about how the app behaves, so the deploy can be
// verified on its own before any user hits a wall. Flip the variable to arm
// it. Same seam pattern as Mike AI's entitlements.mjs.
const PAYWALL_ENABLED = String(process.env.PAYWALL_ENABLED || "").trim() === "1";

// Owner keeps full access without paying himself. Reuses the variable that
// already identifies him, so there's nothing new to set.
const OWNER_EMAIL = (process.env.DOERBOT_OWNER_EMAIL || "").trim().toLowerCase();

// How many banks a free account may link. Existing links are never revoked
// when this changes — the limit is only ever checked when adding a new one.
const FREE_BANK_LIMIT = Number.isFinite(Number(process.env.FREE_BANK_LIMIT))
  && Number(process.env.FREE_BANK_LIMIT) > 0
  ? Number(process.env.FREE_BANK_LIMIT)
  : 1;

export const paywallEnabled = () => PAYWALL_ENABLED;
export const freeBankLimit = () => FREE_BANK_LIMIT;

export function isOwner(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  return !!OWNER_EMAIL && !!email && email === OWNER_EMAIL;
}

// stripe.js writes subscriptionTier: "pro" for every entitled status,
// past_due included (Stripe is mid-retry, not gone). So the tier string is
// the whole answer here — this function must not second-guess it.
export function isPro(user) {
  return String(user?.subscriptionTier || "") === "pro";
}

// The one question every gate asks. With the paywall disarmed this is true
// for everyone, which is exactly what makes the deploy inert.
export function hasPaidAccess(user) {
  if (!PAYWALL_ENABLED) return true;
  if (!user) return false;
  if (isOwner(user)) return true;
  return isPro(user);
}

// True when the user may link one more bank.
export function canLinkAnotherBank(user, currentBankCount) {
  if (hasPaidAccess(user)) return true;
  return Number(currentBankCount || 0) < FREE_BANK_LIMIT;
}

// 402 Payment Required, with a stable machine-readable code the client keys
// off to show the upgrade prompt rather than a generic error.
export function upgradeRequired(res, message) {
  return res.status(402).json({
    error: "upgrade_required",
    message: message || "This is a DoerToughMoney Pro feature.",
  });
}

// Route middleware for wholly-Pro endpoints.
export function proRequired(req, res, next) {
  if (hasPaidAccess(req.user)) return next();
  return upgradeRequired(res);
}
