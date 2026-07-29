// plaid/link.js
// The two server-side halves of Plaid Link, which together replace the 1-2 day
// micro-deposit wait with a ~60 second bank login:
//
//   1. createLinkToken   -> short-lived token the browser hands to Plaid Link
//   2. exchangeForProcessorToken -> public_token from Link becomes a Dwolla-scoped
//      processor token, which Dwolla trades for the account/routing numbers and
//      then discards. The resulting funding source is verified immediately.
//
// We deliberately never persist Plaid's access_token: this flow needs it only
// for the moments between exchange and processor-token creation, and not storing
// it means there's no long-lived bank credential in our database to protect.
import { plaid } from "./client.js";

/**
 * @param user  the even user linking a bank (id is sent as client_user_id)
 * @returns {string} link_token for the browser
 */
export async function createLinkToken(user) {
  const res = await plaid.linkTokenCreate({
    user: { client_user_id: user.id },
    client_name: "even",
    // "auth" is required — it's what lets Dwolla read the account and routing
    // number. US-only because Dwolla can only transact with US bank accounts.
    products: ["auth"],
    country_codes: ["US"],
    language: "en",
    // Only checking/savings can move money over ACH, so don't let someone
    // select a credit card or brokerage account and hit a confusing failure.
    account_filters: {
      depository: { account_subtypes: ["checking", "savings"] },
    },
  });
  return res.data.link_token;
}

/**
 * Trade Link's public_token for a Dwolla processor token.
 * @param publicToken  from Link's onSuccess callback
 * @param accountId    the account the user selected in Link
 * @returns {string} processor_token to pass to Dwolla as plaidToken
 */
export async function exchangeForProcessorToken(publicToken, accountId) {
  const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const res = await plaid.processorTokenCreate({
    access_token: exchange.data.access_token,
    account_id: accountId,
    processor: "dwolla",
  });
  return res.data.processor_token;
}
