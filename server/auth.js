import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  createUser, getUserByEmail, getUserById, getUserByGoogleId, linkGoogleId, setDwollaCustomer,
} from "./db.js";
import { verifyGoogleToken } from "./google.js";
import { createVerifiedCustomer, getCustomerStatus } from "./dwolla/index.js";

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev_only_change_me");
const TOKEN_TTL = "7d";

const sign = (user) => jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
// Exposed for webauthn.js — passkey sign-in ends the same way password/Google
// sign-in do, and duplicating JWT signing would be a second copy to keep in sync.
export const signToken = sign;

// strip sensitive/internal fields before sending a user to the client
export const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email,
});

// Validate the KYC fields required to verify identity with Dwolla.
// Returns an error string, or null if everything checks out.
const identityFieldsError = ({ address1, city, state, postalCode, dateOfBirth, ssn }) => {
  if (!address1 || !city || !state || !postalCode || !dateOfBirth || !ssn)
    return "Address, date of birth, and SSN are required to verify your identity.";
  if (!/^[A-Za-z]{2}$/.test(state)) return "State must be a 2-letter code.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return "Date of birth must be YYYY-MM-DD.";
  if (!/^\d{9}$/.test(String(ssn).replace(/-/g, ""))) return "Enter a full 9-digit SSN.";
  return null;
};

// Split a display name into Dwolla's required firstName/lastName. A single
// word becomes both (Dwolla requires a non-empty lastName).
const splitName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : parts[0] };
};

// Dwolla returns validation failures as a structured body; surface the first
// human-readable message instead of a generic 500.
const dwollaErrorMessage = (e) =>
  e?.body?._embedded?.errors?.[0]?.message || e?.body?.message || "We couldn't verify your identity with the information provided.";

export async function register(req, res) {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email, and password are all required." });
  if (password.length < 8)
    return res.status(400).json({ error: "Use a password of at least 8 characters." });

  const normalizedEmail = String(email).trim().toLowerCase();
  if (String(name).trim().length > 80 || normalizedEmail.length > 254)
    return res.status(400).json({ error: "Name or email is too long." });
  if (await getUserByEmail(normalizedEmail)) return res.status(409).json({ error: "That email is already registered." });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser({ name: String(name).trim(), email: normalizedEmail, passwordHash });

  res.json({ token: sign(user), user: publicUser(user) });
}

// ── Google sign-in ───────────────────────────────────────
// Authentication only — Google proves who someone is.

/**
 * POST /api/auth/google — body { idToken }.
 * Resolves to an existing account (by googleId, or by linking a
 * Google-verified email to a matching password account), or reports that a
 * new account is needed with the name/email Google vouches for.
 */
export async function googleAuth(req, res) {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "Missing Google credential." });

  let payload;
  try {
    payload = await verifyGoogleToken(idToken);
  } catch {
    return res.status(400).json({ error: "Couldn't verify that Google sign-in. Please try again." });
  }
  if (!payload.emailVerified) return res.status(400).json({ error: "That Google account's email isn't verified." });

  const byGoogleId = await getUserByGoogleId(payload.googleId);
  if (byGoogleId) return res.json({ status: "ok", token: sign(byGoogleId), user: publicUser(byGoogleId) });

  // Same verified email as an existing password account — same person,
  // proven independently by Google, so link rather than creating a duplicate.
  const byEmail = await getUserByEmail(payload.email.toLowerCase());
  if (byEmail) {
    await linkGoogleId(byEmail.id, payload.googleId);
    const linked = await getUserById(byEmail.id);
    return res.json({ status: "ok", token: sign(linked), user: publicUser(linked) });
  }

  res.json({ status: "needs_registration", name: payload.name, email: payload.email });
}

/**
 * POST /api/register/google — body { idToken, name }.
 * The idToken is re-verified here rather than trusting the name/email the
 * client echoed back from the /api/auth/google response.
 */
export async function registerWithGoogle(req, res) {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "Missing required fields." });

  let payload;
  try {
    payload = await verifyGoogleToken(idToken);
  } catch {
    return res.status(400).json({ error: "That Google sign-in expired. Please try again." });
  }
  if (!payload.emailVerified) return res.status(400).json({ error: "That Google account's email isn't verified." });
  if (await getUserByGoogleId(payload.googleId)) return res.status(409).json({ error: "That Google account is already registered." });

  const normalizedEmail = payload.email.toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    await linkGoogleId(existing.id, payload.googleId);
    const linked = await getUserById(existing.id);
    return res.json({ token: sign(linked), user: publicUser(linked) });
  }

  const user = await createUser({ name: payload.name, email: normalizedEmail, googleId: payload.googleId });
  res.json({ token: sign(user), user: publicUser(user) });
}

// Complete identity verification for an account created before the Dwolla
// migration (it has no Verified Customer yet). Same fields and flow as
// registration used to collect; SSN passes straight to Dwolla and is never
// stored.
export async function verifyIdentity(req, res) {
  if (req.user.dwollaCustomerUrl) {
    // Customer already exists — just re-read status (covers webhook misses).
    const kycStatus = (await getCustomerStatus(req.user.dwollaCustomerUrl)).toUpperCase();
    await setDwollaCustomer(req.user.id, { dwollaCustomerUrl: req.user.dwollaCustomerUrl, kycStatus });
    return res.json({ user: publicUser(await getUserById(req.user.id)) });
  }

  const { address1, city, state, postalCode, dateOfBirth, ssn } = req.body || {};
  const fieldErr = identityFieldsError({ address1, city, state, postalCode, dateOfBirth, ssn });
  if (fieldErr) return res.status(400).json({ error: fieldErr });

  const { firstName, lastName } = splitName(req.user.name);
  let dwollaCustomerUrl;
  try {
    dwollaCustomerUrl = await createVerifiedCustomer({
      firstName, lastName, email: req.user.email,
      address1: String(address1).trim(), city: String(city).trim(),
      state: state.toUpperCase(), postalCode: String(postalCode).trim(),
      dateOfBirth, ssn: String(ssn).replace(/-/g, ""),
    });
  } catch (e) {
    return res.status(400).json({ error: dwollaErrorMessage(e) });
  }
  const kycStatus = (await getCustomerStatus(dwollaCustomerUrl)).toUpperCase();
  await setDwollaCustomer(req.user.id, { dwollaCustomerUrl, kycStatus });
  res.json({ user: publicUser(await getUserById(req.user.id)) });
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  const user = await getUserByEmail(String(email || "").trim().toLowerCase());
  // A Google-only account has no passwordHash to compare against; bcrypt would
  // throw on a null hash, and either way there's no password to check.
  if (!user || !user.passwordHash)
    return res.status(401).json({ error: user ? "That account signs in with Google." : "No account matches those details." });
  const ok = await bcrypt.compare(password || "", user.passwordHash);
  if (!ok) return res.status(401).json({ error: "No account matches those details." });
  res.json({ token: sign(user), user: publicUser(user) });
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  try {
    const { uid } = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(uid);
    if (!user) return res.status(401).json({ error: "Session no longer valid." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Sign in again." });
  }
}
