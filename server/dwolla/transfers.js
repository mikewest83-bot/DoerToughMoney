// dwolla/transfers.js
// Create a bank-to-bank P2P transfer. Amounts are integer cents everywhere in
// even; we only convert to Dwolla's decimal string at the edge.
import { randomUUID } from "crypto";
import { dwolla, centsToValue, idFromUrl } from "./client.js";

/**
 * Initiate sender-bank -> recipient-bank transfer.
 *
 * @param opts.sourceFundingSourceUrl       sender's verified bank funding source
 * @param opts.destinationFundingSourceUrl  recipient's bank funding source
 * @param opts.amountCents                  integer cents
 * @param opts.feeCents                     even's facilitator fee (integer cents, 0 = none)
 * @param opts.feeChargeToCustomerUrl       the Customer resource URL that bears the fee
 *                                          (must be the sender or recipient of THIS transfer).
 *                                          The fee auto-credits to your Master Account Dwolla Balance.
 * @param opts.idempotencyKey               reuse across retries of the SAME logical transfer
 * @returns {{ dwollaTransferUrl, dwollaTransferId, idempotencyKey }}
 */
export async function createTransfer(opts) {
  const {
    sourceFundingSourceUrl,
    destinationFundingSourceUrl,
    amountCents,
    feeCents = 0,
    feeChargeToCustomerUrl,
    idempotencyKey = randomUUID(),
  } = opts;

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }

  const body = {
    _links: {
      source: { href: sourceFundingSourceUrl },
      destination: { href: destinationFundingSourceUrl },
    },
    amount: { currency: "USD", value: centsToValue(amountCents) },
  };

  // even's cut: a facilitator fee. `charge-to` must reference a CUSTOMER resource
  // (the sender or recipient of this transfer), NOT a funding source. The fee is
  // credited to your Master Account Dwolla Balance automatically — you don't route
  // it to a funding source yourself. Fee is only charged if the transfer processes
  // successfully (failed/cancelled = no fee), and cannot exceed 50% of the amount.
  if (feeCents > 0) {
    if (!feeChargeToCustomerUrl) {
      throw new Error(
        "feeCents > 0 requires feeChargeToCustomerUrl (the Customer bearing the fee)"
      );
    }
    body.fees = [
      {
        _links: { "charge-to": { href: feeChargeToCustomerUrl } },
        amount: { currency: "USD", value: centsToValue(feeCents) },
      },
    ];
  }

  // Idempotency-Key makes a retried request return the SAME transfer instead of
  // creating a second one — never move money twice on a network retry.
  const res = await dwolla.post("transfers", body, {
    "Idempotency-Key": idempotencyKey,
  });

  const dwollaTransferUrl = res.headers.get("location");
  return {
    dwollaTransferUrl,
    dwollaTransferId: idFromUrl(dwollaTransferUrl),
    idempotencyKey,
  };
}

/** Fetch a transfer's current status straight from Dwolla (for reconciliation). */
export async function getTransfer(dwollaTransferUrl) {
  const res = await dwolla.get(dwollaTransferUrl);
  return res.body; // { status: "pending"|"processed"|"failed"|"cancelled", ... }
}
