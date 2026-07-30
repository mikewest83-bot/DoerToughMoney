// Data access for shared expenses. The math lives in groups.js (pure, tested);
// this is the Prisma layer that feeds it and persists the results.
import prisma from "./db.js";
import {
  splitEqual, validateShares, computeNetBalances, simplifyDebts, nextOccurrence, periodKey,
} from "./groups.js";

// Everything needed to compute balances and render a group in one round trip.
const GROUP_INCLUDE = {
  members: {
    include: { user: { select: { id: true, name: true, handle: true, fundingSourceVerified: true, kycStatus: true } } },
    orderBy: { createdAt: "asc" },
  },
  expenses: {
    include: { shares: true },
    orderBy: { incurredOn: "desc" },
  },
  settlements: { orderBy: { createdAt: "desc" } },
  recurring: { where: { active: true }, orderBy: { nextRunOn: "asc" } },
};

export const getGroup = (groupId) => prisma.group.findUnique({ where: { id: groupId }, include: GROUP_INCLUDE });

/** Groups this user belongs to, with everything needed for balances. */
export const listGroupsForUser = (userId) =>
  prisma.group.findMany({
    where: { members: { some: { userId } } },
    include: GROUP_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

/** The caller's own membership row, or null if they aren't in the group. */
export const memberFor = (group, userId) => group?.members.find((m) => m.userId === userId) ?? null;

export async function createGroup({ name, type, createdById, implicit = false }) {
  return prisma.group.create({
    data: {
      name, type, createdById, implicit,
      // The creator is always a member — a group you can't see is useless.
      members: { create: [{ userId: createdById, joinedAt: new Date() }] },
    },
    include: GROUP_INCLUDE,
  });
}

/**
 * Add a member by existing user, or as a pending invite by email. Invited
 * placeholders can hold expense shares before they ever sign up.
 */
export async function addMember(groupId, { userId, inviteEmail, inviteName }) {
  if (userId) {
    return prisma.groupMember.create({ data: { groupId, userId, joinedAt: new Date() } });
  }
  return prisma.groupMember.create({
    data: { groupId, inviteEmail: String(inviteEmail).trim().toLowerCase(), inviteName: inviteName || null },
  });
}

/**
 * Link any pending invites matching this email to a freshly registered user.
 * Called from register() so an invited roommate lands straight in the group
 * already owing their share — this is the growth loop, so it must be automatic.
 * @returns number of groups joined
 */
export async function claimInvites(userId, email) {
  const normalized = String(email).trim().toLowerCase();
  const pending = await prisma.groupMember.findMany({ where: { inviteEmail: normalized, userId: null } });
  let joined = 0;
  for (const p of pending) {
    // Skip if they're somehow already a real member of that group, since
    // [groupId, userId] is unique and would otherwise throw.
    const existing = await prisma.groupMember.findFirst({ where: { groupId: p.groupId, userId } });
    if (existing) continue;
    await prisma.groupMember.update({
      where: { id: p.id },
      data: { userId, joinedAt: new Date(), inviteEmail: null },
    });
    joined++;
  }
  return joined;
}

/**
 * The implicit 2-person group behind a direct "split with Sam" — created on
 * first use and reused after, so pay-me-later runs on the same debt engine as
 * groups instead of needing a parallel IOU model. The UI shows it as a person.
 */
export async function findOrCreatePairGroup(userA, userB) {
  const existing = await prisma.group.findFirst({
    where: {
      implicit: true,
      AND: [{ members: { some: { userId: userA.id } } }, { members: { some: { userId: userB.id } } }],
    },
    include: GROUP_INCLUDE,
  });
  // Guard against a group that happens to contain both but also others.
  if (existing && existing.members.length === 2) return existing;

  const group = await prisma.group.create({
    data: {
      name: userB.name, type: "OTHER", createdById: userA.id, implicit: true,
      members: { create: [{ userId: userA.id, joinedAt: new Date() }, { userId: userB.id, joinedAt: new Date() }] },
    },
    include: GROUP_INCLUDE,
  });
  return group;
}

/** A member with no financial history can be removed; otherwise balances break. */
export async function removeMember(groupId, memberId) {
  const [shares, paid, settled] = await Promise.all([
    prisma.expenseShare.count({ where: { memberId } }),
    prisma.expense.count({ where: { paidByMemberId: memberId } }),
    prisma.settlement.count({ where: { OR: [{ fromMemberId: memberId }, { toMemberId: memberId }] } }),
  ]);
  if (shares || paid || settled) {
    return { removed: false, reason: "That person has expenses in this group. Settle up before removing them." };
  }
  await prisma.groupMember.delete({ where: { id: memberId } });
  return { removed: true };
}

/**
 * Record an expense and its shares atomically — a half-written expense would
 * corrupt every balance in the group.
 * @param splitMode "EQUAL" splits across splitMemberIds; "EXACT" uses shares as given
 */
export async function addExpense({ groupId, paidByMemberId, amountCents, description, splitMode, splitMemberIds, shares, createdById, incurredOn }) {
  const resolved = splitMode === "EXACT" ? shares : splitEqual(amountCents, splitMemberIds);
  const check = validateShares(amountCents, resolved);
  if (!check.ok) return { ok: false, error: check.error };

  const expense = await prisma.expense.create({
    data: {
      groupId, paidByMemberId, amountCents, description,
      splitMode: splitMode === "EXACT" ? "EXACT" : "EQUAL",
      createdById,
      incurredOn: incurredOn ? new Date(incurredOn) : new Date(),
      shares: { create: resolved.map((s) => ({ memberId: s.memberId, shareCents: s.shareCents })) },
    },
    include: { shares: true },
  });
  return { ok: true, expense };
}

export const deleteExpense = (expenseId) => prisma.expense.delete({ where: { id: expenseId } });

export const recordSettlement = ({ groupId, fromMemberId, toMemberId, amountCents, transferId = null }) =>
  prisma.settlement.create({ data: { groupId, fromMemberId, toMemberId, amountCents, transferId } });

// ── recurring ────────────────────────────────────────────
export async function addRecurring({ groupId, paidByMemberId, amountCents, description, splitMode, interval, dayOfMonth, dayOfWeek }) {
  return prisma.recurringExpense.create({
    data: {
      groupId, paidByMemberId, amountCents, description,
      splitMode: splitMode === "EXACT" ? "EXACT" : "EQUAL",
      interval, dayOfMonth: dayOfMonth ?? null, dayOfWeek: dayOfWeek ?? null,
      // First run is the next occurrence from now, so creating a schedule never
      // immediately backfills a charge the user didn't expect.
      nextRunOn: nextOccurrence(new Date(), { interval, dayOfMonth, dayOfWeek }),
    },
  });
}

export const deactivateRecurring = (id) =>
  prisma.recurringExpense.update({ where: { id }, data: { active: false } });

/**
 * Turn every due schedule into a real expense. Idempotent: the expense carries
 * (recurringExpenseId, recurringPeriod) under a unique constraint, so a double
 * run can't charge rent twice — the second insert just loses the race.
 * @returns {{created: number, skipped: number}}
 */
export async function materializeRecurring(now = new Date()) {
  const due = await prisma.recurringExpense.findMany({
    where: { active: true, nextRunOn: { lte: now } },
    include: { group: { include: { members: true } } },
  });

  let created = 0;
  let skipped = 0;
  for (const r of due) {
    const period = periodKey(r.id, r.nextRunOn);
    const memberIds = r.group.members.map((m) => m.id);
    const resolved = splitEqual(r.amountCents, memberIds);
    try {
      await prisma.expense.create({
        data: {
          groupId: r.groupId, paidByMemberId: r.paidByMemberId,
          amountCents: r.amountCents, description: r.description,
          splitMode: "EQUAL", createdById: r.group.createdById,
          incurredOn: r.nextRunOn,
          recurringExpenseId: r.id, recurringPeriod: period,
          shares: { create: resolved.map((s) => ({ memberId: s.memberId, shareCents: s.shareCents })) },
        },
      });
      created++;
    } catch (e) {
      if (e?.code === "P2002") skipped++; // already materialized for this period
      else throw e;
    }
    // Advance regardless, so a duplicate can't wedge the schedule forever.
    await prisma.recurringExpense.update({
      where: { id: r.id },
      data: { nextRunOn: nextOccurrence(r.nextRunOn, r) },
    });
  }
  return { created, skipped };
}

// ── presentation ─────────────────────────────────────────
const memberLabel = (m) => m.user?.name || m.inviteName || m.inviteEmail || "Someone";

/**
 * Shape a group for the client: members, simplified who-owes-whom, the caller's
 * own position, and the expense feed.
 */
export function shapeGroup(group, viewerUserId) {
  const memberIds = group.members.map((m) => m.id);
  const net = computeNetBalances({
    memberIds,
    expenses: group.expenses.map((e) => ({
      paidByMemberId: e.paidByMemberId, amountCents: e.amountCents, shares: e.shares,
    })),
    settlements: group.settlements.map((s) => ({
      fromMemberId: s.fromMemberId, toMemberId: s.toMemberId, amountCents: s.amountCents,
    })),
  });
  const transfers = simplifyDebts(net);
  const me = memberFor(group, viewerUserId);
  const byId = Object.fromEntries(group.members.map((m) => [m.id, m]));

  const decorate = (t) => ({
    fromMemberId: t.fromMemberId, toMemberId: t.toMemberId,
    fromName: memberLabel(byId[t.fromMemberId] ?? {}),
    toName: memberLabel(byId[t.toMemberId] ?? {}),
    amount: t.amountCents / 100,
    // Whether a real transfer is possible, or only a cash record.
    canTransfer: !!(byId[t.fromMemberId]?.user?.fundingSourceVerified && byId[t.toMemberId]?.user?.fundingSourceVerified),
  });

  return {
    id: group.id, name: group.name, type: group.type, implicit: group.implicit,
    myMemberId: me?.id ?? null,
    myNet: (net[me?.id] ?? 0) / 100,
    members: group.members.map((m) => ({
      id: m.id, name: memberLabel(m), handle: m.user?.handle ?? null,
      pending: !m.userId, isMe: m.userId === viewerUserId,
      canReceive: !!m.user?.fundingSourceVerified,
      net: (net[m.id] ?? 0) / 100,
    })),
    // What the caller should pay / expect, plus the whole group's picture.
    iOwe: transfers.filter((t) => t.fromMemberId === me?.id).map(decorate),
    owedToMe: transfers.filter((t) => t.toMemberId === me?.id).map(decorate),
    allTransfers: transfers.map(decorate),
    expenses: group.expenses.map((e) => ({
      id: e.id, description: e.description, amount: e.amountCents / 100,
      paidByMemberId: e.paidByMemberId, paidByName: memberLabel(byId[e.paidByMemberId] ?? {}),
      incurredOn: e.incurredOn, recurring: !!e.recurringExpenseId,
      myShare: (e.shares.find((s) => s.memberId === me?.id)?.shareCents ?? 0) / 100,
    })),
    recurring: (group.recurring ?? []).map((r) => ({
      id: r.id, description: r.description, amount: r.amountCents / 100,
      interval: r.interval, dayOfMonth: r.dayOfMonth, dayOfWeek: r.dayOfWeek,
      nextRunOn: r.nextRunOn, paidByName: memberLabel(byId[r.paidByMemberId] ?? {}),
    })),
  };
}
