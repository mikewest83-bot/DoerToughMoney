import Stripe from "stripe";
import {
  setStripeAccount,
  getUserById,
  processTopupEvent,
  processPayoutEvent,
  processLinkPayment,
} from "./db.js";

const WEB = process.env.WEB_ORIGIN || "http://localhost:5173";
let stripeClient;

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required");
  stripeClient ||= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export async function ensureConnectedAccount(user) {
  if (user.stripeAccountId) return user.stripeAccountId;
  const account = await stripe().accounts.create(
    {
      type: "express",
      email: user.email,
      capabilities: { transfers: { requested: true } },
      metadata: { userId: user.id },
    },
    { idempotencyKey: `acct-${user.id}` }
  );
  await setStripeAccount(user.id, account.id);
  return account.id;
}

export async function onboardingLink(user) {
  const acct = await ensureConnectedAccount(user);
  const link = await stripe().accountLinks.create({
    account: acct,
    refresh_url: `${WEB}/bank?refresh=1`,
    return_url: `${WEB}/bank?done=1`,
    type: "account_onboarding",
  });
  return link.url;
}

export async function topupCheckout(user, cents, idem) {
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      success_url: `${WEB}/?topup=success`,
      cancel_url: `${WEB}/?topup=cancel`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: cents,
          product_data: { name: "Add funds to even balance" },
        },
      }],
      metadata: { userId: user.id, cents: String(cents) },
      payment_intent_data: { metadata: { userId: user.id, cents: String(cents) } },
    },
    idem ? { idempotencyKey: `topup-${idem}` } : undefined
  );
  return session.url;
}


// Hosted Checkout for a pay-me link. Anyone can pay — no account needed.
export async function linkCheckout({ link, payeeId, cents, note, feeCents }) {
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    success_url: `${WEB}/pay/${link.slug}?done=1`,
    cancel_url: `${WEB}/pay/${link.slug}?canceled=1`,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: cents,
        product_data: { name: note ? `even • ${note}` : "even payment" },
      },
    }],
    metadata: { kind: "link", linkId: link.id, payeeId, cents: String(cents), feeCents: String(feeCents || 0), note: note || "" },
    payment_intent_data: {
      metadata: { kind: "link", linkId: link.id, payeeId, cents: String(cents), feeCents: String(feeCents || 0) },
    },
  });
  return session.url;
}

// Returns provider IDs so the ledger row can be reconciled by webhooks.
export async function cashOut(user, cents, idem, transactionId) {
  if (!user.stripeAccountId) throw new Error("NO_BANK");

  const transfer = await stripe().transfers.create(
    {
      amount: cents,
      currency: "usd",
      destination: user.stripeAccountId,
      metadata: { userId: user.id, transactionId },
    },
    idem ? { idempotencyKey: `xfer-${idem}` } : undefined
  );

  try {
    const payout = await stripe().payouts.create(
      {
        amount: cents,
        currency: "usd",
        metadata: { userId: user.id, transactionId, transferId: transfer.id },
      },
      { stripeAccount: user.stripeAccountId, ...(idem ? { idempotencyKey: `payout-${idem}` } : {}) }
    );
    return { transferId: transfer.id, payoutId: payout.id };
  } catch (error) {
    // Return platform funds when payout creation fails after a successful transfer.
    await stripe().transfers.createReversal(transfer.id, {}, idem ? { idempotencyKey: `reverse-${idem}` } : undefined)
      .catch(() => {});
    throw error;
  }
}

export async function handleWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is required");
    event = stripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature failed: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const paid = s.payment_status === "paid";
    const cents = Number.parseInt(s.metadata?.cents || "0", 10);

    if (paid && s.metadata?.kind === "link") {
      const payeeId = s.metadata.payeeId;
      const feeCents = Number.parseInt(s.metadata?.feeCents || "0", 10);
      if (payeeId && cents > 0 && (await getUserById(payeeId))) {
        await processLinkPayment({ eventId: event.id, sessionId: s.id, payeeId, cents, feeCents, note: s.metadata?.note });
      }
    } else if (paid) {
      const userId = s.metadata?.userId;
      if (userId && cents > 0 && (await getUserById(userId))) {
        await processTopupEvent({ eventId: event.id, sessionId: s.id, userId, cents });
      }
    }
  }

  if (["payout.paid", "payout.failed", "payout.canceled"].includes(event.type)) {
    const transactionId = event.data.object.metadata?.transactionId;
    if (transactionId) await processPayoutEvent({ eventId: event.id, type: event.type, transactionId });
  }

  res.json({ received: true });
}

export default stripe;
