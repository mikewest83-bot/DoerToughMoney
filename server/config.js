export function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const required = ["DATABASE_URL", "JWT_SECRET", "WEB_ORIGIN"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  if (process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production");

  // Dwolla keys aren't set up yet. dwolla/client.js already throws lazily on
  // first actual use, so relax the hard startup requirement to a warning —
  // auth and browsing the app still work without them; identity verification,
  // bank linking, and payments will error until real keys are added.
  const dwollaMissing = ["DWOLLA_KEY", "DWOLLA_SECRET", "DWOLLA_WEBHOOK_SECRET"].filter((name) => !process.env[name]);
  if (dwollaMissing.length) {
    console.warn(`[config] Missing Dwolla env vars (${dwollaMissing.join(", ")}) — identity verification, bank linking, and payments will fail until they're set.`);
  }
}

// True when Dwolla credentials are present. Background jobs check this so the
// app can run without them (they'd otherwise throw on every scheduled tick).
export const dwollaConfigured = () => !!(process.env.DWOLLA_KEY && process.env.DWOLLA_SECRET);

// Platform fee parameters, read from env. Off (all zero) unless configured.
//   PLATFORM_FEE_BPS        basis points, e.g. 150 = 1.5%
//   PLATFORM_FEE_FLAT_CENTS flat add-on per payment, in cents
//   PLATFORM_FEE_CAP_CENTS  optional maximum fee, in cents
// The fee is charged to the sender on the Dwolla transfer itself and
// auto-credits Dwolla's Master Account Balance — there's no platform ledger
// account in this app (no in-app balances at all).
export const feeParams = () => {
  const bps = Number.parseInt(process.env.PLATFORM_FEE_BPS || "0", 10) || 0;
  const flatCents = Number.parseInt(process.env.PLATFORM_FEE_FLAT_CENTS || "0", 10) || 0;
  const capRaw = process.env.PLATFORM_FEE_CAP_CENTS;
  const capCents = capRaw ? Number.parseInt(capRaw, 10) : Infinity;
  return { bps, flatCents, capCents };
};

// Fee for the optional faster-delivery upgrade, charged only when the sender
// chooses EXPRESS. Priced separately from the base fee so the free-standard /
// paid-express split can be tuned independently.
//   EXPEDITE_FEE_BPS         basis points, e.g. 175 = 1.75%
//   EXPEDITE_FEE_FLAT_CENTS  flat add-on, in cents
//   EXPEDITE_FEE_CAP_CENTS   optional maximum, in cents
export const expediteFeeParams = () => {
  const bps = Number.parseInt(process.env.EXPEDITE_FEE_BPS || "0", 10) || 0;
  const flatCents = Number.parseInt(process.env.EXPEDITE_FEE_FLAT_CENTS || "0", 10) || 0;
  const capRaw = process.env.EXPEDITE_FEE_CAP_CENTS;
  const capCents = capRaw ? Number.parseInt(capRaw, 10) : Infinity;
  return { bps, flatCents, capCents };
};

// Express is only offered when it's actually priced — otherwise it'd be a free
// upgrade nobody would decline, and every transfer would cost us Same Day fees.
export const expediteOffered = () => {
  const { bps, flatCents } = expediteFeeParams();
  return bps > 0 || flatCents > 0;
};

// Instant Payments (RTP/FedNow) requires TWO things: the recipient's bank must
// list the real-time-payments channel, AND Real Time Payments must be enabled
// on our own Dwolla account — a capability you request from Dwolla separately.
// Without the account-level grant, Dwolla rejects the transfer outright with
// "Real Time Payments not enabled for this account", so this stays off until
// that's granted and express quietly delivers via Same Day ACH instead.
export const rtpEnabled = () => process.env.DWOLLA_RTP_ENABLED === "true";

// Instant Account Verification runs through Dwolla's Open Banking Services and
// needs no credentials beyond Dwolla's — but it DOES require Open Banking
// scopes on your Dwolla application, which are granted per account. Without
// them, creating an exchange session returns 401 InvalidScope. Opt-in on
// purpose: enable it only once Dwolla has granted the scopes, so the UI never
// leads with a bank-login button that can't work.
export const instantLinkEnabled = () =>
  dwollaConfigured() && process.env.DWOLLA_OPEN_BANKING_ENABLED === "true";
