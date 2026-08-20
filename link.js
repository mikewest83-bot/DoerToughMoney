// server/plaid/link.js
// The two-hop Plaid Link flow: mint a Link token for the browser, then trade
// the public_token for a durable access_token. The durable token is encrypted
// before this module returns it so callers never persist it in plaintext.
import { Products, CountryCode } from "plaid";
import { plaid } from "./client.js";
import { encryptPlaidToken, decryptPlaidToken } from "./tokenCrypto.js";

/**
 * Start a Link session for this user.
 * @param userId DoerToughMoney user id — becomes Plaid's client_user_id
 * @param webhookUrl where Plaid should POST item/transaction webhooks
 * @returns {string} link_token the browser hands to Plaid Link
 */
export async function createLinkToken(userId, webhookUrl) {
  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "DoerToughMoney",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: webhookUrl || undefined,
  });
  return res.data.link_token;
}

/**
 * Trade Link's public_token for a durable access_token, look up the institution,
 * and encrypt the durable token before returning it to the caller.
 *
 * @returns {{ accessToken, plaidItemId, institutionId, institutionName }}
 */
export async function exchangePublicToken(publicToken) {
  const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const { access_token: accessToken, item_id: plaidItemId } = exchange.data;

  let institutionId = null;
  let institutionName = null;
  try {
    const item = await plaid.itemGet({ access_token: accessToken });
    institutionId = item.data.item.institution_id || null;
    if (institutionId) {
      const inst = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = inst.data.institution.name;
    }
  } catch {
    // Non-fatal — the Item is already linked either way.
  }

  return {
    accessToken: encryptPlaidToken(accessToken),
    plaidItemId,
    institutionId,
    institutionName,
  };
}

/** Remove a Plaid Item's connection. Accepts either encrypted or legacy plaintext. */
export async function removeItem(accessToken) {
  await plaid.itemRemove({ access_token: decryptPlaidToken(accessToken) });
}
