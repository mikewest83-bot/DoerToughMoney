export function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const required = ["DATABASE_URL", "JWT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "WEB_ORIGIN"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  if (process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production");
}

// The user row that collects platform fees (seeded by migration 0003).
export const PLATFORM_USER_ID = process.env.PLATFORM_USER_ID || "u_platform";

// Platform fee parameters, read from env. Off (all zero) unless configured.
//   PLATFORM_FEE_BPS        basis points, e.g. 150 = 1.5%
//   PLATFORM_FEE_FLAT_CENTS flat add-on per payment, in cents
//   PLATFORM_FEE_CAP_CENTS  optional maximum fee, in cents
export const feeParams = () => {
  const bps = Number.parseInt(process.env.PLATFORM_FEE_BPS || "0", 10) || 0;
  const flatCents = Number.parseInt(process.env.PLATFORM_FEE_FLAT_CENTS || "0", 10) || 0;
  const capRaw = process.env.PLATFORM_FEE_CAP_CENTS;
  const capCents = capRaw ? Number.parseInt(capRaw, 10) : Infinity;
  return { bps, flatCents, capCents };
};
