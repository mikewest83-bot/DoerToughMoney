// dwolla/fundingSources.js
// The manual fallback for attaching a bank: the user types their routing and
// account number, then confirms two micro-deposits Dwolla sends 1-2 business
// days later (instant in sandbox). Slow, but it works for banks Open Banking
// can't reach.
//
// The fast path lives in openBanking.js — Instant Account Verification, where
// the user logs into their bank and the funding source is verified on creation.
import { dwolla } from "./client.js";

/**
 * @param customerUrl  the Verified Customer's resource URL
 * @param routingNumber  9-digit ABA routing number
 * @param accountNumber  bank account number
 * @param bankAccountType  "checking" | "savings"
 * @param name  display name, e.g. "Primary Checking"
 * @returns {string} funding source URL (persist on the User) — unverified until
 *          initiateMicroDeposits + verifyMicroDeposits complete.
 */
export async function addBankManual(customerUrl, { routingNumber, accountNumber, bankAccountType, name = "Bank" }) {
  const res = await dwolla.post(`${customerUrl}/funding-sources`, {
    routingNumber,
    accountNumber,
    bankAccountType,
    name,
  });
  return res.headers.get("location");
}

/** Kick off micro-deposits to a freshly-added, unverified funding source. */
export async function initiateMicroDeposits(fundingSourceUrl) {
  await dwolla.post(`${fundingSourceUrl}/micro-deposits`);
}

/**
 * Confirm the two micro-deposit amounts the user saw on their bank statement.
 * @param amount1cents, amount2cents  integer cents, e.g. 3 and 9 for $0.03/$0.09
 * @throws if the amounts don't match — Dwolla allows a few attempts before locking.
 */
export async function verifyMicroDeposits(fundingSourceUrl, amount1cents, amount2cents) {
  await dwolla.post(`${fundingSourceUrl}/micro-deposits`, {
    amount1: { value: (amount1cents / 100).toFixed(2), currency: "USD" },
    amount2: { value: (amount2cents / 100).toFixed(2), currency: "USD" },
  });
}

/** List a customer's funding sources (to find/verify their bank). */
export async function listFundingSources(customerUrl) {
  const res = await dwolla.get(`${customerUrl}/funding-sources`);
  return res.body._embedded["funding-sources"];
}

/**
 * Processing channels a funding source supports, e.g. ["ach"] or
 * ["ach","real-time-payments"]. Presence of real-time-payments means the
 * account can receive Instant Payments; without it, Same Day ACH is the
 * fastest available payout. Returns ["ach"] if Dwolla omits the field.
 */
export async function getFundingSourceChannels(fundingSourceUrl) {
  const res = await dwolla.get(fundingSourceUrl);
  return res.body.channels?.length ? res.body.channels : ["ach"];
}

export const supportsInstant = (channels = []) => channels.includes("real-time-payments");

/** Soft-remove a funding source. */
export async function removeFundingSource(fundingSourceUrl) {
  await dwolla.post(fundingSourceUrl, { removed: true });
}
