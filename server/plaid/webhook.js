// plaid/webhook.js
// Express handler for Plaid webhooks (item, transactions, recurring).
// Plaid signs webhooks with a JWT in the Plaid-Verification header.
//
// Mount with the JSON body parser so we can hash the raw buffer Plaid signed:
//   app.post("/webhooks/plaid", express.json({ verify }), plaidWebhook(prisma));
import { plaid } from "./client.js";
import { syncItem, syncAccounts } from "./sync.js";
import { syncRecurring } from "./recurring.js";
import { webhookConsentPatch } from "./consent.js";
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

const TXN_SYNC_CODES = new Set([
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "TRANSACTIONS_REMOVED",
  "SYNC_UPDATES_AVAILABLE",
]);

/**
 * Decide what a verified Plaid webhook should do. Pure — unit-tested.
 * Unknown types ack as no-ops so Plaid does not retry forever.
 */
export function classifyPlaidWebhook(body = {}) {
  const type = body.webhook_type;
  const code = body.webhook_code;
  const errorCode = body.error?.error_code;
  const actions = {
    syncTransactions: false,
    syncRecurring: false,
    syncAccounts: false,
    itemStatus: null,
  };

  if (type === "TRANSACTIONS") {
    if (code === "RECURRING_TRANSACTIONS_UPDATE") {
      actions.syncRecurring = true;
    } else if (TXN_SYNC_CODES.has(code)) {
      actions.syncTransactions = true;
      if (code === "HISTORICAL_UPDATE" || body.historical_update_complete === true) {
        actions.syncRecurring = true;
      }
    }
  }

  if (type === "RECURRING_TRANSACTIONS") {
    actions.syncRecurring = true;
  }

  if (type === "ITEM") {
    if (code === "LOGIN_REPAIRED") {
      actions.itemStatus = "ACTIVE";
      actions.syncTransactions = true;
    } else if (
      code === "PENDING_EXPIRATION"
      || code === "PENDING_DISCONNECT"
      || code === "ITEM_LOGIN_REQUIRED"
      || errorCode === "ITEM_LOGIN_REQUIRED"
    ) {
      actions.itemStatus = "REAUTH_REQUIRED";
    } else if (code === "USER_PERMISSION_REVOKED") {
      actions.itemStatus = "ERROR";
    } else if (code === "ERROR") {
      actions.itemStatus = errorCode === "ITEM_LOGIN_REQUIRED" ? "REAUTH_REQUIRED" : "ERROR";
    } else if (code === "NEW_ACCOUNTS_AVAILABLE") {
      actions.syncAccounts = true;
    }
  }

  return actions;
}

export async function handlePlaidWebhook(prisma, body) {
  const plaidItemId = body?.item_id;
  const item = plaidItemId
    ? await prisma.plaidItem.findUnique({ where: { plaidItemId } })
    : null;

  const actions = classifyPlaidWebhook(body);
  if (!item) return actions;

  const consentPatch = webhookConsentPatch(body, actions);
  const data = { ...consentPatch };
  if (actions.itemStatus) data.status = actions.itemStatus;
  if (Object.keys(data).length) {
    await prisma.plaidItem.update({ where: { id: item.id }, data });
  }

  if (actions.syncAccounts) {
    await syncAccounts(prisma, item);
  }

  if (actions.syncTransactions) {
    await syncItem(prisma, item);
  }

  if (actions.syncRecurring) {
    try {
      await syncRecurring(prisma, item);
    } catch (err) {
      // Recurring is an add-on. A missing product must not 500 the webhook
      // (Plaid would retry for hours). Transaction sync already succeeded.
      console.warn("[plaid] recurring sync failed:", err?.response?.data || err.message);
    }
  }

  return actions;
}

export function plaidWebhook(prisma) {
  return async (req, res) => {
    const ok = await verifyPlaidWebhook(req).catch(() => false);
    if (!ok) return res.status(403).send("bad signature");

    try {
      await handlePlaidWebhook(prisma, req.body || {});
      return res.status(200).send("ok");
    } catch (err) {
      console.error("[plaid] webhook handler error:", err);
      return res.status(500).send("retry");
    }
  };
}
