// Integration tests for the ledger — exercise real Prisma against a real
// Postgres. These need a database, so they run on your machine, not in CI-less
// sandboxes:
//
//   docker compose up -d db
//   DATABASE_URL="postgresql://postgres:pg@localhost:5432/even_test?schema=public" \
//     npx prisma migrate deploy && npm run test:integration
//
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import prisma, {
  createUser, getUserById, transfer, creditTopup, debitPayout, feedForUser,
  failAndRestorePayout, processTopupEvent,
} from "./db.js";

const mkUser = (n) =>
  createUser({ name: n, handle: "@" + n, email: `${n}@t.dev`, password_hash: "x" });

beforeAll(async () => {
  // Fail loudly if someone points this at a non-test database.
  if (!/test/i.test(process.env.DATABASE_URL || ""))
    throw new Error("Refusing to run integration tests: DATABASE_URL must name a *test* database.");
});

beforeEach(async () => {
  await prisma.stripeEvent.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.paymentLink.deleteMany();
  await prisma.stripeEvent.deleteMany();
  await prisma.user.deleteMany();
  // Re-seed the platform fee account (migration seeds it once; tests wipe users).
  await prisma.user.upsert({
    where: { id: "u_platform" },
    update: {},
    create: { id: "u_platform", name: "even", handle: "@even", email: "platform@even.local", passwordHash: "!" },
  });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("transfer", () => {
  it("moves cents atomically and records the txn", async () => {
    const a = await mkUser("alice");
    const b = await mkUser("bob");
    await creditTopup({ userId: a.id, cents: 5000 });

    await transfer({ fromId: a.id, toId: b.id, cents: 2000, note: "🍕" });

    expect((await getUserById(a.id)).balanceCents).toBe(3000);
    expect((await getUserById(b.id)).balanceCents).toBe(2000);
    const feed = await feedForUser(a.id);
    expect(feed.some((t) => t.kind === "pay" && t.amountCents === 2000)).toBe(true);
  });

  it("rejects overdraws and leaves both balances untouched", async () => {
    const a = await mkUser("alice");
    const b = await mkUser("bob");
    await creditTopup({ userId: a.id, cents: 1000 });

    await expect(transfer({ fromId: a.id, toId: b.id, cents: 5000 }))
      .rejects.toThrow("INSUFFICIENT");

    expect((await getUserById(a.id)).balanceCents).toBe(1000);
    expect((await getUserById(b.id)).balanceCents).toBe(0);
  });

  it("stays non-negative under concurrent transfers of the whole balance", async () => {
    const a = await mkUser("alice");
    const b = await mkUser("bob");
    await creditTopup({ userId: a.id, cents: 1000 });

    // Fire many simultaneous full-balance transfers; only one may win.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => transfer({ fromId: a.id, toId: b.id, cents: 1000 }))
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;

    expect(ok).toBe(1);
    expect((await getUserById(a.id)).balanceCents).toBe(0);
    expect((await getUserById(b.id)).balanceCents).toBe(1000);
  });
});

describe("debitPayout", () => {
  it("reserves funds and blocks payouts beyond the balance", async () => {
    const a = await mkUser("alice");
    await creditTopup({ userId: a.id, cents: 3000 });

    await debitPayout({ userId: a.id, cents: 1000 });
    expect((await getUserById(a.id)).balanceCents).toBe(2000);

    await expect(debitPayout({ userId: a.id, cents: 9999 }))
      .rejects.toThrow("INSUFFICIENT");
    expect((await getUserById(a.id)).balanceCents).toBe(2000);
  });
});


describe("payout recovery", () => {
  it("restores a reserved payout exactly once after failure", async () => {
    const a = await mkUser("alice");
    await creditTopup({ userId: a.id, cents: 3000 });
    const payout = await debitPayout({ userId: a.id, cents: 1000 });

    expect((await failAndRestorePayout({ transactionId: payout.id })).restored).toBe(true);
    expect((await failAndRestorePayout({ transactionId: payout.id })).restored).toBe(false);
    expect((await getUserById(a.id)).balanceCents).toBe(3000);
  });
});

describe("Stripe top-up deduplication", () => {
  it("credits one checkout session only once", async () => {
    const a = await mkUser("alice");
    await processTopupEvent({ eventId: "evt_1", sessionId: "cs_1", userId: a.id, cents: 2500 });
    await processTopupEvent({ eventId: "evt_2", sessionId: "cs_1", userId: a.id, cents: 2500 });
    expect((await getUserById(a.id)).balanceCents).toBe(2500);
  });
});

describe("transfer with platform fee", () => {
  it("charges sender amount+fee, pays recipient in full, credits the platform", async () => {
    // The platform account is seeded by migration 0003.
    const platform = await getUserById("u_platform");
    expect(platform).not.toBeNull();
    const platformStart = platform.balanceCents;

    const a = await mkUser("alice");
    const b = await mkUser("bob");
    await creditTopup({ userId: a.id, cents: 10000 });

    // 1.5% of $50 = 75c fee.
    await transfer({ fromId: a.id, toId: b.id, cents: 5000, feeCents: 75, platformId: "u_platform" });

    expect((await getUserById(a.id)).balanceCents).toBe(10000 - 5000 - 75);
    expect((await getUserById(b.id)).balanceCents).toBe(5000);
    expect((await getUserById("u_platform")).balanceCents).toBe(platformStart + 75);
  });

  it("rejects when the balance can't cover amount+fee, changing nothing", async () => {
    const a = await mkUser("alice");
    const b = await mkUser("bob");
    await creditTopup({ userId: a.id, cents: 5000 });

    await expect(transfer({ fromId: a.id, toId: b.id, cents: 5000, feeCents: 75, platformId: "u_platform" }))
      .rejects.toThrow("INSUFFICIENT");

    expect((await getUserById(a.id)).balanceCents).toBe(5000);
    expect((await getUserById(b.id)).balanceCents).toBe(0);
  });
});

describe("pay-me links", () => {
  it("creates a link and credits the payee (minus fee) exactly once", async () => {
    const payee = await mkUser("carol");
    const platformStart = (await getUserById("u_platform")).balanceCents;

    const link = await createPaymentLink({ userId: payee.id, amountCents: 5000, note: "concert" });
    const withPayee = await getPaymentLinkWithPayee(link.slug);
    expect(withPayee.payee.handle).toBe("@carol");
    expect(withPayee.amountCents).toBe(5000);

    // Simulate the Checkout webhook: $50 paid, 75c fee.
    const r1 = await processLinkPayment({ eventId: "evt_1", sessionId: "cs_1", payeeId: payee.id, cents: 5000, feeCents: 75, note: "concert" });
    expect(r1.duplicate).toBe(false);
    expect((await getUserById(payee.id)).balanceCents).toBe(5000 - 75);
    expect((await getUserById("u_platform")).balanceCents).toBe(platformStart + 75);

    // Same session replayed (Stripe retries) — must not double-credit.
    const r2 = await processLinkPayment({ eventId: "evt_1", sessionId: "cs_1", payeeId: payee.id, cents: 5000, feeCents: 75, note: "concert" });
    expect(r2.duplicate).toBe(true);
    expect((await getUserById(payee.id)).balanceCents).toBe(5000 - 75);
  });
});
