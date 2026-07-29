// Diagnostic: list Dwolla's Open Banking exchange partners for this
// environment. The partner href differs between sandbox and production, so it
// must be looked up rather than hardcoded from the docs.
//   railway run -- node scripts/list-exchange-partners.js
import { dwolla } from "../dwolla/index.js";

const res = await dwolla.get("exchange-partners");
for (const p of res.body._embedded?.["exchange-partners"] ?? []) {
  console.log(`${String(p.name).padEnd(12)} status=${String(p.status).padEnd(10)} href=${p._links.self.href}`);
}
