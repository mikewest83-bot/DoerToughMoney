// plaid/client.js
// Single shared Plaid API client. Built lazily so the app can boot (health
// checks, auth, static hosting) even before PLAID_CLIENT_ID/PLAID_SECRET are
// configured — only routes that actually touch Plaid fail until the keys are
// set. Same pattern the old dwolla/client.js used.
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

let _client;
function getClient() {
  if (_client) return _client;
  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV } = process.env;
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new Error("PLAID_CLIENT_ID / PLAID_SECRET are not configured — bank linking and transaction sync are unavailable until they're set.");
  }
  const configuration = new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV === "production" ? "production" : "sandbox"],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
        "PLAID-SECRET": PLAID_SECRET,
      },
    },
  });
  _client = new PlaidApi(configuration);
  return _client;
}

export const plaid = new Proxy({}, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Helper: Plaid's amounts are decimal dollars (25.00); DoerToughMoney stores
// integer cents everywhere else, so convert once at the edge.
export const dollarsToCents = (amount) => Math.round(Number(amount) * 100);
export const centsToDollars = (cents) => cents / 100;
