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
      // Safe-to-retry money actions carry a key so a retry never moves money twice.
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
  feed: () => req("/api/feed"),
  users: (q) => req(`/api/users?q=${encodeURIComponent(q || "")}`),
  pay: (b) => req("/api/pay", { method: "POST", body: b, idempotent: true }),
  // b: { handle, amount, note, speed?: "STANDARD" | "EXPRESS" }
  request: (b) => req("/api/request", { method: "POST", body: b, idempotent: true }),
  verifyIdentity: (b) => req("/api/verify-identity", { method: "POST", body: b }),
  fileDispute: (b) => req("/api/disputes", { method: "POST", body: b, idempotent: true }),
  disputes: () => req("/api/disputes"),

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
  // Moves money — idempotent so a double-tap can't settle twice.
  settle: (id, b) => req(`/api/groups/${encodeURIComponent(id)}/settle`, { method: "POST", body: b, idempotent: true }),
  quickSplit: (b) => req("/api/split", { method: "POST", body: b, idempotent: true }),
  remind: (id, b) => req(`/api/groups/${encodeURIComponent(id)}/remind`, { method: "POST", body: b }),
  reminders: () => req("/api/reminders"),
  dismissReminder: (id) => req(`/api/reminders/${encodeURIComponent(id)}/seen`, { method: "POST" }),
  bankLinkStart: () => req("/api/bank/link/start", { method: "POST" }),
  bankLinkComplete: (b) => req("/api/bank/link/complete", { method: "POST", body: b, idempotent: true }),
  bankLink: (b) => req("/api/bank/link", { method: "POST", body: b }),
  bankVerify: (b) => req("/api/bank/verify", { method: "POST", body: b }),
};
