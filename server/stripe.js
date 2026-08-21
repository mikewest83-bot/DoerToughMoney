// stripe.js
// DoerToughMoney's subscription billing — Stripe Checkout + Customer Portal
// for the paid tier. Card billing only, same boundary as everywhere else in
// this app: Stripe here never moves money between users, only between a user
// and DoerToughMoney itself.
import Stripe from "stripe";
import prisma from "./db.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
// The monthly Pro price's Stripe Price ID (price_...), created in the Stripe
// dashboard — the actual dollar amount lives in Stripe, not here.
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

// Pinned rather than left to the account's dashboard default: Stripe's
// "2025-03-31" API version moved current_period_end off the subscription
// object and onto each subscription item, which would silently break
// syncSubscriptionFromStripe below. This version keeps the shape this file
// is written against, regardless of what the dashboard default drifts to.
const STRIPE_API_VERSION = "2024-06-20";

let stripeClient = null;
function stripe() {
  if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!stripeClient) stripeClient = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
  return stripeClient;
}

// Checkout/portal need both a secret key and a price to sell; the webhook
// only needs the secret key + its own signing secret (checked separately by
// the route itself, since a misconfigured webhook shouldn't block checkout).
export const stripeConfigured = () => !!(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);

// A Stripe Customer is created lazily on first checkout rather than at
// signup — most users never subscribe, so most users never need one.
async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
  });
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/**
 * @param {object} user  req.user (needs id, email, name, stripeCustomerId)
 * @param {{successUrl: string, cancelUrl: string}} urls
 * @returns {Promise<string>} the Stripe-hosted Checkout URL to redirect to
 */
export async function createCheckoutSession(user, { successUrl, cancelUrl }) {
  if (!stripeConfigured()) throw new Error("Billing isn't configured yet.");
  const customerId = await ensureCustomer(user);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: user.id,
    // Belt-and-suspenders: syncSubscriptionFromStripe looks the user up by
    // this metadata first and only falls back to matching on customer id.
    subscription_data: { metadata: { userId: user.id } },
    allow_promotion_codes: true,
  });
  return session.url;
}

/**
 * @param {object} user  req.user (needs stripeCustomerId)
 * @param {{returnUrl: string}} urls
 * @returns {Promise<string>} the Stripe-hosted billing portal URL
 */
export async function createPortalSession(user, { returnUrl }) {
  if (!STRIPE_SECRET_KEY) throw new Error("Billing isn't configured yet.");
  if (!user.stripeCustomerId) throw new Error("No billing account yet — subscribe first.");
  const session = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}

// Collapses Stripe's own subscription statuses down to what the app branches
// on. PAST_DUE deliberately keeps paid-tier access — Stripe is mid-retry, not
// yet given up on the card — only CANCELED (or never having subscribed)
// locks it back to free.
function mapStatus(stripeStatus) {
  switch (stripeStatus) {
    case "trialing": return "TRIALING";
    case "active": return "ACTIVE";
    case "past_due":
    case "unpaid": return "PAST_DUE";
    case "canceled":
    case "incomplete_expired": return "CANCELED";
    default: return "NONE"; // "incomplete" (first payment never completed) etc.
  }
}
const ENTITLED = new Set(["TRIALING", "ACTIVE"]);

// The single source of truth this whole module writes through — every
// webhook branch below funnels into this, so the User row always reflects
// whatever Stripe just told us, however we heard it.
async function syncSubscriptionFromStripe(subscription) {
  let userId = subscription.metadata?.userId;
  if (!userId) {
    const match = await prisma.user.findUnique({
      where: { stripeCustomerId: subscription.customer },
      select: { id: true },
    });
    userId = match?.id;
  }
  if (!userId) {
    console.warn(`[stripe] subscription ${subscription.id} (customer ${subscription.customer}) has no matching DoerToughMoney user — skipping.`);
    return;
  }

  const status = mapStatus(subscription.status);
  // Stripe API versions 2025-03-31+ moved current_period_end off the
  // Subscription object and onto each SubscriptionItem. Outbound calls made
  // by this file's own Stripe client are pinned to STRIPE_API_VERSION
  // (2024-06-20, top-level field still present), but incoming webhook
  // events are rendered by Stripe at whatever API version the *endpoint*
  // itself is configured for in the dashboard — which can be newer and so
  // lack the top-level field entirely. Fall back to the first subscription
  // item's current_period_end so this doesn't silently write null for
  // every subscription synced purely via webhook.
  const periodEndRaw =
    subscription.current_period_end ??
    subscription.items?.data?.[0]?.current_period_end ??
    null;
  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: status,
      subscriptionTier: ENTITLED.has(status) ? "pro" : null,
      currentPeriodEnd: periodEndRaw ? new Date(periodEndRaw * 1000) : null,
    },
  });
}

export async function handleWebhookEvent(event) {
  switch (event.type) {
    // Checkout succeeded — fetch the real subscription rather than trusting
    // the session payload, since that's the object every later webhook will
    // also be syncing from.
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription" && session.subscription) {
        const subscription = await stripe().subscriptions.retrieve(session.subscription);
        await syncSubscriptionFromStripe(subscription);
      }
      break;
    }
    // Covers renewals, plan changes, cancellations (immediate or
    // end-of-period), and payment-failure status flips — Stripe sends
    // .updated for all of these, so one handler covers the whole lifecycle.
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscriptionFromStripe(event.data.object);
      break;
    default:
      break; // plenty of Stripe events exist that this app doesn't act on
  }
}

/**
 * Express route handler. Requires the RAW request body — server.js must
 * mount this with express.raw({ type: "application/json" }) BEFORE the
 * global express.json() middleware, or Stripe's signature check will fail
 * on every event (this is a different requirement than the Plaid webhook,
 * which reuses express.json()'s own byte buffer).
 */
export function stripeWebhook() {
  return async (req, res) => {
    if (!STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "Webhook isn't configured." });
    const signature = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe().webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error("[stripe] webhook signature verification failed:", e.message);
      return res.status(400).json({ error: `Webhook signature verification failed: ${e.message}` });
    }
    try {
      await handleWebhookEvent(event);
    } catch (e) {
      // Still ack with 200 below — Stripe retries non-2xx responses for
      // hours, and a transient DB error here shouldn't trigger a retry
      // storm. Subscription state gets another chance to converge on the
      // next real event (renewal, or Stripe's own automatic retries).
      console.error(`[stripe] error handling ${event.type}:`, e);
    }
    res.json({ received: true });
  };
}
