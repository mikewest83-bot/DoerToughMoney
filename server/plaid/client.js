// plaid/client.js
// Shared Plaid API client, built lazily behind a Proxy so the app boots even
// before PLAID_CLIENT_ID/PLAID_SECRET are configured — only the instant
// bank-linking routes fail until they're set, and the manual routing/account
// path keeps working regardless.
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

let _client;
function getClient() {
  if (_client) return _client;
  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV } = process.env;
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new Error("PLAID_CLIENT_ID / PLAID_SECRET are not configured — instant bank linking is unavailable; use manual account entry.");
  }
  _client = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV === "production" ? "production" : "sandbox"],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
        "PLAID-SECRET": PLAID_SECRET,
      },
    },
  }));
  return _client;
}

export const plaid = new Proxy({}, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
