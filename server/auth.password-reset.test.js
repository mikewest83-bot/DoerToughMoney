import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

// auth.js talks to Postgres through db.js and to Resend through mailer.js.
// Both are mocked so these stay in the fast, DB-free suite — what's being
// tested is the flow's security properties, not Prisma.
const prisma = {
  passwordResetToken: {
    create: vi.fn(async ({ data }) => ({ id: "t1", usedAt: null, ...data })),
    findUnique: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  user: { update: vi.fn(async () => ({})) },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};

const db = {
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  getUserByHandle: vi.fn(),
  getUserByGoogleId: vi.fn(),
  createUser: vi.fn(),
  linkGoogleId: vi.fn(),
};

const mailer = {
  mailConfigured: vi.fn(() => true),
  sendPasswordResetEmail: vi.fn(async () => ({ sent: true })),
};

vi.mock("./db.js", () => ({ default: prisma, ...db }));
vi.mock("./mailer.js", () => mailer);
vi.mock("./google.js", () => ({ verifyGoogleToken: vi.fn() }));

const { requestPasswordReset, resetPassword } = await import("./auth.js");

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const call = async (handler, body) => {
  const res = mockRes();
  await handler({ body }, res);
  return res;
};

const NEUTRAL = "If that email has an account, a reset link is on its way.";
const passwordUser = { id: "u1", email: "mike@example.com", name: "Mike", passwordHash: "$2a$12$existing" };

beforeEach(() => {
  vi.clearAllMocks();
  mailer.mailConfigured.mockReturnValue(true);
  mailer.sendPasswordResetEmail.mockResolvedValue({ sent: true });
  prisma.passwordResetToken.create.mockImplementation(async ({ data }) => ({ id: "t1", usedAt: null, ...data }));
  prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
});

describe("requestPasswordReset — must not leak which emails have accounts", () => {
  it("answers identically for an unknown email", async () => {
    db.getUserByEmail.mockResolvedValue(null);
    const res = await call(requestPasswordReset, { email: "nobody@example.com" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, message: NEUTRAL });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("answers identically for a Google-only account, and sends nothing", async () => {
    db.getUserByEmail.mockResolvedValue({ id: "u2", email: "g@example.com", passwordHash: null });
    const res = await call(requestPasswordReset, { email: "g@example.com" });
    expect(res.body).toEqual({ ok: true, message: NEUTRAL });
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("answers identically when no mail provider is configured", async () => {
    mailer.mailConfigured.mockReturnValue(false);
    db.getUserByEmail.mockResolvedValue(passwordUser);
    const res = await call(requestPasswordReset, { email: passwordUser.email });
    expect(res.body).toEqual({ ok: true, message: NEUTRAL });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("answers identically for a missing or oversized email", async () => {
    for (const email of [undefined, "", "x".repeat(255) + "@example.com"]) {
      const res = await call(requestPasswordReset, { email });
      expect(res.body).toEqual({ ok: true, message: NEUTRAL });
    }
    expect(db.getUserByEmail).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset — what it stores and sends", () => {
  it("stores only the SHA-256 of the token, never the token itself", async () => {
    db.getUserByEmail.mockResolvedValue(passwordUser);
    await call(requestPasswordReset, { email: "  MIKE@Example.com " });

    const { data } = prisma.passwordResetToken.create.mock.calls[0][0];
    const emailed = mailer.sendPasswordResetEmail.mock.calls[0][0].token;

    expect(data.tokenHash).not.toBe(emailed);
    expect(data.tokenHash).toBe(crypto.createHash("sha256").update(emailed).digest("hex"));
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes the email before looking the account up", async () => {
    db.getUserByEmail.mockResolvedValue(passwordUser);
    await call(requestPasswordReset, { email: "  MIKE@Example.com " });
    expect(db.getUserByEmail).toHaveBeenCalledWith("mike@example.com");
  });

  it("issues a high-entropy token and expires it in the future", async () => {
    db.getUserByEmail.mockResolvedValue(passwordUser);
    const before = Date.now();
    await call(requestPasswordReset, { email: passwordUser.email });

    const { token, ttlMinutes } = mailer.sendPasswordResetEmail.mock.calls[0][0];
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    expect(ttlMinutes).toBe(60);

    const { data } = prisma.passwordResetToken.create.mock.calls[0][0];
    expect(data.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it("gives a different token every time", async () => {
    db.getUserByEmail.mockResolvedValue(passwordUser);
    await call(requestPasswordReset, { email: passwordUser.email });
    await call(requestPasswordReset, { email: passwordUser.email });
    const [a, b] = mailer.sendPasswordResetEmail.mock.calls.map((c) => c[0].token);
    expect(a).not.toBe(b);
  });

  it("kills any outstanding link before issuing a new one", async () => {
    db.getUserByEmail.mockResolvedValue(passwordUser);
    await call(requestPasswordReset, { email: passwordUser.email });
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("sends the link to the address on the account, not the one typed", async () => {
    db.getUserByEmail.mockResolvedValue({ ...passwordUser, email: "canonical@example.com" });
    await call(requestPasswordReset, { email: "canonical@example.com" });
    expect(mailer.sendPasswordResetEmail.mock.calls[0][0].to).toBe("canonical@example.com");
  });
});

describe("resetPassword", () => {
  const future = () => new Date(Date.now() + 60_000);
  const past = () => new Date(Date.now() - 60_000);

  it("rejects a short password before touching the token", async () => {
    const res = await call(resetPassword, { token: "abc", password: "short" });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/);
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing token or password", async () => {
    for (const body of [{}, { token: "abc" }, { password: "longenough" }]) {
      const res = await call(resetPassword, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it("looks the token up by its hash, never by the raw value", async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await call(resetPassword, { token: "raw-token-value", password: "longenough1" });
    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: crypto.createHash("sha256").update("raw-token-value").digest("hex") },
    });
  });

  it("gives one identical message for unknown, expired and already-used tokens", async () => {
    const cases = [
      null,
      { userId: "u1", usedAt: new Date(), expiresAt: future() },
      { userId: "u1", usedAt: null, expiresAt: past() },
    ];
    const messages = [];
    for (const record of cases) {
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);
      const res = await call(resetPassword, { token: "x", password: "longenough1" });
      expect(res.statusCode).toBe(400);
      messages.push(res.body.error);
    }
    expect(new Set(messages).size).toBe(1);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("sets the password and spends the token in one transaction", async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({ userId: "u1", usedAt: null, expiresAt: future() });
    db.getUserById.mockResolvedValue(passwordUser);

    const res = await call(resetPassword, { token: "good", password: "a-good-password" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const update = prisma.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "u1" });
    expect(update.data.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt, not plaintext
    expect(update.data.passwordHash).not.toBe("a-good-password");

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("refuses a valid token whose user has since been deleted", async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({ userId: "gone", usedAt: null, expiresAt: future() });
    db.getUserById.mockResolvedValue(null);
    const res = await call(resetPassword, { token: "good", password: "a-good-password" });
    expect(res.statusCode).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
