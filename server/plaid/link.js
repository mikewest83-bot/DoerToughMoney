// server/plaid/link.js
// Plaid Link flow with encrypted access tokens at rest.
//
// Normal Link launch intentionally does NOT send a phone number.
// This keeps DoerToughMoney on Plaid's standard bank-linking flow
// instead of forcing the Returning User phone-number experience.

import { Products, CountryCode } from "plaid";
import { plaid } from "./client.js";
import {
  encryptPlaidToken,
  decryptPlaidToken,
} from "./tokenCrypto.js";

/**
 * Start a Plaid Link session for this user.
 *
 * We intentionally only provide client_user_id here.
 * phone_number is optional in Plaid's Link token request, but supplying it
 * can trigger Plaid's Returning User phone-number flow. For the normal
 * DoerToughMoney bank-linking experience, we want Plaid to collect whatever
 * information it needs directly in Link.
 */
export async function createLinkToken(userId, webhookUrl) {
  if (!userId) {
    throw new Error("Missing user ID for Plaid Link.");
  }

  const user = {
    client_user_id: String(userId),
  };

  const request = {
    user,
    client_name: "DoerToughMoney",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  };

  // Only include the webhook when one is actually configured.
  // This keeps local development and production behavior clean.
  if (webhookUrl) {
    request.webhook = webhookUrl;
  }

  const res = await plaid.linkTokenCreate(request);

  return res.data.link_token;
}

/**
 * Exchange Plaid's temporary public_token for a durable access_token.
 *
 * The access token is encrypted before being stored by the application.
 */
export async function exchangePublicToken(publicToken) {
  if (!publicToken) {
    throw new Error("Missing Plaid public token.");
  }

  const exchange = await plaid.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const {
    access_token: accessToken,
    item_id: plaidItemId,
  } = exchange.data;

  let institutionId = null;
  let institutionName = null;

  try {
    const item = await plaid.itemGet({
      access_token: accessToken,
    });

    institutionId =
      item.data.item.institution_id || null;

    if (institutionId) {
      const inst = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });

      institutionName =
        inst.data.institution.name || null;
    }
  } catch (error) {
    // The Item has already been successfully exchanged.
    // Institution metadata is helpful but not required for the link flow.
    console.warn(
      "[plaid] Could not retrieve institution metadata:",
      error?.response?.data || error?.message || error
    );
  }

  return {
    accessToken: encryptPlaidToken(accessToken),
    plaidItemId,
    institutionId,
    institutionName,
  };
}

/**
 * Remove a Plaid Item.
 *
 * The access token is decrypted only when making the request to Plaid.
 */
export async function removeItem(accessToken) {
  if (!accessToken) {
    throw new Error("Missing Plaid access token.");
  }

  await plaid.itemRemove({
    access_token: decryptPlaidToken(accessToken),
  });
}
