// server/plaid/tokenCrypto.js
// Encrypts Plaid access tokens before they are persisted.
// Set PLAID_TOKEN_ENCRYPTION_KEY to a 64-character hex string (32 bytes).
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "v1";
const KEY_HEX = process.env.PLAID_TOKEN_ENCRYPTION_KEY || "";

function getKey() {
  if (!/^[0-9a-fA-F]{64}$/.test(KEY_HEX)) {
    throw new Error(
      "PLAID_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes)."
    );
  }
  return Buffer.from(KEY_HEX, "hex");
}

export function isEncryptedPlaidToken(value) {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

export function encryptPlaidToken(plaintext) {
  if (!plaintext) throw new Error("Cannot encrypt an empty Plaid access token.");
  if (isEncryptedPlaidToken(plaintext)) return plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptPlaidToken(value) {
  if (!value) throw new Error("Missing Plaid access token.");
  if (!isEncryptedPlaidToken(value)) return value; // legacy plaintext; caller should migrate it
  const [, ivB64, tagB64, ciphertextB64] = value.split(":");
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("Invalid encrypted Plaid access token.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
