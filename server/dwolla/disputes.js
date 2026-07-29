// dwolla/disputes.js
// Regulation E dispute lifecycle for even. Reg E governs consumer electronic
// fund transfer disputes and imposes hard deadlines. This module encodes the
// MECHANICAL timeline; the legal specifics (extensions, new-account rules,
// exact notice wording) must be reviewed with counsel.
//
// Standard timeline this enforces:
//   - Investigate within 10 BUSINESS days of the dispute, OR
//   - issue PROVISIONAL CREDIT within 10 business days and take up to
//     45 CALENDAR days total to finish investigating.
//   - If a denial reverses provisional credit, the consumer must get advance
//     notice (commonly ~5 business days) before the debit.
//
// Caveats to confirm with counsel: longer windows apply for new accounts
// (opened < 30 days), point-of-sale, and foreign-initiated transfers
// (often 20 business / 90 calendar days). Federal holidays are NOT handled by
// the business-day helper below — add your holiday calendar before production.

import cron from "node-cron";

const INVESTIGATION_BUSINESS_DAYS = 10;
const FINAL_CALENDAR_DAYS = 45;

/** Add N business days (skips Sat/Sun). TODO: also skip federal holidays. */
export function addBusinessDays(start, days) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/**
 * File a new dispute. Sets the 10-business-day investigation deadline.
 */
export async function fileDispute(prisma, { transferId, userId, amountCents, reason }) {
  const filedAt = new Date();
  return prisma.dispute.create({
    data: {
      transferId,
      userId,
      amountCents,
      reason,
      status: "FILED",
      filedAt,
      investigationDueAt: addBusinessDays(filedAt, INVESTIGATION_BUSINESS_DAYS),
    },
  });
}

/** Optional explicit transition once you begin working a dispute. */
export async function startInvestigation(prisma, disputeId) {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d || d.status !== "FILED") return d;
  return prisma.dispute.update({
    where: { id: disputeId },
    data: { status: "INVESTIGATING" },
  });
}

/**
 * Issue provisional credit (required if not resolved within 10 business days).
 * `creditUser` is YOUR money-movement callback — in the bank-to-bank model this
 * typically pushes a provisional-credit transfer to the user's bank. Keep it
 * idempotent; it runs OUTSIDE the DB write so a failure doesn't leave a false
 * "credited" record.
 */
export async function issueProvisionalCredit(prisma, disputeId, { creditUser } = {}) {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw new Error("dispute not found");
  if (d.status === "PROVISIONAL_CREDIT_ISSUED" || d.status.startsWith("RESOLVED")) return d;

  if (creditUser) await creditUser(d); // app-specific; must be idempotent

  const finalDueAt = new Date(d.filedAt);
  finalDueAt.setDate(finalDueAt.getDate() + FINAL_CALENDAR_DAYS);

  return prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: "PROVISIONAL_CREDIT_ISSUED",
      provisionalCreditAt: new Date(),
      finalDueAt,
    },
  });
}

/**
 * Resolve a dispute. If denied AND provisional credit was issued, Reg E requires
 * giving the consumer advance notice before reversing the credit — `reverseProvisionalCredit`
 * is your ops hook to send that notice and schedule the debit after the notice window.
 */
export async function resolveDispute(
  prisma,
  disputeId,
  { upheld, note, reverseProvisionalCredit } = {}
) {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw new Error("dispute not found");
  if (d.status.startsWith("RESOLVED")) return d;

  if (!upheld && d.status === "PROVISIONAL_CREDIT_ISSUED" && reverseProvisionalCredit) {
    await reverseProvisionalCredit(d); // notify consumer, then debit AFTER the notice window
  }

  return prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: upheld ? "RESOLVED_UPHELD" : "RESOLVED_DENIED",
      resolvedAt: new Date(),
      resolutionNote: note ?? null,
    },
  });
}

/**
 * Deadline sweep. Call on a schedule:
 *  1) disputes past the 10-business-day mark, still open, no provisional credit
 *     -> onProvisionalCreditDue (you should issueProvisionalCredit).
 *  2) disputes past the 45-calendar-day final deadline, still open
 *     -> onFinalOverdue (compliance risk; escalate).
 */
export async function checkDisputeDeadlines(
  prisma,
  { onProvisionalCreditDue, onFinalOverdue } = {}
) {
  const now = new Date();

  const needCredit = await prisma.dispute.findMany({
    where: { status: { in: ["FILED", "INVESTIGATING"] }, investigationDueAt: { lte: now } },
  });
  for (const d of needCredit) {
    if (onProvisionalCreditDue) await onProvisionalCreditDue(d);
  }

  const overdue = await prisma.dispute.findMany({
    where: { status: "PROVISIONAL_CREDIT_ISSUED", finalDueAt: { lte: now } },
  });
  for (const d of overdue) {
    if (onFinalOverdue) await onFinalOverdue(d);
  }

  return { provisionalDue: needCredit.length, finalOverdue: overdue.length };
}

/**
 * Cron wrapper for the deadline sweep. Default: every day at 08:00.
 * Wire onProvisionalCreditDue to auto-issue credit (or to alert an ops human).
 */
export function startDisputeDeadlineCron(prisma, handlers = {}, schedule = "0 8 * * *") {
  return cron.schedule(schedule, async () => {
    try {
      const res = await checkDisputeDeadlines(prisma, handlers);
      if (res.provisionalDue || res.finalOverdue) {
        console.warn("[reg-e] deadline sweep:", res);
      }
    } catch (err) {
      console.error("[reg-e] deadline sweep failed:", err);
    }
  });
}
