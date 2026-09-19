// server/plaid/recurring.js
// Turns Plaid Recurring streams into Bill rows for "safe to spend".
// Outflows that are MATURE become bills. Inflows are payday, not bills.
// EARLY_DETECTION is ignored (one Amazon hit is not a subscription).
import { plaid, dollarsToCents } from "./client.js";
import {
  decryptPlaidToken,
  encryptPlaidToken,
  isEncryptedPlaidToken,
} from "./tokenCrypto.js";

export function mapPlaidFrequency(freq) {
  switch (String(freq || "").toUpperCase()) {
    case "WEEKLY": return "WEEKLY";
    case "MONTHLY": return "MONTHLY";
    case "ANNUALLY":
    case "ANNUAL":
    case "YEARLY": return "YEARLY";
    default: return "UNKNOWN";
  }
}

export function shouldCreateBillFromStream(stream) {
  if (!stream || stream.is_active === false) return false;
  return String(stream.status || "").toUpperCase() === "MATURE";
}

export function isTombstonedStream(stream) {
  return String(stream?.status || "").toUpperCase() === "TOMBSTONED"
    || stream?.is_active === false;
}

function amountCentsFromStream(stream) {
  const raw = stream?.last_amount?.amount ?? stream?.average_amount?.amount;
  if (raw == null) return 0;
  return Math.abs(dollarsToCents(raw));
}

async function plaintextToken(prisma, plaidItem) {
  const plaintext = decryptPlaidToken(plaidItem.accessToken);
  if (!isEncryptedPlaidToken(plaidItem.accessToken)) {
    await prisma.plaidItem.update({
      where: { id: plaidItem.id },
      data: { accessToken: encryptPlaidToken(plaintext) },
    });
  }
  return plaintext;
}

function isRecurringUnavailable(err) {
  const code = err?.response?.data?.error_code || err?.error_code || "";
  return [
    "PRODUCTS_NOT_SUPPORTED",
    "INVALID_PRODUCT",
    "ADDITIONAL_CONSENT_REQUIRED",
    "PRODUCT_NOT_READY",
    "PRODUCT_NOT_ENABLED",
  ].includes(code);
}

/**
 * Fetch recurring streams for one Item and upsert mature outflows as Bills.
 * Returns { billsUpserted, billsDeactivated, linked, skipped } or { skipped: reason }.
 */
export async function syncRecurring(prisma, plaidItem) {
  const accessToken = await plaintextToken(prisma, plaidItem);
  let data;
  try {
    const res = await plaid.transactionsRecurringGet({ access_token: accessToken });
    data = res.data;
  } catch (err) {
    if (isRecurringUnavailable(err)) {
      console.warn("[plaid] recurring not enabled for this Item — skipping.");
      return { skipped: "not_enabled" };
    }
    throw err;
  }

  const outflows = Array.isArray(data.outflow_streams) ? data.outflow_streams : [];
  let billsUpserted = 0;
  let billsDeactivated = 0;
  let linked = 0;

  for (const stream of outflows) {
    const streamId = stream.stream_id;
    if (!streamId) continue;

    if (isTombstonedStream(stream)) {
      const existing = await prisma.bill.findUnique({ where: { plaidStreamId: streamId } });
      if (existing?.active) {
        await prisma.bill.update({ where: { id: existing.id }, data: { active: false } });
        billsDeactivated += 1;
      }
      continue;
    }

    if (!shouldCreateBillFromStream(stream)) continue;

    const name = String(stream.merchant_name || stream.description || "Recurring bill").trim();
    const category = stream.personal_finance_category?.primary || null;
    const nextDueOn = stream.predicted_next_date ? new Date(stream.predicted_next_date) : null;
    const amountCents = amountCentsFromStream(stream) || 0;

    const bill = await prisma.bill.upsert({
      where: { plaidStreamId: streamId },
      create: {
        userId: plaidItem.userId,
        name,
        category,
        amountCents,
        cadence: mapPlaidFrequency(stream.frequency),
        nextDueOn,
        autoDetected: true,
        active: true,
        plaidStreamId: streamId,
      },
      update: {
        name,
        category,
        amountCents,
        cadence: mapPlaidFrequency(stream.frequency),
        nextDueOn,
        autoDetected: true,
        active: true,
      },
    });
    billsUpserted += 1;

    const txnIds = Array.isArray(stream.transaction_ids) ? stream.transaction_ids.filter(Boolean) : [];
    if (txnIds.length) {
      const result = await prisma.transaction.updateMany({
        where: {
          userId: plaidItem.userId,
          plaidTransactionId: { in: txnIds },
          billId: null,
        },
        data: { billId: bill.id },
      });
      linked += result.count;
    }
  }

  return { billsUpserted, billsDeactivated, linked };
}
