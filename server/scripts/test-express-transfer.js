// Sandbox probe: confirm Dwolla accepts the EXPRESS payloads before we offer
// the paid upgrade to anyone. Checks both branches — Instant Payments to an
// RTP-eligible bank, and Same Day ACH to one that only supports plain ACH.
//   railway run -- node scripts/test-express-transfer.js
import { dwolla, createTransfer, getFundingSourceChannels, supportsInstant } from "../dwolla/index.js";

const customers = (await dwolla.get("customers", { limit: 25 })).body._embedded?.customers ?? [];
const banks = [];
for (const c of customers) {
  const fs = (await dwolla.get(`${c._links.self.href}/funding-sources`)).body._embedded?.["funding-sources"] ?? [];
  for (const s of fs) {
    if (s.type === "balance" || s.status !== "verified") continue;
    banks.push({ who: `${c.firstName} ${c.lastName}`, url: s._links.self.href, channels: await getFundingSourceChannels(s._links.self.href) });
  }
}

const instantBank = banks.find((b) => supportsInstant(b.channels));
const achOnlyBank = banks.find((b) => !supportsInstant(b.channels));
console.log("RTP-eligible:", instantBank?.who ?? "none", "| ACH-only:", achOnlyBank?.who ?? "none");

async function attempt(label, opts) {
  try {
    const r = await createTransfer(opts);
    console.log(`PASS  ${label} -> ${r.dwollaTransferId} (instant=${r.usedInstant})`);
  } catch (e) {
    const detail = e?.body?._embedded?.errors?.map((x) => `${x.code}:${x.path} ${x.message}`).join("; ") || e?.body?.message || e.message;
    console.log(`FAIL  ${label} -> ${detail}`);
  }
}

if (instantBank && achOnlyBank) {
  // Instant path: Same Day ACH pull + RTP payout.
  await attempt("EXPRESS to RTP-eligible bank", {
    sourceFundingSourceUrl: achOnlyBank.url,
    destinationFundingSourceUrl: instantBank.url,
    amountCents: 100, speed: "EXPRESS", destinationSupportsInstant: true,
  });
  // Same Day path: Same Day ACH on both legs.
  await attempt("EXPRESS to ACH-only bank", {
    sourceFundingSourceUrl: instantBank.url,
    destinationFundingSourceUrl: achOnlyBank.url,
    amountCents: 100, speed: "EXPRESS", destinationSupportsInstant: false,
  });
  // With a facilitator fee attached, since that's how it runs in production.
  await attempt("EXPRESS + fee", {
    sourceFundingSourceUrl: instantBank.url,
    destinationFundingSourceUrl: achOnlyBank.url,
    amountCents: 2000, feeCents: 35,
    feeChargeToCustomerUrl: customers.find((c) => `${c.firstName} ${c.lastName}` === instantBank.who)._links.self.href,
    speed: "EXPRESS", destinationSupportsInstant: false,
  });
} else {
  console.log("Need one RTP-eligible and one ACH-only verified bank to test both paths.");
}
