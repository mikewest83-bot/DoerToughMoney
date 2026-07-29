// One-off admin script: create the Dwolla webhook subscription pointing at
// this app's /webhooks/dwolla endpoint, using DWOLLA_WEBHOOK_SECRET as the
// signing secret. Idempotent — skips creation if a subscription for the URL
// already exists. Run with the app's env vars, e.g.:
//   railway run --service even-app -- node scripts/create-webhook-subscription.js
import { dwolla } from "../dwolla/index.js";

const WEBHOOK_URL =
  process.env.WEBHOOK_URL || "https://even-app-production.up.railway.app/webhooks/dwolla";
const SECRET = process.env.DWOLLA_WEBHOOK_SECRET;

if (!SECRET) {
  console.error("DWOLLA_WEBHOOK_SECRET is not set — aborting.");
  process.exit(1);
}

const existing = await dwolla.get("webhook-subscriptions");
const subs = existing.body._embedded?.["webhook-subscriptions"] ?? [];
const match = subs.find((s) => s.url === WEBHOOK_URL);

if (match) {
  console.log(`Already subscribed: ${match.url} (paused: ${match.paused}, id: ${match.id})`);
  if (match.paused) {
    await dwolla.post(`webhook-subscriptions/${match.id}`, { paused: false });
    console.log("Unpaused it.");
  }
  process.exit(0);
}

const res = await dwolla.post("webhook-subscriptions", { url: WEBHOOK_URL, secret: SECRET });
console.log(`Created webhook subscription: ${res.headers.get("location")}`);
