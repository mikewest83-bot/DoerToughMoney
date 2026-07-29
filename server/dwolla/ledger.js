// dwolla/ledger.js
// even's record of money movement. In the bank-to-bank model there are NO
// in-app spendable balances (funds live in users' own banks + the Dwolla
// network held at Dwolla's partner bank), so this is an auditable transfer +
// fee record, not a custody balance. Status is always driven by Dwolla events,
// never guessed optimistically.
//
// Expects a Prisma client with the models in README.md (Transfer, TransferStatus).

const TERMINAL = new Set(["FAILED", "RETURNED"]);

/**
 * Idempotently move a Transfer to a new status in response to a Dwolla event.
 * Safe to call repeatedly (webhook replays) — a terminal transfer never changes,
 * and re-applying the same status is a no-op.
 */
export async function applyTransferStatus(prisma, dwollaTransferId, nextStatus) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({
      where: { providerRef: dwollaTransferId },
    });
    if (!transfer) {
      // Event arrived before we persisted the transfer, or it isn't ours.
      // Log and let the webhook return 200 so Dwolla stops retrying a ghost.
      console.warn(`[dwolla] no transfer for providerRef=${dwollaTransferId}`);
      return null;
    }
    if (transfer.status === nextStatus) return transfer; // replay no-op
    if (TERMINAL.has(transfer.status)) return transfer; // don't resurrect

    const data = { status: nextStatus, updatedAt: new Date() };

    // Fee accounting: even earns its facilitator fee only on a completed
    // transfer, and gives it back if the transfer later returns/fails.
    if (nextStatus === "POSTED") {
      data.feeCollected = transfer.feeCents > 0;
    }
    if (TERMINAL.has(nextStatus) && transfer.feeCollected) {
      data.feeCollected = false; // reverse recognized fee revenue
    }

    return tx.transfer.update({
      where: { id: transfer.id },
      data,
    });
  });
}

/**
 * Nightly reconciliation: pull each non-terminal transfer's status from Dwolla
 * and assert our record matches. Returns a list of drifts to alert on.
 */
export async function reconcile(prisma, getTransferFn) {
  const open = await prisma.transfer.findUnique
    ? await prisma.transfer.findMany({
        where: { status: { in: ["PENDING", "POSTED"] } },
      })
    : [];

  const drifts = [];
  for (const t of open) {
    try {
      const remote = await getTransferFn(t.providerUrl);
      const mapped = mapDwollaStatus(remote.status);
      if (mapped && mapped !== t.status) {
        drifts.push({ transferId: t.id, ours: t.status, dwolla: mapped });
      }
    } catch (e) {
      drifts.push({ transferId: t.id, error: String(e) });
    }
  }
  return drifts;
}

/** Map Dwolla transfer.status -> even status. */
export function mapDwollaStatus(s) {
  switch (s) {
    case "pending":
      return "PENDING";
    case "processed":
      return "POSTED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "FAILED";
    default:
      return null;
  }
}
