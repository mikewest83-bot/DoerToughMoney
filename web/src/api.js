// Empty base = same-origin (API serves the web build on Replit).
// Local dev sets VITE_API_URL=http://localhost:4000 in web/.env.
const BASE = import.meta.env.VITE_API_URL || "";

let token = localStorage.getItem("even_token") || null;

export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem("even_token", t);
  else localStorage.removeItem("even_token");
};
export const hasToken = () => !!token;

const newIdemKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

async function req(path, { method = "GET", body, idempotent = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Safe-to-retry actions carry a key so a retry never double-creates.
      ...(idempotent ? { "Idempotency-Key": newIdemKey() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export const api = {
  register: (b) => req("/api/register", { method: "POST", body: b }),
  login: (b) => req("/api/login", { method: "POST", body: b }),
  googleAuth: (idToken) => req("/api/auth/google", { method: "POST", body: { idToken } }),
  registerWithGoogle: (b) => req("/api/register/google", { method: "POST", body: b }),
  passkeyCredentials: () => req("/api/webauthn/credentials"),
  passkeyRegOptions: () => req("/api/webauthn/register/options", { method: "POST" }),
  passkeyRegVerify: (b) => req("/api/webauthn/register/verify", { method: "POST", body: b }),
  passkeyLoginOptions: () => req("/api/webauthn/login/options", { method: "POST" }),
  passkeyLoginVerify: (b) => req("/api/webauthn/login/verify", { method: "POST", body: b }),
  me: () => req("/api/me"),
  config: () => req("/api/config"),
  users: (q) => req(`/api/users?q=${encodeURIComponent(q || "")}`),

  // ── linked banks (Plaid) ──
  plaidLinkToken: () => req("/api/plaid/link-token", { method: "POST" }),
  // Idempotent: retrying an interrupted Link flow must not create a duplicate PlaidItem.
  plaidExchange: (publicToken) => req("/api/plaid/exchange", { method: "POST", body: { publicToken }, idempotent: true }),
  plaidItems: () => req("/api/plaid/items"),
  plaidRemoveItem: (id) => req(`/api/plaid/items/${encodeURIComponent(id)}`, { method: "DELETE" }),
  plaidSync: () => req("/api/plaid/sync", { method: "POST" }),

  // ── accounts / transactions ──
  accounts: () => req("/api/accounts"),
  transactions: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.category) qs.set("category", params.category);
    if (params.limit) qs.set("limit", params.limit);
    const s = qs.toString();
    return req(`/api/transactions${s ? `?${s}` : ""}`);
  },
  updateTransaction: (id, b) => req(`/api/transactions/${encodeURIComponent(id)}`, { method: "PATCH", body: b }),

  // ── bills ──
  bills: () => req("/api/bills"),
  createBill: (b) => req("/api/bills", { method: "POST", body: b }),
  updateBill: (id, b) => req(`/api/bills/${encodeURIComponent(id)}`, { method: "PATCH", body: b }),
  deleteBill: (id) => req(`/api/bills/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ── budgets ──
  budgets: () => req("/api/budgets"),
  upsertBudget: (b) => req("/api/budgets", { method: "POST", body: b }),
  deleteBudget: (id) => req(`/api/budgets/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ── goals ──
  goals: () => req("/api/goals"),
  createGoal: (b) => req("/api/goals", { method: "POST", body: b }),
  updateGoal: (id, b) => req(`/api/goals/${encodeURIComponent(id)}`, { method: "PATCH", body: b }),
  deleteGoal: (id) => req(`/api/goals/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ── insights ──
  insights: () => req("/api/insights"),

  // ── DealTough (savings / negotiation AI) ──
  dealtoughAnalyze: (b) => req("/api/dealtough/analyze", { method: "POST", body: b }),

  // ── shared expenses ──
  groups: () => req("/api/groups"),
  group: (id) => req(`/api/groups/${encodeURIComponent(id)}`),
  createGroup: (b) => req("/api/groups", { method: "POST", body: b }),
  addGroupMember: (id, b) => req(`/api/groups/${encodeURIComponent(id)}/members`, { method: "POST", body: b }),
  removeGroupMember: (id, memberId) => req(`/api/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" }),
  // Idempotent: a duplicate expense corrupts every balance in the group, so a
  // double-tap or retry must not create two.
  addExpense: (id, b) => req(`/api/groups/${encodeURIComponent(id)}/expenses`, { method: "POST", body: b, idempotent: true }),
  deleteExpense: (id, expenseId) => req(`/api/groups/${encodeURIComponent(id)}/expenses/${encodeURIComponent(expenseId)}`, { method: "DELETE" }),
  addRecurring: (id, b) => req(`/api/groups/${encodeURIComponent(id)}/recurring`, { method: "POST", body: b }),
  deleteRecurring: (id, rid) => req(`/api/groups/${encodeURIComponent(id)}/recurring/${encodeURIComponent(rid)}`, { method: "DELETE" }),
  // Records a cash payoff (no transfer). Idempotent so a double-tap can't record it twice.
  settle: (id, b) => req(`/api/groups/${encodeURIComponent(id)}/settle`, { method: "POST", body: b, idempotent: true }),
  quickSplit: (b) => req("/api/split", { method: "POST", body: b, idempotent: true }),
  remind: (id, b) => req(`/api/groups/${encodeURIComponent(id)}/remind`, { method: "POST", body: b }),
  reminders: () => req("/api/reminders"),
  dismissReminder: (id) => req(`/api/reminders/${encodeURIComponent(id)}/seen`, { method: "POST" }),
};
