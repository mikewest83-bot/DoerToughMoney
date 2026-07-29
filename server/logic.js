// Pure, dependency-free logic for the money paths.
// No Prisma, no Express — so it's unit-testable without a database.

export const toCents = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
};

export const dollars = (cents) => cents / 100;

// Validate a user-supplied amount. Returns { ok, cents } or { ok:false, error }.
export const validateAmount = (amount) => {
  const cents = toCents(amount);
  if (!Number.isFinite(cents) || cents <= 0)
    return { ok: false, error: "Enter an amount above $0." };
  if (cents > 1000000) return { ok: false, error: "The maximum transaction is $10,000." };
  return { ok: true, cents };
};

// Normalize a handle to a leading "@". Empty stays empty.
export const cleanHandle = (handle) => {
  const h = String(handle || "").trim();
  if (!h) return "";
  return h.startsWith("@") ? h : "@" + h;
};

// The overdraw guard, as a pure predicate. (The ledger also enforces this
// atomically in SQL; this mirrors the same rule for tests and early checks.)
export const canCover = (balanceCents, cents) => balanceCents >= cents;

// Direction of a feed row from the viewer's perspective.
export const txnDirection = (t, me) => {
  if (t.kind === "topup") return "in";
  if (t.kind === "payout") return "out";
  if (t.kind === "request") return t.toUserId === me ? "requested" : "request_due";
  return t.toUserId === me ? "in" : "out";
};

// Shape a stored transaction row into the client feed item.
export const shapeTxn = (t, me) => {
  const dir = txnDirection(t, me);
  const other = t.fromUserId === me ? t.toUser : t.fromUser;
  return {
    id: t.id, dir, kind: t.kind, status: t.status,
    who: other?.name || "even", handle: other?.handle || "",
    amount: dollars(t.amountCents), note: t.note, at: t.createdAt,
  };
};

// What the idempotency middleware should do given a possibly-existing key row.
export const idempotencyDecision = (existing) => {
  if (!existing) return { action: "proceed" };
  if (existing.status === 0)
    return { action: "conflict", status: 409, body: { error: "That request is already being processed." } };
  return { action: "replay", status: existing.status, body: existing.response };
};

// Platform fee for a payment, in integer cents. bps = basis points (150 = 1.5%).
// Fee = round(cents * bps / 10000) + flatCents, clamped to [0, capCents].
export const computeFee = (cents, { bps = 0, flatCents = 0, capCents = Infinity } = {}) => {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  const pct = Math.round((cents * bps) / 10000);
  let fee = pct + flatCents;
  if (fee < 0) fee = 0;
  if (Number.isFinite(capCents)) fee = Math.min(fee, capCents);
  return fee;
};

// A payment link with a fixed amount ignores any amount the payer submits.
// An open link (amountCents = null) requires the payer to pass a valid amount.
export const resolveLinkAmount = (link, submittedAmount) => {
  if (link.amountCents != null) return { ok: true, cents: link.amountCents };
  const cents = toCents(submittedAmount);
  if (!Number.isFinite(cents) || cents <= 0) return { ok: false, error: "Enter an amount above $0." };
  if (cents > 1000000) return { ok: false, error: "The maximum is $10,000." };
  return { ok: true, cents };
};

// Public URL for a link, given the app's origin.
export const linkUrl = (origin, slug) => `${String(origin).replace(/\/$/, "")}/pay/${slug}`;
