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
  topup: (b) => req("/api/topup", { method: "POST", body: b, idempotent: true }),
  bankLink: () => req("/api/bank/link", { method: "POST" }),
  cashout: (b) => req("/api/cashout", { method: "POST", body: b, idempotent: true }),
  createLink: (b) => req("/api/links", { method: "POST", body: b }),
  listLinks: () => req("/api/links"),
  getLink: (slug) => req(`/api/links/${encodeURIComponent(slug)}`),
  linkCheckout: (slug, b) => req(`/api/links/${encodeURIComponent(slug)}/checkout`, { method: "POST", body: b }),
};
