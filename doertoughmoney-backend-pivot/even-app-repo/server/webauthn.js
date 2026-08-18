// webauthn.js — passkey (Face ID / Touch ID) enrollment and sign-in.
//
// Registering a passkey requires already being signed in (you enroll a device
// from inside the app); signing IN via passkey is discoverable/usernameless —
// the browser offers whichever credential it holds for this domain without
// asking for an identifier first, and the credential ID the browser returns
// is how we look up which account it belongs to.
//
// Every ceremony needs a server-held challenge for the round trip. This app is
// stateless (JWT, no session store), so rather than add a dependency the
// challenge lives in an in-memory Map keyed by a random attempt ID with a
// short TTL. Same "assumes a single instance" tradeoff already made for the
// reconcile and Reg E crons in server.js — a restart mid-ceremony just means
// the user taps the button again.
import { randomUUID } from "crypto";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import prisma from "./db.js";
import { signToken, publicUser } from "./auth.js";

const RP_NAME = "even";
// The relying party ID must be the bare hostname (no scheme/port) and must
// match what actually serves the page, or every ceremony fails signature
// verification. Derived from WEB_ORIGIN so dev (localhost) and production
// (even-app-production.up.railway.app) each get the right value automatically.
function rpId() {
  try { return new URL(process.env.WEB_ORIGIN || "http://localhost:5173").hostname; }
  catch { return "localhost"; }
}
function expectedOrigin() {
  return process.env.WEB_ORIGIN || "http://localhost:5173";
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const challenges = new Map(); // attemptId -> { challenge, userId?, expires }

function stashChallenge(challenge, userId = null) {
  const attemptId = randomUUID();
  challenges.set(attemptId, { challenge, userId, expires: Date.now() + CHALLENGE_TTL_MS });
  return attemptId;
}
function takeChallenge(attemptId) {
  const entry = challenges.get(attemptId);
  challenges.delete(attemptId); // single use, whether or not it's still valid
  if (!entry || entry.expires < Date.now()) return null;
  return entry;
}
// Sweep occasionally so an abandoned ceremony doesn't sit forever — this map
// is the only thing standing in for a session store.
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of challenges) if (e.expires < now) challenges.delete(id);
}, CHALLENGE_TTL_MS).unref();

// So the client can tell "already enrolled" from "never asked" and only show
// the one-time enrollment prompt in the latter case.
export async function listCredentials(req, res) {
  const rows = await prisma.credential.findMany({
    where: { userId: req.user.id },
    select: { id: true, deviceLabel: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ credentials: rows });
}

// ── enrollment (authRequired) ─────────────────────────────
export async function registrationOptions(req, res) {
  const existing = await prisma.credential.findMany({ where: { userId: req.user.id }, select: { credentialId: true, transports: true } });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userID: Buffer.from(req.user.id),
    userName: req.user.email,
    userDisplayName: req.user.name,
    attestationType: "none",
    // A device the user already registered shouldn't be offered again.
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
    authenticatorSelection: {
      residentKey: "required", // true discoverable passkey, not a plain 2nd factor
      userVerification: "preferred",
      authenticatorAttachment: "platform", // Face ID / Touch ID, not a USB key
    },
  });
  const attemptId = stashChallenge(options.challenge, req.user.id);
  res.json({ attemptId, options });
}

export async function registrationVerify(req, res) {
  const { attemptId, response, deviceLabel } = req.body || {};
  const entry = takeChallenge(attemptId);
  if (!entry || entry.userId !== req.user.id) return res.status(400).json({ error: "That request expired. Please try again." });

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge: entry.challenge, expectedOrigin: expectedOrigin(), expectedRPID: rpId(),
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Couldn't verify that device." });
  }
  if (!verification.verified || !verification.registrationInfo)
    return res.status(400).json({ error: "Couldn't verify that device." });

  const { credential } = verification.registrationInfo;
  await prisma.credential.create({
    data: {
      userId: req.user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: response?.response?.transports || [],
      deviceLabel: deviceLabel ? String(deviceLabel).slice(0, 60) : null,
    },
  });
  res.status(201).json({ ok: true });
}

// ── sign-in (public, discoverable) ────────────────────────
export async function authenticationOptions(_req, res) {
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "preferred",
    // Empty on purpose — this is what makes it usernameless. The browser
    // surfaces whichever passkey it holds for this domain.
    allowCredentials: [],
  });
  const attemptId = stashChallenge(options.challenge);
  res.json({ attemptId, options });
}

export async function authenticationVerify(req, res) {
  const { attemptId, response } = req.body || {};
  const entry = takeChallenge(attemptId);
  if (!entry) return res.status(400).json({ error: "That request expired. Please try again." });

  const cred = await prisma.credential.findUnique({ where: { credentialId: response?.id }, include: { user: true } });
  if (!cred) return res.status(400).json({ error: "No passkey found for this device." });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge: entry.challenge, expectedOrigin: expectedOrigin(), expectedRPID: rpId(),
      credential: { id: cred.credentialId, publicKey: cred.publicKey, counter: Number(cred.counter), transports: cred.transports },
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Couldn't verify that passkey." });
  }
  if (!verification.verified) return res.status(400).json({ error: "Couldn't verify that passkey." });

  // Counter must strictly increase — a stall or rollback signals a cloned
  // authenticator, which is exactly what this check exists to catch.
  await prisma.credential.update({
    where: { id: cred.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter) },
  });

  res.json({ token: signToken(cred.user), user: publicUser(cred.user) });
}
