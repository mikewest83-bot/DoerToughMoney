import { timingSafeEqual } from "node:crypto";

const MIN_TOKEN_BYTES = 32;

function sameToken(supplied, expected) {
  const left = Buffer.from(String(supplied || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireMikeBridge(req, res, next) {
  const expected = String(process.env.MIKE_BRIDGE_TOKEN || "");
  if (Buffer.byteLength(expected) < MIN_TOKEN_BYTES) {
    return res.status(503).json({ error: "bridge_not_configured" });
  }
  const authorization = String(req.get("authorization") || "");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!sameToken(supplied, expected)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

export function moneyBridgeStatus(capabilities = {}) {
  const flags = Object.fromEntries(
    Object.entries(capabilities).map(([name, enabled]) => [name, Boolean(enabled)]),
  );
  return {
    schemaVersion: 1,
    service: "doertoughmoney",
    ok: true,
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    capabilities: flags,
    dependencies: {
      database: Boolean(process.env.DATABASE_URL),
      ...flags,
    },
  };
}
