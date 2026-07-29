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
  me: () => req("/api/me"),
  config: () => req("/api/config"),
  feed: () => req("/api/feed"),
  users: (q) => req(`/api/users?q=${encodeURIComponent(q || "")}`),
  pay: (b) => req("/api/pay", { method: "POST", body: b, idempotent: true }),
  request: (b) => req("/api/request", { method: "POST", body: b, idempotent: true }),
  verifyIdentity: (b) => req("/api/verify-identity", { method: "POST", body: b }),
  fileDispute: (b) => req("/api/disputes", { method: "POST", body: b, idempotent: true }),
  disputes: () => req("/api/disputes"),
  bankLink: (b) => req("/api/bank/link", { method: "POST", body: b }),
  bankVerify: (b) => req("/api/bank/verify", { method: "POST", body: b }),
};
