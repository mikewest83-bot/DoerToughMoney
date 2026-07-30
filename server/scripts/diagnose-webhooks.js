// Diagnostic: is Dwolla actually delivering webhooks, and what does it think
// each recent transfer's status is? Compares Dwolla's own view against what it
// has attempted to send us.
//   railway run -- node scripts/diagnose-webhooks.js
import { dwolla } from "../dwolla/index.js";

const subs = (await dwolla.get("webhook-subscriptions")).body._embedded?.["webhook-subscriptions"] ?? [];
console.log(`${subs.length} subscription(s):`);
for (const s of subs) {
  console.log(`  ${s.id} paused=${s.paused} url=${s.url}`);
  try {
    const hooks = (await dwolla.get(`${s._links.self.href}/webhooks`, { limit: 10 })).body;
    const list = hooks._embedded?.webhooks ?? [];
    console.log(`    ${hooks.total ?? list.length} delivery attempt(s)`);
    for (const h of list.slice(0, 10)) {
      const last = h.attempts?.[h.attempts.length - 1];
      const when = last?.request?.timestamp ?? h.created ?? "?";
      console.log(`      ${String(when).slice(0, 19)}  ${String(last?.response?.statusCode ?? "?").padEnd(4)} ${h.topic}`);
    }
  } catch (e) {
    console.log("    (couldn't read delivery attempts:", e?.body?.message || e.message, ")");
  }
}

console.log("\nRecent transfers per Dwolla:");
const customers = (await dwolla.get("customers", { limit: 25 })).body._embedded?.customers ?? [];
for (const c of customers) {
  const ts = (await dwolla.get(`${c._links.self.href}/transfers`, { limit: 6 })).body._embedded?.transfers ?? [];
  for (const t of ts) {
    console.log(`  ${t.id.slice(0, 8)} $${t.amount.value.padStart(7)} status=${t.status} created=${t.created?.slice(0, 19)}`);
  }
  break; // one customer is enough — transfers appear on both sides
}
