// dwolla/openBanking.js
// Instant Account Verification through Dwolla's Open Banking Services, which
// brokers the Plaid connection on our behalf — no separate Plaid account,
// contract, or credentials required.
//
// The flow, in four hops:
//   1. createExchangeSession  -> Dwolla mints a session for this customer
//   2. getSessionToken        -> yields a Plaid Link token for the browser
//   3. createExchange         -> Link's publicToken becomes a durable Exchange
//   4. addBankViaExchange     -> funding source, verified on creation
//
// Sessions are single-use: once a user starts one it can't be replayed, so each
// attempt mints a fresh session.
import { dwolla } from "./client.js";

// The exchange-partner href differs per environment (the UUID in Dwolla's docs
// is production-only), so it's looked up rather than hardcoded. Cached because
// it's stable for the lifetime of the process.
let _plaidPartnerHref;
export async function getPlaidPartnerHref() {
  if (_plaidPartnerHref) return _plaidPartnerHref;
  const res = await dwolla.get("exchange-partners");
  const partners = res.body._embedded?.["exchange-partners"] ?? [];
  const plaid = partners.find((p) => p.name?.toLowerCase() === "plaid" && p.status === "active");
  if (!plaid) throw new Error("Plaid is not an active exchange partner on this Dwolla account.");
  _plaidPartnerHref = plaid._links.self.href;
  return _plaidPartnerHref;
}

/**
 * Start an IAV session for a customer.
 * @param redirectUrl  required for native iOS/Android OAuth returns; unused on web.
 * @returns {string} exchange session URL
 */
export async function createExchangeSession(customerUrl, redirectUrl) {
  const body = { _links: { "exchange-partner": { href: await getPlaidPartnerHref() } } };
  if (redirectUrl) body["redirect-url"] = redirectUrl;
  const res = await dwolla.post(`${customerUrl}/exchange-sessions`, body);
  return res.headers.get("location");
}

/** The Plaid Link token the browser needs to open Link. */
export async function getSessionToken(exchangeSessionUrl) {
  const res = await dwolla.get(exchangeSessionUrl);
  return res.body.externalProviderSessionToken;
}

/**
 * Turn Link's publicToken into a durable Exchange resource.
 * @returns {string} exchange URL
 */
export async function createExchange(customerUrl, publicToken) {
  const res = await dwolla.post(`${customerUrl}/exchanges`, {
    _links: { "exchange-partner": { href: await getPlaidPartnerHref() } },
    plaid: { publicToken },
  });
  return res.headers.get("location");
}

/**
 * Create a funding source from an Exchange. Comes back already verified —
 * Dwolla fires customer_funding_source_added and _verified on success, so
 * there's no micro-deposit step.
 * @returns {string} funding source URL
 */
export async function addBankViaExchange(customerUrl, exchangeUrl, { bankAccountType = "checking", name = "Bank" } = {}) {
  const res = await dwolla.post(`${customerUrl}/funding-sources`, {
    _links: { exchange: { href: exchangeUrl } },
    bankAccountType,
    name,
  });
  return res.headers.get("location");
}
