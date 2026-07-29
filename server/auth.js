import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createUser, getUserByEmail, getUserByHandle, getUserById, setDwollaCustomer } from "./db.js";
import { cleanHandle } from "./logic.js";
import { createVerifiedCustomer, getCustomerStatus } from "./dwolla/index.js";

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev_only_change_me");
const TOKEN_TTL = "7d";

const sign = (user) => jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });

// strip sensitive/internal fields before sending a user to the client
export const publicUser = (u) => ({
  id: u.id, name: u.name, handle: u.handle, email: u.email,
  kycStatus: u.kycStatus, hasBank: !!u.fundingSourceUrl, bankVerified: u.fundingSourceVerified,
});

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
  const { name, handle, email, password, address1, city, state, postalCode, dateOfBirth, ssn } = req.body || {};
  if (!name || !handle || !email || !password)
    return res.status(400).json({ error: "Name, handle, email, and password are all required." });
  if (password.length < 8)
    return res.status(400).json({ error: "Use a password of at least 8 characters." });
  if (!address1 || !city || !state || !postalCode || !dateOfBirth || !ssn)
    return res.status(400).json({ error: "Address, date of birth, and SSN are required to verify your identity." });
  if (!/^[A-Za-z]{2}$/.test(state)) return res.status(400).json({ error: "State must be a 2-letter code." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return res.status(400).json({ error: "Date of birth must be YYYY-MM-DD." });
  if (!/^\d{9}$/.test(String(ssn).replace(/-/g, ""))) return res.status(400).json({ error: "Enter a full 9-digit SSN." });

  const normalizedEmail = String(email).trim().toLowerCase();
  const h = cleanHandle(handle).toLowerCase();
  if (!/^@[a-z0-9_]{3,24}$/.test(h)) return res.status(400).json({ error: "Use 3–24 letters, numbers, or underscores for your handle." });
  if (String(name).trim().length > 80 || normalizedEmail.length > 254) return res.status(400).json({ error: "Name or email is too long." });
  if (await getUserByEmail(normalizedEmail)) return res.status(409).json({ error: "That email is already registered." });
  if (await getUserByHandle(h)) return res.status(409).json({ error: "That handle is taken." });

  // Verify identity with Dwolla BEFORE creating the local account, so a
  // rejected application never leaves behind an orphaned user row. The SSN
  // is passed straight through to Dwolla and never written to our database.
  const { firstName, lastName } = splitName(name);
  let dwollaCustomerUrl;
  try {
    dwollaCustomerUrl = await createVerifiedCustomer({
      firstName, lastName, email: normalizedEmail,
      address1: String(address1).trim(), city: String(city).trim(),
      state: state.toUpperCase(), postalCode: String(postalCode).trim(),
      dateOfBirth, ssn: String(ssn).replace(/-/g, ""),
    });
  } catch (e) {
    return res.status(400).json({ error: dwollaErrorMessage(e) });
  }
  const kycStatus = (await getCustomerStatus(dwollaCustomerUrl)).toUpperCase();

  const password_hash = await bcrypt.hash(password, 12);
  const user = await createUser({ name: String(name).trim(), handle: h, email: normalizedEmail, password_hash });
  await setDwollaCustomer(user.id, { dwollaCustomerUrl, kycStatus });
  const withDwolla = await getUserById(user.id);
  res.json({ token: sign(withDwolla), user: publicUser(withDwolla) });
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  const user = await getUserByEmail(String(email || "").trim().toLowerCase());
  if (!user) return res.status(401).json({ error: "No account matches those details." });
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
