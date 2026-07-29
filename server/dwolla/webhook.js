// dwolla/webhook.js
// Express handler for Dwolla webhooks. Verifies the HMAC signature over the RAW
// body, then routes events to the ledger. Mount with a raw body parser:
//
//   import express from "express";
//   import { dwollaWebhook } from "./dwolla/webhook.js";
//   app.post("/webhooks/dwolla",
//     express.raw({ type: "application/json" }),   // req.body is a Buffer
//     dwollaWebhook(prisma));
//
// The raw body is required — parsing to JSON first breaks the signature check.
import crypto from "crypto";
import { applyTransferStatus } from "./ledger.js";

const SECRET = process.env.DWOLLA_WEBHOOK_SECRET;

/** Constant-time HMAC-SHA256 verification of the raw request body. */
export function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Map a Dwolla event topic to an even transfer status. Transfers between
// Verified Customers fire customer-scoped topics (customer_transfer_completed,
// customer_bank_transfer_completed for the bank legs), so match by suffix.
// Bank-leg events carry their own resource ids that won't match our stored
// transfer id — applyTransferStatus safely no-ops on unknown ids.
function statusForTopic(topic) {
  if (!topic) return null;
  // ACH can bounce AFTER completion — a return must reverse the ledger.
  if (topic.includes("transfer_returned") || topic.includes("_return"))
    return "RETURNED";
  if (topic.endsWith("transfer_created")) return "PENDING";
  if (topic.endsWith("transfer_completed")) return "POSTED";
  if (topic.endsWith("transfer_failed")) return "FAILED";
  if (topic.endsWith("transfer_cancelled")) return "FAILED";
  return null;
}

export function dwollaWebhook(prisma, hooks = {}) {
  return async (req, res) => {
    const raw = req.body; // Buffer, thanks to express.raw()
    const sig = req.get("X-Request-Signature-SHA-256");

    if (!verifySignature(raw, sig)) {
      return res.status(403).send("bad signature");
    }

    let event;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).send("bad payload");
    }

    const { topic, resourceId } = event;

    try {
      const status = statusForTopic(topic);
      if (status && resourceId) {
        await applyTransferStatus(prisma, resourceId, status);
      }

      // Optional hooks for non-transfer events (KYC + funding source).
      if (topic === "customer_verified" && hooks.onCustomerVerified)
        await hooks.onCustomerVerified(resourceId);
      if (
        topic === "customer_verification_document_needed" &&
        hooks.onDocumentNeeded
      )
        await hooks.onDocumentNeeded(resourceId);
      if (
        (topic === "customer_funding_source_added" ||
          topic === "customer_funding_source_verified") &&
        hooks.onFundingSourceReady
      )
        await hooks.onFundingSourceReady(resourceId);

      // An Open Banking connection has gone stale (bank password changed, MFA
      // expired, consent lapsed). Payments on that funding source will fail
      // until the user re-authenticates, so this needs surfacing rather than
      // swallowing.
      if (topic === "customer_exchange_reauth_required" && hooks.onReauthRequired)
        await hooks.onReauthRequired(resourceId);

      // Always 200 once handled so Dwolla stops retrying.
      return res.status(200).send("ok");
    } catch (err) {
      console.error("[dwolla] webhook handler error:", err);
      // 500 -> Dwolla will retry with backoff; safe because handlers are idempotent.
      return res.status(500).send("retry");
    }
  };
}
