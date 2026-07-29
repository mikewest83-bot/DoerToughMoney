// dwolla/client.js
// Single shared Dwolla API client. The SDK handles OAuth client_credentials
// token fetching + refresh for you.
import { Client } from "dwolla-v2";

const { DWOLLA_KEY, DWOLLA_SECRET, DWOLLA_ENV } = process.env;

if (!DWOLLA_KEY || !DWOLLA_SECRET) {
  throw new Error("Missing DWOLLA_KEY / DWOLLA_SECRET env vars");
}

export const dwolla = new Client({
  key: DWOLLA_KEY,
  secret: DWOLLA_SECRET,
  environment: DWOLLA_ENV === "production" ? "production" : "sandbox",
});

// Helper: convert integer cents -> Dwolla's decimal string ("2500" -> "25.00").
export const centsToValue = (cents) => (cents / 100).toFixed(2);

// Helper: last path segment of a Dwolla resource URL == its id.
export const idFromUrl = (url) => (url ? url.split("/").pop() : null);
