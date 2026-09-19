// Weekly consent / PENDING_DISCONNECT tracking.
// US/CA banks fire PENDING_DISCONNECT ~7 days before Plaid drops the Item.
// We persist that deadline, then re-check /item/get at most once a week so a
// missed webhook still shows "reconnect by {date}" in the banks list.
import { plaid } from "./client.js";
import { decryptPlaidToken } from "./tokenCrypto.js";

export const CONSENT_SCAN_MS = 7 * 24 * 60 * 60 * 1000;
export const REAUTH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function needsWeeklyConsentScan(item, now = Date.now()) {
  if (!item?.consentScannedAt) return true;
  return now - new Date(item.consentScannedAt).getTime() >= CONSENT_SCAN_MS;
}

export function parseDisconnectDeadline(body = {}) {
  const raw = body.disconnect_time || body.consent_expiration_time;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function webhookConsentPatch(body = {}, actions = {}) {
  const patch = {};
  const deadline = parseDisconnectDeadline(body);
  if (deadline) patch.consentExpiresAt = deadline;

  const code = body.webhook_code;
  if (code === "PENDING_DISCONNECT" || code === "PENDING_EXPIRATION") {
    patch.pendingDisconnectAt = new Date();
    if (body.reason) patch.disconnectReason = String(body.reason);
  }

  if (actions.itemStatus === "ACTIVE") {
    patch.pendingDisconnectAt = null;
    patch.disconnectReason = null;
  }

  return patch;
}

export async function scanItemConsent(prisma, plaidItem) {
  const accessToken = decryptPlaidToken(plaidItem.accessToken);
  const res = await plaid.itemGet({ access_token: accessToken });
  const expiresRaw = res.data?.item?.consent_expiration_time;
  const data = { consentScannedAt: new Date() };

  if (expiresRaw) {
    const expires = new Date(expiresRaw);
    data.consentExpiresAt = expires;
    const msLeft = expires.getTime() - Date.now();
    if (
      plaidItem.status === "ACTIVE"
      && msLeft > 0
      && msLeft <= REAUTH_WINDOW_MS
    ) {
      data.status = "REAUTH_REQUIRED";
    }
  }

  return prisma.plaidItem.update({ where: { id: plaidItem.id }, data });
}

/** Re-check Plaid consent on items not scanned in the last week. */
export async function scanStaleConsent(prisma, userId, now = Date.now()) {
  const items = await prisma.plaidItem.findMany({
    where: { userId, status: { in: ["ACTIVE", "REAUTH_REQUIRED"] } },
  });
  const updated = [];
  for (const item of items) {
    if (!needsWeeklyConsentScan(item, now)) continue;
    try {
      updated.push(await scanItemConsent(prisma, item));
    } catch (err) {
      console.warn("[plaid] weekly consent scan failed:", item.id, err?.response?.data || err.message);
    }
  }
  return updated;
}
