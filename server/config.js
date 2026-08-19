export function validateProductionConfig() {
  // Deliberately NOT gated on NODE_ENV — a missing/misspelled NODE_ENV used to
  // silently skip this whole check, letting the app boot with a hardcoded,
  // publicly-known JWT signing secret on a live, internet-reachable deploy.
  // vitest is the one legitimate case that needs to import server modules
  // without a real .env file.
  if (process.env.VITEST) return;
  const required = ["DATABASE_URL", "JWT_SECRET", "WEB_ORIGIN"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  if (process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");

  // Plaid keys aren't set up yet. plaid/client.js already throws lazily on
  // first actual use, so relax the hard startup requirement to a warning —
  // auth and browsing the app still work without them; connecting a bank and
  // syncing transactions will error until real keys are added.
  const plaidMissing = ["PLAID_CLIENT_ID", "PLAID_SECRET"].filter((name) => !process.env[name]);
  if (plaidMissing.length) {
    console.warn(`[config] Missing Plaid env vars (${plaidMissing.join(", ")}) — bank linking and transaction sync will fail until they're set.`);
  }
}

// True when Plaid credentials are present. Routes/jobs check this so the app
// can run without them (they'd otherwise throw on every request/tick).
export const plaidConfigured = () => !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
