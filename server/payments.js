// The single money path. Both a direct payment and a group settle-up go through
// sendMoney(), so velocity limits, fee computation, Dwolla's idempotency key and
// the ledger record can't drift apart between two copies of this logic.
import prisma, { createTransferRecord, newIdempotencyKey } from "./db.js";
import {
  checkVelocity, VelocityError, createTransfer, supportsInstant,
} from "./dwolla/index.js";
import { computeFee } from "./logic.js";
import { feeParams, expediteFeeParams, expediteOffered, rtpEnabled } from "./config.js";

// Instant delivery needs both the recipient's bank and our own Dwolla account
// to support Real Time Payments.
export const canSendInstantly = (user) => rtpEnabled() && supportsInstant(user.fundingSourceChannels);

/** Thrown for conditions the caller should turn into a 4xx, not a 500. */
export class PaymentError extends Error {
  constructor(message, { status = 400, reason } = {}) {
    super(message);
    this.name = "PaymentError";
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Can this pair actually move money right now? Returns an error message, or
 * null when the transfer is allowed. Callers use this to offer an alternative
 * (like settling in cash) instead of failing outright.
 */
export function transferBlockedReason(sender, recipient) {
  if (sender.kycStatus !== "VERIFIED" || !sender.fundingSourceVerified)
    return "Finish identity verification and link a bank before sending money.";
  if (!recipient?.fundingSourceVerified)
    return `${recipient?.name || "They"} hasn't linked a verified bank account yet.`;
  return null;
}

/**
 * Move money from one even user to another via Dwolla, and record it.
 *
 * @param sender     full user row (needs dwollaCustomerUrl + fundingSourceUrl)
 * @param recipient  full user row
 * @param cents      integer cents
 * @param note       feed description
 * @param speed      "STANDARD" | "EXPRESS" — express only honored when priced
 * @param chargeFees whether to apply the platform fee. Settling a shared expense
 *                   is moving money you already owe, not a new payment, so the
 *                   caller decides rather than having a fee silently applied.
 * @returns the persisted Transfer row plus fee breakdown
 */
export async function sendMoney({ sender, recipient, cents, note, speed: requestedSpeed = "STANDARD", chargeFees = true }) {
  if (!Number.isInteger(cents) || cents <= 0) throw new PaymentError("Enter an amount above $0.");
  if (sender.id === recipient.id) throw new PaymentError("You can't pay yourself.");

  const blocked = transferBlockedReason(sender, recipient);
  if (blocked) throw new PaymentError(blocked, { status: 403 });

  // Express is only honored when it's actually priced, so a modified client
  // can't get Same Day/Instant delivery (which costs us more) for free.
  const speed = requestedSpeed === "EXPRESS" && expediteOffered() ? "EXPRESS" : "STANDARD";
  const baseFeeCents = chargeFees ? computeFee(cents, feeParams()) : 0;
  const expediteFeeCents = speed === "EXPRESS" ? computeFee(cents, expediteFeeParams()) : 0;
  const feeCents = baseFeeCents + expediteFeeCents;

  try {
    await checkVelocity(prisma, { userId: sender.id, amountCents: cents });
  } catch (e) {
    if (e instanceof VelocityError)
      throw new PaymentError("You've hit a sending limit. Try again later or with a smaller amount.", { status: 429, reason: e.reason });
    throw e;
  }

  const { dwollaTransferUrl, dwollaTransferId, idempotencyKey, usedInstant } = await createTransfer({
    sourceFundingSourceUrl: sender.fundingSourceUrl,
    destinationFundingSourceUrl: recipient.fundingSourceUrl,
    amountCents: cents,
    feeCents,
    feeChargeToCustomerUrl: feeCents > 0 ? sender.dwollaCustomerUrl : undefined,
    idempotencyKey: newIdempotencyKey(),
    speed,
    destinationSupportsInstant: canSendInstantly(recipient),
  });

  const transfer = await createTransferRecord({
    idempotencyKey, providerRef: dwollaTransferId, providerUrl: dwollaTransferUrl,
    senderId: sender.id, recipientId: recipient.id,
    amountCents: cents, feeCents, expediteFeeCents, speed, note,
  });

  return { transfer, feeCents, expediteFeeCents, speed, usedInstant };
}
