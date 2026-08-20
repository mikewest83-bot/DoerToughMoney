// server/plaid/sync.js
// Pull accounts + transactions from Plaid and reconcile them into our own
// tables. Plaid access tokens are encrypted at rest and decrypted only in
// memory immediately before a Plaid API call.
import { plaid, dollarsToCents } from "./client.js";
import { decryptPlaidToken, encryptPlaidToken, isEncryptedPlaidToken } from "./tokenCrypto.js";

async function plaintextTokenForPlaid(prisma, plaidItem) {
  const plaintext = decryptPlaidToken(plaidItem.accessToken);

  // One-time migration for legacy sandbox/early records that were stored
  // before token encryption was introduced. Re-encrypt as soon as the item
  // is successfully used.
  if (!isEncryptedPlaidToken(plaidItem.accessToken)) {
    const encrypted = encryptPlaidToken(plaintext);
    await prisma.plaidItem.update({
      where: { id: plaidItem.id },
      data: { accessToken: encrypted },
    });
  }

  return plaintext;
}

/** Upsert every account on this Item from Plaid's current balances. */
export async function syncAccounts(prisma, plaidItem) {
  const accessToken = await plaintextTokenForPlaid(prisma, plaidItem);
  const res = await plaid.accountsBalanceGet({ access_token: accessToken });

  for (const a of res.data.accounts) {
    await prisma.account.upsert({
      where: { plaidAccountId: a.account_id },
      create: {
        userId: plaidItem.userId,
        plaidItemId: plaidItem.id,
        plaidAccountId: a.account_id,
        name: a.name,
        officialName: a.official_name || null,
        mask: a.mask || null,
        type: a.type,
        subtype: a.subtype || null,
        currentBalanceCents: a.balances.current != null ? dollarsToCents(a.balances.current) : null,
        availableBalanceCents: a.balances.available != null ? dollarsToCents(a.balances.available) : null,
        isoCurrencyCode: a.balances.iso_currency_code || "USD",
      },
      update: {
        name: a.name,
        officialName: a.official_name || null,
        mask: a.mask || null,
        currentBalanceCents: a.balances.current != null ? dollarsToCents(a.balances.current) : null,
        availableBalanceCents: a.balances.available != null ? dollarsToCents(a.balances.available) : null,
      },
    });
  }
  return res.data.accounts.length;
}

/** Pull whatever changed since this Item's stored cursor. */
export async function syncTransactions(prisma, plaidItem) {
  const accessToken = await plaintextTokenForPlaid(prisma, plaidItem);

  let cursor = plaidItem.transactionsCursor || undefined;
  let added = 0, modified = 0, removed = 0, hasMore = true;

  const accounts = await prisma.account.findMany({ where: { plaidItemId: plaidItem.id } });
  const accountIdByPlaidId = new Map(accounts.map((a) => [a.plaidAccountId, a.id]));

  while (hasMore) {
    const res = await plaid.transactionsSync({ access_token: accessToken, cursor });

    for (const t of [...res.data.added, ...res.data.modified]) {
      const accountId = accountIdByPlaidId.get(t.account_id);
      if (!accountId) continue;

      await prisma.transaction.upsert({
        where: { plaidTransactionId: t.transaction_id },
        create: {
          userId: plaidItem.userId,
          accountId,
          plaidTransactionId: t.transaction_id,
          amountCents: dollarsToCents(t.amount),
          isoCurrencyCode: t.iso_currency_code || "USD",
          date: new Date(t.date),
          name: t.name,
          merchantName: t.merchant_name || null,
          category: t.personal_finance_category?.primary || t.category?.[0] || null,
          pending: t.pending,
        },
        update: {
          amountCents: dollarsToCents(t.amount),
          date: new Date(t.date),
          name: t.name,
          merchantName: t.merchant_name || null,
          category: t.personal_finance_category?.primary || t.category?.[0] || null,
          pending: t.pending,
        },
      });
    }

    added += res.data.added.length;
    modified += res.data.modified.length;

    if (res.data.removed.length) {
      await prisma.transaction.deleteMany({
        where: {
          plaidTransactionId: {
            in: res.data.removed.map((t) => t.transaction_id),
          },
        },
      });
      removed += res.data.removed.length;
    }

    cursor = res.data.next_cursor;
    hasMore = res.data.has_more;
  }

  await prisma.plaidItem.update({
    where: { id: plaidItem.id },
    data: { transactionsCursor: cursor },
  });

  return { added, modified, removed };
}

/** Full sync for one Item: accounts first, then transactions. */
export async function syncItem(prisma, plaidItem) {
  await syncAccounts(prisma, plaidItem);
  return syncTransactions(prisma, plaidItem);
}

/** Sync every active Item for a user. */
export async function syncAllForUser(prisma, userId) {
  const items = await prisma.plaidItem.findMany({
    where: { userId, status: "ACTIVE" },
  });

  const results = [];
  for (const item of items) {
    try {
      results.push({
        plaidItemId: item.id,
        ...(await syncItem(prisma, item)),
      });
    } catch (e) {
      console.error(
        `[plaid] sync failed for item ${item.id}:`,
        e?.response?.data || e.message
      );
      results.push({ plaidItemId: item.id, error: true });
    }
  }
  return results;
}
