import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

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
      id: { not: excludeId },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { handle: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, handle: true },
    orderBy: { name: "asc" },
    take: 25,
  });

// ── Dwolla identity / bank linking ──────────────────────────
export const setDwollaCustomer = (userId, { dwollaCustomerUrl, kycStatus }) =>
  prisma.user.update({ where: { id: userId }, data: { dwollaCustomerUrl, kycStatus } });

export const setKycStatusByCustomerUrlSuffix = (dwollaCustomerId, kycStatus) =>
  prisma.user.updateMany({
    where: { dwollaCustomerUrl: { endsWith: dwollaCustomerId } },
    data: { kycStatus },
  });

export const setFundingSource = (userId, fundingSourceUrl) =>
  prisma.user.update({ where: { id: userId }, data: { fundingSourceUrl, fundingSourceVerified: false } });

export const setFundingSourceVerified = (userId) =>
  prisma.user.update({ where: { id: userId }, data: { fundingSourceVerified: true } });

// ── transfers (Dwolla-backed) ────────────────────────────
export const createTransferRecord = ({ idempotencyKey, providerRef, providerUrl, senderId, recipientId, amountCents, feeCents = 0, note }) =>
  prisma.transfer.create({
    data: { idempotencyKey, providerRef, providerUrl, senderId, recipientId, amountCents, feeCents, note: note || "payment", status: "PENDING" },
  });

// ── requests (no money movement) ─────────────────────────
export const logRequest = ({ payerId, requesterId, cents, note }) =>
  prisma.request.create({
    data: { payerId, requesterId, amountCents: cents, note: note || "request" },
  });

// ── activity feed ────────────────────────────────────────
export const feedForUser = async (userId) => {
  const [transfers, requests] = await Promise.all([
    prisma.transfer.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        sender: { select: { name: true, handle: true } },
        recipient: { select: { name: true, handle: true } },
      },
    }),
    prisma.request.findMany({
      where: { OR: [{ payerId: userId }, { requesterId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        payer: { select: { name: true, handle: true } },
        requester: { select: { name: true, handle: true } },
      },
    }),
  ]);

  const shapedTransfers = transfers.map((t) => ({
    id: t.id, kind: "pay", status: t.status,
    amountCents: t.amountCents, feeCents: t.feeCents, note: t.note, createdAt: t.createdAt,
    fromUserId: t.senderId, toUserId: t.recipientId, fromUser: t.sender, toUser: t.recipient,
  }));
  const shapedRequests = requests.map((r) => ({
    id: r.id, kind: "request", status: "pending",
    amountCents: r.amountCents, feeCents: 0, note: r.note, createdAt: r.createdAt,
    fromUserId: r.payerId, toUserId: r.requesterId, fromUser: r.payer, toUser: r.requester,
  }));

  return [...shapedTransfers, ...shapedRequests]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
};

export const newIdempotencyKey = () => randomUUID();

export default prisma;
