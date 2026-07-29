// dwolla/velocity.js
// Pre-transfer velocity limits for even. Call checkVelocity() BEFORE createTransfer.
// Enforces the $10k per-transfer cap plus rolling daily/weekly limits per sender.
//
// NOTE on races: this reads recent transfers then you write a new one, so two
// concurrent sends could both pass and slightly exceed a limit. For hard
// enforcement, run checkVelocity + createTransfer inside a serializable DB
// transaction, or hold a short per-user lock. Defaults below are advisory —
// tune them and confirm against your Dwolla account's own transaction limits.

export class VelocityError extends Error {
  constructor(reason, detail) {
    super(reason);
    this.name = "VelocityError";
    this.reason = reason;   // machine-readable
    this.detail = detail;   // context for logs / UI
  }
}

export const DEFAULT_LIMITS = {
  maxPerTransferCents: 1_000_000, // $10,000 hard cap (your existing cap)
  maxPerDayCents: 2_000_000,      // $20,000 / rolling 24h
  maxPerDayCount: 20,             // 20 sends / rolling 24h
  maxPerWeekCents: 5_000_000,     // $50,000 / rolling 7d
};

// In-flight + completed sends count against limits; failed/returned do not.
const COUNTED = ["PENDING", "POSTED"];

/**
 * Throw VelocityError if this send would breach a limit; otherwise return usage.
 * @returns {{ ok: true, daySum, dayCount, weekSum }}
 */
export async function checkVelocity(prisma, { userId, amountCents }, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new VelocityError("invalid_amount", { amountCents });
  }
  if (amountCents > L.maxPerTransferCents) {
    throw new VelocityError("per_transfer_cap", {
      amountCents,
      cap: L.maxPerTransferCents,
    });
  }

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [dayAgg, weekAgg] = await Promise.all([
    prisma.transfer.aggregate({
      _sum: { amountCents: true },
      _count: true,
      where: { senderId: userId, status: { in: COUNTED }, createdAt: { gte: dayAgo } },
    }),
    prisma.transfer.aggregate({
      _sum: { amountCents: true },
      where: { senderId: userId, status: { in: COUNTED }, createdAt: { gte: weekAgo } },
    }),
  ]);

  const daySum = dayAgg._sum.amountCents ?? 0;
  const dayCount = dayAgg._count ?? 0;
  const weekSum = weekAgg._sum.amountCents ?? 0;

  if (dayCount + 1 > L.maxPerDayCount) {
    throw new VelocityError("daily_count", { dayCount, limit: L.maxPerDayCount });
  }
  if (daySum + amountCents > L.maxPerDayCents) {
    throw new VelocityError("daily_amount", {
      daySum,
      amountCents,
      limit: L.maxPerDayCents,
    });
  }
  if (weekSum + amountCents > L.maxPerWeekCents) {
    throw new VelocityError("weekly_amount", {
      weekSum,
      amountCents,
      limit: L.maxPerWeekCents,
    });
  }

  return { ok: true, daySum, dayCount, weekSum };
}

/**
 * Non-throwing variant for UI checks ("can this user send $X right now?").
 * @returns {{ ok: boolean, reason?: string, detail?: object }}
 */
export async function evaluateVelocity(prisma, args, limits = {}) {
  try {
    await checkVelocity(prisma, args, limits);
    return { ok: true };
  } catch (e) {
    if (e instanceof VelocityError) return { ok: false, reason: e.reason, detail: e.detail };
    throw e;
  }
}
