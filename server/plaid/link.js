// plaid/link.js
// The two-hop Plaid Link flow: mint a Link token for the browser, then trade
// whatever Link hands back (a public_token) for a durable access_token.
import { Products, CountryCode } from "plaid";
import { plaid } from "./client.js";

/**
 * Start a Link session for this user.
 * @param userId   even's own user id — becomes Plaid's client_user_id
 * @param webhookUrl  where Plaid should POST item/transaction webhooks
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
 * Trade Link's public_token for a durable access_token, and look up which
 * institution the user connected (for display — "Chase", "Ally", ...).
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
    // Non-fatal — the Item is already linked either way, we just lose the
    // display name until the next sync fills it in.
  }

  return { accessToken, plaidItemId, institutionId, institutionName };
}

/** Remove a Plaid Item's connection (both on Plaid's side and stops future syncs). */
export async function removeItem(accessToken) {
  await plaid.itemRemove({ access_token: accessToken });
}
