// webauthn.js — DoerToughMoney passkey (Face ID / Touch ID) enrollment
// and sign-in.
//
// Passkey enrollment requires an authenticated DoerToughMoney account.
// Passkey sign-in is discoverable/usernameless.
//
// IMPORTANT:
// Production WebAuthn must use the exact DoerToughMoney web hostname.

import { randomUUID } from "crypto";

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

import prisma from "./db.js";
import { signToken, publicUser } from "./auth.js";

// ─────────────────────────────────────────────────────────
// DoerToughMoney WebAuthn configuration
// ─────────────────────────────────────────────────────────

const RP_NAME = "DoerToughMoney";

const PRODUCTION_ORIGIN =
  "https://doertoughmoney-web-production.up.railway.app";

function expectedOrigin() {
  return process.env.WEB_ORIGIN || PRODUCTION_ORIGIN;
}

function rpId() {
  try {
    return new URL(expectedOrigin()).hostname;
  } catch {
    return "doertoughmoney-web-production.up.railway.app";
  }
}

// ─────────────────────────────────────────────────────────
// Challenge storage
// ─────────────────────────────────────────────────────────

const CHALLENGE_TTL_MS = 5 * 60_000;

// attemptId -> { challenge, userId?, expires }
const challenges = new Map();

function stashChallenge(challenge, userId = null) {
  const attemptId = randomUUID();

  challenges.set(attemptId, {
    challenge,
    userId,
    expires: Date.now() + CHALLENGE_TTL_MS,
  });

  return attemptId;
}

function takeChallenge(attemptId) {
  const entry = challenges.get(attemptId);

  // Challenges are single-use.
  challenges.delete(attemptId);

  if (!entry || entry.expires < Date.now()) {
    return null;
  }

  return entry;
}

// Clean up abandoned ceremonies.
setInterval(() => {
  const now = Date.now();

  for (const [id, entry] of challenges) {
    if (entry.expires < now) {
      challenges.delete(id);
    }
  }
}, CHALLENGE_TTL_MS).unref();

// ─────────────────────────────────────────────────────────
// List enrolled passkeys
// ─────────────────────────────────────────────────────────

export async function listCredentials(req, res) {
  try {
    const rows = await prisma.credential.findMany({
      where: {
        userId: req.user.id,
      },
      select: {
        id: true,
        deviceLabel: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json({
      credentials: rows,
    });
  } catch (error) {
    console.error("Passkey credential lookup failed:", error);

    res.status(500).json({
      error: "Unable to load passkey settings.",
    });
  }
}

// ─────────────────────────────────────────────────────────
// Passkey enrollment
// Requires existing authentication.
// ─────────────────────────────────────────────────────────

export async function registrationOptions(req, res) {
  try {
    const existing = await prisma.credential.findMany({
      where: {
        userId: req.user.id,
      },
      select: {
        credentialId: true,
        transports: true,
      },
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpId(),

      userID: Buffer.from(String(req.user.id)),

      userName: req.user.email,

      userDisplayName:
        req.user.name || req.user.email,

      attestationType: "none",

      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports || [],
      })),

      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
    });

    const attemptId = stashChallenge(
      options.challenge,
      req.user.id
    );

    res.json({
      attemptId,
      options,
    });
  } catch (error) {
    console.error("Passkey registration options failed:", error);

    res.status(500).json({
      error: "Unable to start Face ID enrollment.",
    });
  }
}

// ─────────────────────────────────────────────────────────
// Passkey enrollment verification
// ─────────────────────────────────────────────────────────

export async function registrationVerify(req, res) {
  const {
    attemptId,
    response,
    deviceLabel,
  } = req.body || {};

  const entry = takeChallenge(attemptId);

  if (!entry || entry.userId !== req.user.id) {
    return res.status(400).json({
      error:
        "That Face ID request expired. Please start enrollment again.",
    });
  }

  let verification;

  try {
    verification = await verifyRegistrationResponse({
      response,

      expectedChallenge: entry.challenge,

      expectedOrigin: expectedOrigin(),

      expectedRPID: rpId(),
    });
  } catch (error) {
    console.error(
      "Passkey registration verification failed:",
      error
    );

    return res.status(400).json({
      error:
        error.message ||
        "Couldn't verify this device.",
    });
  }

  if (
    !verification.verified ||
    !verification.registrationInfo
  ) {
    return res.status(400).json({
      error: "Couldn't verify this device.",
    });
  }

  const { credential } =
    verification.registrationInfo;

  try {
    await prisma.credential.create({
      data: {
        userId: req.user.id,

        credentialId: credential.id,

        publicKey: Buffer.from(
          credential.publicKey
        ),

        counter: BigInt(
          credential.counter
        ),

        transports:
          response?.response?.transports || [],

        deviceLabel: deviceLabel
          ? String(deviceLabel).slice(0, 60)
          : "iPhone",
      },
    });
  } catch (error) {
    console.error(
      "Saving passkey failed:",
      error
    );

    return res.status(500).json({
      error:
        "Face ID was verified, but the device could not be saved.",
    });
  }

  res.status(201).json({
    ok: true,
  });
}

// ─────────────────────────────────────────────────────────
// Passkey sign-in options
// Public / discoverable
// ─────────────────────────────────────────────────────────

export async function authenticationOptions(_req, res) {
  try {
    const options =
      await generateAuthenticationOptions({
        rpID: rpId(),

        userVerification: "required",

        // IMPORTANT:
        // Empty allowCredentials makes this a discoverable
        // usernameless passkey flow.
        allowCredentials: [],
      });

    const attemptId = stashChallenge(
      options.challenge
    );

    res.json({
      attemptId,
      options,
    });
  } catch (error) {
    console.error(
      "Passkey authentication options failed:",
      error
    );

    res.status(500).json({
      error:
        "Unable to start Face ID sign-in.",
    });
  }
}

// ─────────────────────────────────────────────────────────
// Passkey sign-in verification
// ─────────────────────────────────────────────────────────

export async function authenticationVerify(req, res) {
  const {
    attemptId,
    response,
  } = req.body || {};

  const entry = takeChallenge(attemptId);

  if (!entry) {
    return res.status(400).json({
      error:
        "That Face ID request expired. Please try again.",
    });
  }

  if (!response?.id) {
    return res.status(400).json({
      error:
        "No passkey credential was returned.",
    });
  }

  const cred =
    await prisma.credential.findUnique({
      where: {
        credentialId: response.id,
      },
      include: {
        user: true,
      },
    });

  if (!cred) {
    return res.status(400).json({
      error:
        "No DoerToughMoney passkey is registered for this device.",
    });
  }

  let verification;

  try {
    verification =
      await verifyAuthenticationResponse({
        response,

        expectedChallenge:
          entry.challenge,

        expectedOrigin:
          expectedOrigin(),

        expectedRPID:
          rpId(),

        credential: {
          id: cred.credentialId,

          publicKey: cred.publicKey,

          counter: Number(
            cred.counter
          ),

          transports:
            cred.transports || [],
        },
      });
  } catch (error) {
    console.error(
      "Passkey authentication verification failed:",
      error
    );

    return res.status(400).json({
      error:
        error.message ||
        "Couldn't verify this Face ID passkey.",
    });
  }

  if (!verification.verified) {
    return res.status(400).json({
      error:
        "Couldn't verify this Face ID passkey.",
    });
  }

  // Update authenticator counter.
  await prisma.credential.update({
    where: {
      id: cred.id,
    },

    data: {
      counter: BigInt(
        verification.authenticationInfo
          .newCounter
      ),
    },
  });

  res.json({
    token: signToken(cred.user),

    user: publicUser(
      cred.user
    ),
  });
}