// dwolla/creditFlows.js
// Real money-movement for Reg E provisional credit + reversal, to plug into the
// disputes module's callbacks. These fill the stubs left in disputes.js.
//
// Provisional credit: push the disputed amount from your platform Dwolla Balance
// to the disputing user's bank. Reversal (after a denial): debit it back — but
// ONLY after the required consumer notice window has elapsed (see note below).
//
// Idempotency keys are derived from the dispute id so a retry never double-moves.

import { createTransfer } from "./transfers.js";

/**
 * @param deps.prisma
 * @param deps.platformBalanceFundingSourceUrl  your Master Account's Dwolla Balance
 *        funding source URL (the "balance" type source — NOT a bank).
 */
export function makeCreditFlows({ prisma, platformBalanceFundingSourceUrl }) {
  if (!platformBalanceFundingSourceUrl) {
    throw new Error("platformBalanceFundingSourceUrl required");
  }

  async function userBank(userId) {
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u?.fundingSourceUrl) throw new Error(`user ${userId} has no funding source`);
    return u.fundingSourceUrl;
  }

  /** Provisional credit: platform balance -> user's bank. Idempotent per dispute. */
  async function creditUser(dispute) {
    const destination = await userBank(dispute.userId);
    return createTransfer({
      sourceFundingSourceUrl: platformBalanceFundingSourceUrl,
      destinationFundingSourceUrl: destination,
      amountCents: dispute.amountCents,
      idempotencyKey: `provcredit-${dispute.id}`,
    });
  }

  /**
   * Reversal after a denial: user's bank -> platform balance.
   * IMPORTANT: Reg E requires giving the consumer advance notice BEFORE debiting
   * back a provisional credit. Do not call this immediately on denial — schedule
   * it after your notice window (e.g. via a delayed job), then call it.
   */
  async function reverseProvisionalCredit(dispute) {
    const source = await userBank(dispute.userId);
    return createTransfer({
      sourceFundingSourceUrl: source,
      destinationFundingSourceUrl: platformBalanceFundingSourceUrl,
      amountCents: dispute.amountCents,
      idempotencyKey: `reversal-${dispute.id}`,
    });
  }

  return { creditUser, reverseProvisionalCredit };
}
