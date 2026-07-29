// Sandbox probe for Instant Account Verification: confirm Dwolla mints an
// exchange session and hands back a usable Plaid Link token. The remaining
// hops (publicToken -> exchange -> funding source) need a real browser to
// complete the bank login, so this verifies the server-side half.
//   railway run -- node scripts/test-open-banking.js
import { dwolla, getPlaidPartnerHref, createExchangeSession, getSessionToken } from "../dwolla/index.js";

console.log("Plaid partner:", await getPlaidPartnerHref());

const customers = (await dwolla.get("customers", { limit: 25 })).body._embedded?.customers ?? [];
const verified = customers.find((c) => c.status === "verified");
if (!verified) {
  console.log("No verified customer to test with.");
  process.exit(0);
}
console.log("Customer:", `${verified.firstName} ${verified.lastName}`);

const sessionUrl = await createExchangeSession(verified._links.self.href);
console.log("Session:", sessionUrl);

const token = await getSessionToken(sessionUrl);
console.log("Link token:", token ? `${token.slice(0, 24)}… (${token.length} chars)` : "MISSING");
console.log(token?.startsWith("link-") ? "PASS — usable Plaid Link token" : "FAIL — unexpected token format");
