import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── users ────────────────────────────────────────────────
export const createUser = ({ name, handle, email, password_hash }) =>
  prisma.user.create({ data: { name, handle, email, passwordHash: password_hash } });

export const getUserById = (id) => prisma.user.findUnique({ where: { id } });
export const getUserByEmail = (email) => prisma.user.findUnique({ where: { email } });
export const getUserByHandle = (handle) => prisma.user.findUnique({ where: { handle } });

export const searchUsers = (q, excludeId) =>
  prisma.user.findMany({
    where: {
      id: { notIn: [excludeId, "u_platform"] },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { handle: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, handle: true },
    orderBy: { name: "asc" },
    take: 25,
  });

export const setStripeAccount = (userId, acctId) =>
  prisma.user.update({ where: { id: userId }, data: { stripeAccountId: acctId } });

// ── ledger ───────────────────────────────────────────────
export const transfer = ({ fromId, toId, cents, note, feeCents = 0, platformId = "u_platform" }) =>
  prisma.$transaction(async (tx) => {
    const total = cents + feeCents;
    // Sender must cover amount + fee. Conditional update is the overdraw guard.
    const dec = await tx.user.updateMany({
      where: { id: fromId, balanceCents: { gte: total } },
      data: { balanceCents: { decrement: total } },
    });
    if (dec.count === 0) throw new Error("INSUFFICIENT");
    // Recipient receives the full amount; the fee goes to the platform account.
    await tx.user.update({ where: { id: toId }, data: { balanceCents: { increment: cents } } });
    if (feeCents > 0) {
      await tx.user.update({ where: { id: platformId }, data: { balanceCents: { increment: feeCents } } });
    }
    return tx.transaction.create({
      data: { fromUserId: fromId, toUserId: toId, amountCents: cents, feeCents, note: note || "payment", kind: "pay", status: "complete" },
    });
  });

export const logRequest = ({ payerId, requesterId, cents, note }) =>
  prisma.transaction.create({
    data: {
      fromUserId: payerId,
      toUserId: requesterId,
      amountCents: cents,
      note: note || "request",
      kind: "request",
      status: "pending",
    },
  });

export const processTopupEvent = async ({ eventId, sessionId, userId, cents }) => {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { eventId, type: "checkout.session.completed" } });

      const existing = await tx.transaction.findUnique({ where: { stripeSessionId: sessionId } });
      if (existing) return { duplicate: true };

      await tx.user.update({ where: { id: userId }, data: { balanceCents: { increment: cents } } });
      const transaction = await tx.transaction.create({
        data: {
          toUserId: userId,
          amountCents: cents,
          note: "added funds",
          kind: "topup",
          status: "complete",
          stripeSessionId: sessionId,
        },
      });
      return { duplicate: false, transaction };
    });
  } catch (error) {
    // Covers a replayed event ID and the rarer case where two distinct Stripe
    // events for the same Checkout Session race each other.
    if (error?.code === "P2002") return { duplicate: true };
    throw error;
  }
};

// Kept for tests and administrative credits. Production Stripe top-ups should
// use processTopupEvent so retries cannot double-credit a wallet.
export const creditTopup = ({ userId, cents }) =>
  prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { balanceCents: { increment: cents } } });
    return tx.transaction.create({
      data: { toUserId: userId, amountCents: cents, note: "added funds", kind: "topup", status: "complete" },
    });
  });

export const reservePayout = ({ userId, cents }) =>
  prisma.$transaction(async (tx) => {
    const dec = await tx.user.updateMany({
      where: { id: userId, balanceCents: { gte: cents } },
      data: { balanceCents: { decrement: cents } },
    });
    if (dec.count === 0) throw new Error("INSUFFICIENT");
    return tx.transaction.create({
      data: { fromUserId: userId, amountCents: cents, note: "cash out to bank", kind: "payout", status: "pending" },
    });
  });

export const attachPayoutProviderIds = ({ transactionId, transferId, payoutId }) =>
  prisma.transaction.update({
    where: { id: transactionId },
    data: { stripeTransferId: transferId, stripePayoutId: payoutId },
  });

export const completePayout = ({ transactionId }) =>
  prisma.transaction.updateMany({
    where: { id: transactionId, kind: "payout", status: "pending" },
    data: { status: "complete" },
  });

export const failAndRestorePayout = ({ transactionId, reason = "cash out failed" }) =>
  prisma.$transaction(async (tx) => {
    const payout = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!payout || payout.kind !== "payout" || payout.status !== "pending") return { restored: false };

    const updated = await tx.transaction.updateMany({
      where: { id: transactionId, status: "pending" },
      data: { status: "failed", note: reason },
    });
    if (updated.count === 0) return { restored: false };

    await tx.user.update({
      where: { id: payout.fromUserId },
      data: { balanceCents: { increment: payout.amountCents } },
    });
    return { restored: true, payout };
  });

export const processPayoutEvent = ({ eventId, type, transactionId }) =>
  prisma.$transaction(async (tx) => {
    try {
      await tx.stripeEvent.create({ data: { eventId, type } });
    } catch (error) {
      if (error?.code === "P2002") return { duplicate: true };
      throw error;
    }

    const payout = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!payout || payout.kind !== "payout") return { duplicate: false, ignored: true };

    if (type === "payout.paid") {
      await tx.transaction.updateMany({
        where: { id: transactionId, status: "pending" },
        data: { status: "complete" },
      });
      return { duplicate: false, completed: true };
    }

    if (type === "payout.failed" || type === "payout.canceled") {
      const updated = await tx.transaction.updateMany({
        where: { id: transactionId, status: "pending" },
        data: { status: "failed", note: "cash out failed" },
      });
      if (updated.count) {
        await tx.user.update({
          where: { id: payout.fromUserId },
          data: { balanceCents: { increment: payout.amountCents } },
        });
      }
      return { duplicate: false, restored: updated.count === 1 };
    }

    return { duplicate: false, ignored: true };
  });

// Backward-compatible alias used by older tests/callers.
export const debitPayout = reservePayout;


// ── payment links ────────────────────────────────────────
import { randomBytes } from "crypto";
const newSlug = () => randomBytes(6).toString("base64url"); // ~8 url-safe chars

export const createPaymentLink = ({ userId, amountCents, note }) =>
  prisma.paymentLink.create({
    data: { slug: newSlug(), userId, amountCents: amountCents ?? null, note: note || null },
  });

export const getPaymentLinkBySlug = (slug) =>
  prisma.paymentLink.findUnique({
    where: { slug },
    include: { /* payee */ },
  });

export const getPaymentLinkWithPayee = (slug) =>
  prisma.paymentLink.findUnique({ where: { slug } }).then(async (link) => {
    if (!link) return null;
    const payee = await prisma.user.findUnique({
      where: { id: link.userId },
      select: { name: true, handle: true },
    });
    return { ...link, payee };
  });

export const listPaymentLinks = (userId) =>
  prisma.paymentLink.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });

export const deactivatePaymentLink = ({ id, userId }) =>
  prisma.paymentLink.updateMany({ where: { id, userId }, data: { active: false } });

// Credit a payee's wallet when someone pays their link (via Stripe webhook).
// Deduped by Checkout Session id + the Stripe event id, like top-ups.
export const processLinkPayment = async ({ eventId, sessionId, payeeId, cents, note, feeCents = 0, platformId = "u_platform" }) => {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { eventId, type: "checkout.session.completed" } });
      const existing = await tx.transaction.findUnique({ where: { stripeSessionId: sessionId } });
      if (existing) return { duplicate: true };

      const net = Math.max(0, cents - feeCents);
      await tx.user.update({ where: { id: payeeId }, data: { balanceCents: { increment: net } } });
      if (feeCents > 0) {
        await tx.user.update({ where: { id: platformId }, data: { balanceCents: { increment: feeCents } } });
      }
      const transaction = await tx.transaction.create({
        data: {
          toUserId: payeeId, amountCents: net, feeCents,
          note: note || "paid your link", kind: "topup", status: "complete",
          stripeSessionId: sessionId,
        },
      });
      return { duplicate: false, transaction };
    });
  } catch (error) {
    if (error?.code === "P2002") return { duplicate: true };
    throw error;
  }
};

export const feedForUser = (userId) =>
  prisma.transaction.findMany({
    where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      fromUser: { select: { name: true, handle: true } },
      toUser: { select: { name: true, handle: true } },
    },
  });

export default prisma;
