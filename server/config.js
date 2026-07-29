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
