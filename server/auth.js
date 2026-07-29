import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createUser, getUserByEmail, getUserByHandle, getUserById } from "./db.js";
import { cleanHandle } from "./logic.js";

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev_only_change_me");
const TOKEN_TTL = "7d";

const sign = (user) => jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });

// strip sensitive/internal fields before sending a user to the client
export const publicUser = (u) => ({
  id: u.id, name: u.name, handle: u.handle, email: u.email,
  balanceCents: u.balanceCents, hasBank: !!u.stripeAccountId,
});

export async function register(req, res) {
  const { name, handle, email, password } = req.body || {};
  if (!name || !handle || !email || !password)
    return res.status(400).json({ error: "Name, handle, email, and password are all required." });
  if (password.length < 8)
    return res.status(400).json({ error: "Use a password of at least 8 characters." });

  const normalizedEmail = String(email).trim().toLowerCase();
  const h = cleanHandle(handle).toLowerCase();
  if (!/^@[a-z0-9_]{3,24}$/.test(h)) return res.status(400).json({ error: "Use 3–24 letters, numbers, or underscores for your handle." });
  if (String(name).trim().length > 80 || normalizedEmail.length > 254) return res.status(400).json({ error: "Name or email is too long." });
  if (await getUserByEmail(normalizedEmail)) return res.status(409).json({ error: "That email is already registered." });
  if (await getUserByHandle(h)) return res.status(409).json({ error: "That handle is taken." });

  const password_hash = await bcrypt.hash(password, 12);
  const user = await createUser({ name: String(name).trim(), handle: h, email: normalizedEmail, password_hash });
  res.json({ token: sign(user), user: publicUser(user) });
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
