// Diagnostic: report which processing channels each user's linked bank supports.
// "real-time-payments" in the channels array means the account can receive
// Instant Payments (RTP/FedNow); otherwise the fastest option is Same Day ACH.
//   railway run -- node scripts/check-funding-channels.js   (Dwolla-only, no DB)
import { dwolla } from "../dwolla/index.js";

const customers = await dwolla.get("customers", { limit: 25 });
for (const c of customers.body._embedded?.customers ?? []) {
  const fs = await dwolla.get(`${c._links.self.href}/funding-sources`);
  for (const s of fs.body._embedded?.["funding-sources"] ?? []) {
    if (s.type === "balance") continue;
    console.log(
      `${(c.firstName + " " + c.lastName).padEnd(20)} ${String(s.name).padEnd(20)} ` +
      `status=${String(s.status).padEnd(10)} channels=${JSON.stringify(s.channels ?? [])}`
    );
  }
}
