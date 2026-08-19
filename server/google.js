// google.js — verifies Google Identity Services ID tokens server-side.
// Built lazily, same pattern as plaid/client.js: the app boots fine without
// GOOGLE_CLIENT_ID configured, and only the Google sign-in routes fail with a
// clear error until it's set. Only a Client ID is needed — this verifies an
// ID token Google already signed, not the authorization-code flow, so there's
// no client secret to protect.
import { OAuth2Client } from "google-auth-library";

let _client;
function getClient() {
  if (_client) return _client;
  const { GOOGLE_CLIENT_ID } = process.env;
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is not configured — Google sign-in is unavailable until it's set.");
  }
  _client = new OAuth2Client(GOOGLE_CLIENT_ID);
  return _client;
}

/**
 * @param idToken  the credential Google Identity Services hands the frontend
 * @returns {{googleId, email, emailVerified, name}}
 * @throws if the token is missing, expired, or signed for a different client
 */
export async function verifyGoogleToken(idToken) {
  const client = getClient();
  const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: !!payload.email_verified,
    name: payload.name || payload.email,
  };
}

export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID;
