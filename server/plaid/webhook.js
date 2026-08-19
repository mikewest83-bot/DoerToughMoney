// plaid/webhook.js
// Express handler for Plaid webhooks (item + transaction updates). Plaid signs
// webhooks with a JWT in the Plaid-Verification header rather than a raw HMAC
// like Dwolla did — verification requires an extra round trip to fetch the
// signing key the JWT names, cached by key id since Plaid rotates keys rarely.
//
// Mount with the normal JSON body parser (unlike Dwolla's webhook, Plaid's
// signature covers the parsed body's SHA-256, not the raw bytes):
//   app.post("/webhooks/plaid", express.json(), plaidWebhook(prisma));
import { plaid } from "./client.js";
import { syncItem } from "./sync.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const keyCache = new Map(); // kid -> JWK

async function getVerificationKey(keyId) {
  if (keyCache.has(keyId)) return keyCache.get(keyId);
  const res = await plaid.webhookVerificationKeyGet({ key_id: keyId });
  const key = res.data.key;
  keyCache.set(keyId, key);
  return key;
}

/** Verify a Plaid webhook per their JWT + body-hash scheme. */
async function verifyPlaidWebhook(req) {
  const signedJwt = req.get("Plaid-Verification");
  if (!signedJwt) return false;

  const decoded = jwt.decode(signedJwt, { complete: true });
  const keyId = decoded?.header?.kid;
  if (!keyId) return false;

  const jwk = await getVerificationKey(keyId);
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });

  let payload;
  try {
    payload = jwt.verify(signedJwt, publicKey, { algorithms: ["ES256"], maxAge: "5m" });
  } catch {
    return false;
  }

  const expectedHash = crypto.createHash("sha256").update(req.rawBodyForPlaid || JSON.stringify(req.body)).digest("hex");
  return payload.request_body_sha256 === expectedHash;
}

export function plaidWebhook(prisma) {
  return async (req, res) => {
    const ok = await verifyPlaidWebhook(req).catch(() => false);
    if (!ok) return res.status(403).send("bad signature");

    const { webhook_type: type, webhook_code: code, item_id: plaidItemId } = req.body || {};

    try {
      const item = plaidItemId ? await prisma.plaidItem.findUnique({ where: { plaidItemId } }) : null;

      if (type === "TRANSACTIONS" && item) {
        // DEFAULT_UPDATE / INITIAL_UPDATE / HISTORICAL_UPDATE / SYNC_UPDATES_AVAILABLE
        // all mean the same thing here: something changed, go pull it.
        await syncItem(prisma, item);
      }

      if (type === "ITEM" && item) {
        if (code === "ERROR" || code === "PENDING_EXPIRATION" || code === "LOGIN_REPAIRED") {
          const status = code === "LOGIN_REPAIRED" ? "ACTIVE" : "REAUTH_REQUIRED";
          await prisma.plaidItem.update({ where: { id: item.id }, data: { status } });
        }
      }

      return res.status(200).send("ok");
    } catch (err) {
      console.error("[plaid] webhook handler error:", err);
      return res.status(500).send("retry");
    }
  };
}
