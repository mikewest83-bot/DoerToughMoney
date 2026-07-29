// dwolla/client.js
// Single shared Dwolla API client. The SDK handles OAuth client_credentials
// token fetching + refresh for you.
//
// Built lazily behind a Proxy so the app can boot (health checks, auth,
// static hosting) even before DWOLLA_KEY/DWOLLA_SECRET are configured —
// only routes that actually touch Dwolla fail until the keys are set.
import { Client } from "dwolla-v2";

let _client;
function getClient() {
  if (_client) return _client;
  const { DWOLLA_KEY, DWOLLA_SECRET, DWOLLA_ENV } = process.env;
  if (!DWOLLA_KEY || !DWOLLA_SECRET) {
    throw new Error("DWOLLA_KEY / DWOLLA_SECRET are not configured — identity verification, bank linking, and payments are unavailable until they're set.");
  }
  _client = new Client({
    key: DWOLLA_KEY,
    secret: DWOLLA_SECRET,
    environment: DWOLLA_ENV === "production" ? "production" : "sandbox",
  });
  return _client;
}

export const dwolla = new Proxy({}, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Helper: convert integer cents -> Dwolla's decimal string ("2500" -> "25.00").
export const centsToValue = (cents) => (cents / 100).toFixed(2);

// Helper: last path segment of a Dwolla resource URL == its id.
export const idFromUrl = (url) => (url ? url.split("/").pop() : null);
