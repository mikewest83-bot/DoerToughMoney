import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  createUser,
  getUserByEmail,
  getUserById,
  getUserByGoogleId,
  getUserByHandle,
  linkGoogleId,
} from "./db.js";
import { verifyGoogleToken } from "./google.js";
import prisma from "./db.js";
import { sendPasswordResetEmail, mailConfigured } from "./mailer.js";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.VITEST ? "dev_only_change_me" : "");

const TOKEN_TTL = "7d";

const sign = (user) =>
  jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });

export const signToken = sign;

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  handle: u.handle,
  email: u.email,
});

const normalizeHandle = (value) =>
  String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

const validHandle = (handle) =>
  /^[a-z0-9_.]{3,30}$/.test(handle);

export async function register(req, res) {
  const {
    name,
    handle: rawHandle,
    email,
    password,
  } = req.body || {};

  const handle = normalizeHandle(rawHandle);

  if (!name || !handle || !email || !password) {
    return res.status(400).json({
      error: "Name, handle, email, and password are all required.",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: "Use a password of at least 8 characters.",
    });
  }

  if (!validHandle(handle)) {
    return res.status(400).json({
      error:
        "Handle must be 3–30 characters using letters, numbers, periods, or underscores.",
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  if (
    String(name).trim().length > 80 ||
    normalizedEmail.length > 254
  ) {
    return res.status(400).json({
      error: "Name or email is too long.",
    });
  }

  if (await getUserByEmail(normalizedEmail)) {
    return res.status(409).json({
      error: "That email is already registered.",
    });
  }

  if (await getUserByHandle(handle)) {
    return res.status(409).json({
      error: "That handle is already taken.",
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await createUser({
    name: String(name).trim(),
    handle,
    email: normalizedEmail,
    password_hash: passwordHash,
  });

  res.json({
    token: sign(user),
    user: publicUser(user),
  });
}

// ── Google sign-in ───────────────────────────────────────

export async function googleAuth(req, res) {
  const { idToken } = req.body || {};

  if (!idToken) {
    return res.status(400).json({
      error: "Missing Google credential.",
    });
  }

  let payload;

  try {
    payload = await verifyGoogleToken(idToken);
  } catch {
    return res.status(400).json({
      error: "Couldn't verify that Google sign-in. Please try again.",
    });
  }

  if (!payload.emailVerified) {
    return res.status(400).json({
      error: "That Google account's email isn't verified.",
    });
  }

  const byGoogleId = await getUserByGoogleId(payload.googleId);

  if (byGoogleId) {
    return res.json({
      status: "ok",
      token: sign(byGoogleId),
      user: publicUser(byGoogleId),
    });
  }

  const byEmail = await getUserByEmail(
    payload.email.toLowerCase()
  );

  if (byEmail) {
    await linkGoogleId(byEmail.id, payload.googleId);

    const linked = await getUserById(byEmail.id);

    return res.json({
      status: "ok",
      token: sign(linked),
      user: publicUser(linked),
    });
  }

  res.json({
    status: "needs_registration",
    name: payload.name,
    email: payload.email,
  });
}

export async function registerWithGoogle(req, res) {
  const {
    idToken,
    handle: rawHandle,
  } = req.body || {};

  const handle = normalizeHandle(rawHandle);

  if (!idToken || !handle) {
    return res.status(400).json({
      error: "Handle is required to finish registration.",
    });
  }

  if (!validHandle(handle)) {
    return res.status(400).json({
      error:
        "Handle must be 3–30 characters using letters, numbers, periods, or underscores.",
    });
  }

  let payload;

  try {
    payload = await verifyGoogleToken(idToken);
  } catch {
    return res.status(400).json({
      error: "That Google sign-in expired. Please try again.",
    });
  }

  if (!payload.emailVerified) {
    return res.status(400).json({
      error: "That Google account's email isn't verified.",
    });
  }

  if (await getUserByGoogleId(payload.googleId)) {
    return res.status(409).json({
      error: "That Google account is already registered.",
    });
  }

  const normalizedEmail = payload.email.toLowerCase();

  const existing = await getUserByEmail(normalizedEmail);

  if (existing) {
    await linkGoogleId(existing.id, payload.googleId);

    const linked = await getUserById(existing.id);

    return res.json({
      token: sign(linked),
      user: publicUser(linked),
    });
  }

  if (await getUserByHandle(handle)) {
    return res.status(409).json({
      error: "That handle is already taken.",
    });
  }

  const user = await createUser({
    name: payload.name,
    handle,
    email: normalizedEmail,
    googleId: payload.googleId,
  });

  res.json({
    token: sign(user),
    user: publicUser(user),
  });
}

export async function login(req, res) {
  const { email, password } = req.body || {};

  const user = await getUserByEmail(
    String(email || "").trim().toLowerCase()
  );

  if (!user || !user.passwordHash) {
    return res.status(401).json({
      error: user
        ? "That account signs in with Google."
        : "No account matches those details.",
    });
  }

  const ok = await bcrypt.compare(
    password || "",
    user.passwordHash
  );

  if (!ok) {
    return res.status(401).json({
      error: "No account matches those details.",
    });
  }

  res.json({
    token: sign(user),
    user: publicUser(user),
  });
}

// ── password reset ───────────────────────────────────────
// Two rules shape this whole flow:
//   1. /forgot answers the same way no matter what — an attacker must not be
//      able to learn from it whether an email has an account here.
//   2. Only the SHA-256 of the token reaches the database, so a leaked table
//      dump cannot be replayed into an account takeover.

const RESET_TTL_MINUTES = 60;
const MIN_PASSWORD_LENGTH = 8;

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export async function requestPasswordReset(req, res) {
  const { email } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();

  // The neutral answer, returned on every path below.
  const accepted = () =>
    res.json({
      ok: true,
      message: "If that email has an account, a reset link is on its way.",
    });

  if (!normalizedEmail || normalizedEmail.length > 254) return accepted();

  const user = await getUserByEmail(normalizedEmail);

  // No account, or a Google-only one: nothing to reset, and saying so would
  // leak which emails are registered. A Google account still signs in.
  if (!user || !user.passwordHash) return accepted();

  if (!mailConfigured()) {
    console.error("[auth] password reset requested but no mail provider is configured.");
    return accepted();
  }

  // Any earlier outstanding link for this account stops working the moment a
  // newer one is issued, so a forwarded old email is not a second key.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString("base64url");

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    },
  });

  await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    token,
    ttlMinutes: RESET_TTL_MINUTES,
  });

  return accepted();
}

export async function resetPassword(req, res) {
  const { token, password } = req.body || {};

  if (!token || !password) {
    return res.status(400).json({ error: "That reset link is incomplete." });
  }

  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(String(token)) },
  });

  // One message for every failure shape — expired, already used, never
  // existed — so probing tells an attacker nothing.
  const invalid = () =>
    res.status(400).json({
      error: "That reset link has expired or already been used. Request a new one.",
    });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return invalid();
  }

  const user = await getUserById(record.userId);
  if (!user) return invalid();

  const passwordHash = await bcrypt.hash(String(password), 12);

  // Stamping the token and setting the password in one transaction means a
  // failure part-way cannot leave a spent link that still works.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  return res.json({ ok: true });
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Sign in to continue.",
    });
  }

  try {
    const { uid } = jwt.verify(token, JWT_SECRET);

    const user = await getUserById(uid);

    if (!user) {
      return res.status(401).json({
        error: "Session no longer valid.",
      });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({
      error: "Session expired. Sign in again.",
    });
  }
}