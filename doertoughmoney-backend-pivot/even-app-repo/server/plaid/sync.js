// plaid/sync.js
// Pull accounts + transactions from Plaid and reconcile them into our own
// tables. Transactions use Plaid's cursor-based /transactions/sync — each
// call only returns what changed since the stored cursor, so a webhook can
// trigger a cheap incremental sync instead of re-fetching everything.
import { plaid, dollarsToCents } from "./client.js";

/** Upsert every account on this Item from Plaid's current balances. */
export async function syncAccounts(prisma, plaidItem) {
  const res = await plaid.accountsBalanceGet({ access_token: plaidItem.accessToken });

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

/**
 * Pull whatever changed since this Item's stored cursor and apply it:
 * upsert added/modified transactions, delete removed ones, persist the new
 * cursor. Safe to call repeatedly (e.g. from a webhook) — Plaid's cursor
 * makes each call incremental.
 * @returns {{ added: number, modified: number, removed: number }}
 */
export async function syncTransactions(prisma, plaidItem) {
  let cursor = plaidItem.transactionsCursor || undefined;
  let added = 0, modified = 0, removed = 0, hasMore = true;

  // Accounts must exist before transactions can reference them by our own id.
  const accounts = await prisma.account.findMany({ where: { plaidItemId: plaidItem.id } });
  const accountIdByPlaidId = new Map(accounts.map((a) => [a.plaidAccountId, a.id]));

  while (hasMore) {
    const res = await plaid.transactionsSync({ access_token: plaidItem.accessToken, cursor });

    for (const t of [...res.data.added, ...res.data.modified]) {
      const accountId = accountIdByPlaidId.get(t.account_id);
      if (!accountId) continue; // account not synced yet — picked up on the next pass
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
        where: { plaidTransactionId: { in: res.data.removed.map((t) => t.transaction_id) } },
      });
      removed += res.data.removed.length;
    }

    cursor = res.data.next_cursor;
    hasMore = res.data.has_more;
  }

  await prisma.plaidItem.update({ where: { id: plaidItem.id }, data: { transactionsCursor: cursor } });
  return { added, modified, removed };
}

/** Full sync for one Item: accounts first (transactions need the FK), then transactions. */
export async function syncItem(prisma, plaidItem) {
  await syncAccounts(prisma, plaidItem);
  return syncTransactions(prisma, plaidItem);
}

/** Sync every active Item for a user — e.g. on-demand "refresh" in the UI. */
export async function syncAllForUser(prisma, userId) {
  const items = await prisma.plaidItem.findMany({ where: { userId, status: "ACTIVE" } });
  const results = [];
  for (const item of items) {
    try {
      results.push({ plaidItemId: item.id, ...(await syncItem(prisma, item)) });
    } catch (e) {
      console.error(`[plaid] sync failed for item ${item.id}:`, e?.response?.data || e.message);
      results.push({ plaidItemId: item.id, error: true });
    }
  }
  return results;
}
