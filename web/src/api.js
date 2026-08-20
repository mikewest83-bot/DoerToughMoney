// DoerToughMoney API client.
//
// Production uses a separate Railway web service and API service,
// so the browser must explicitly send API requests to the backend.
//
// Local development can override this with:
// VITE_API_URL=http://localhost:4000

const BASE =
  import.meta.env.VITE_API_URL ||
  "https://doertoughmoney-production.up.railway.app";

let token = localStorage.getItem("doertoughmoney_token") || null;

export const setToken = (t) => {
  token = t;

  if (t) {
    localStorage.setItem("doertoughmoney_token", t);
  } else {
    localStorage.removeItem("doertoughmoney_token");
  }
};

export const hasToken = () => !!token;

const newIdemKey = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

async function req(
  path,
  { method = "GET", body, idempotent = false } = {}
) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",

      ...(token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {}),

      ...(idempotent
        ? {
            "Idempotency-Key": newIdemKey(),
          }
        : {}),
    },

    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error || `Request failed (${res.status})`
    );
  }

  return data;
}

export const api = {
  // ─────────────────────────────────────────────
  // AUTH
  // ─────────────────────────────────────────────

  register: (b) =>
    req("/api/register", {
      method: "POST",
      body: b,
    }),

  login: (b) =>
    req("/api/login", {
      method: "POST",
      body: b,
    }),

  googleAuth: (idToken) =>
    req("/api/auth/google", {
      method: "POST",
      body: { idToken },
    }),

  registerWithGoogle: (b) =>
    req("/api/register/google", {
      method: "POST",
      body: b,
    }),

  // ─────────────────────────────────────────────
  // PASSKEY / FACE ID
  // ─────────────────────────────────────────────

  passkeyCredentials: () =>
    req("/api/webauthn/credentials"),

  passkeyRegOptions: () =>
    req("/api/webauthn/register/options", {
      method: "POST",
    }),

  passkeyRegVerify: (b) =>
    req("/api/webauthn/register/verify", {
      method: "POST",
      body: b,
    }),

  passkeyLoginOptions: () =>
    req("/api/webauthn/login/options", {
      method: "POST",
    }),

  passkeyLoginVerify: (b) =>
    req("/api/webauthn/login/verify", {
      method: "POST",
      body: b,
    }),

  me: () =>
    req("/api/me"),

  config: () =>
    req("/api/config"),

  users: (q) =>
    req(
      `/api/users?q=${encodeURIComponent(q || "")}`
    ),

  // ─────────────────────────────────────────────
  // PLAID
  // ─────────────────────────────────────────────

  plaidLinkToken: () =>
    req("/api/plaid/link-token", {
      method: "POST",
    }),

  plaidExchange: (publicToken) =>
    req("/api/plaid/exchange", {
      method: "POST",
      body: {
        publicToken,
      },
      idempotent: true,
    }),

  plaidItems: () =>
    req("/api/plaid/items"),

  plaidRemoveItem: (id) =>
    req(
      `/api/plaid/items/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      }
    ),

  plaidSync: () =>
    req("/api/plaid/sync", {
      method: "POST",
    }),

  // ─────────────────────────────────────────────
  // ACCOUNTS
  // ─────────────────────────────────────────────

  accounts: () =>
    req("/api/accounts"),

  // ─────────────────────────────────────────────
  // TRANSACTIONS
  // ─────────────────────────────────────────────

  transactions: (params = {}) => {
    const qs = new URLSearchParams();

    if (params.from) {
      qs.set("from", params.from);
    }

    if (params.to) {
      qs.set("to", params.to);
    }

    if (params.category) {
      qs.set("category", params.category);
    }

    if (params.limit) {
      qs.set("limit", params.limit);
    }

    const s = qs.toString();

    return req(
      `/api/transactions${s ? `?${s}` : ""}`
    );
  },

  updateTransaction: (id, b) =>
    req(
      `/api/transactions/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: b,
      }
    ),

  // ─────────────────────────────────────────────
  // BILLS
  // ─────────────────────────────────────────────

  bills: () =>
    req("/api/bills"),

  createBill: (b) =>
    req("/api/bills", {
      method: "POST",
      body: b,
    }),

  updateBill: (id, b) =>
    req(
      `/api/bills/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: b,
      }
    ),

  deleteBill: (id) =>
    req(
      `/api/bills/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      }
    ),

  // ─────────────────────────────────────────────
  // BUDGETS
  // ─────────────────────────────────────────────

  budgets: () =>
    req("/api/budgets"),

  upsertBudget: (b) =>
    req("/api/budgets", {
      method: "POST",
      body: b,
    }),

  deleteBudget: (id) =>
    req(
      `/api/budgets/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      }
    ),

  // ─────────────────────────────────────────────
  // GOALS
  // ─────────────────────────────────────────────

  goals: () =>
    req("/api/goals"),

  createGoal: (b) =>
    req("/api/goals", {
      method: "POST",
      body: b,
    }),

  updateGoal: (id, b) =>
    req(
      `/api/goals/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: b,
      }
    ),

  deleteGoal: (id) =>
    req(
      `/api/goals/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      }
    ),

  // ─────────────────────────────────────────────
  // INSIGHTS
  // ─────────────────────────────────────────────

  insights: () =>
    req("/api/insights"),

  // ─────────────────────────────────────────────
  // DEALTOUGH
  // ─────────────────────────────────────────────

  dealtoughAnalyze: (b) =>
    req("/api/dealtough/analyze", {
      method: "POST",
      body: b,
    }),

  // ─────────────────────────────────────────────
  // GROUPS / SHARED EXPENSES
  // ─────────────────────────────────────────────

  groups: () =>
    req("/api/groups"),

  group: (id) =>
    req(
      `/api/groups/${encodeURIComponent(id)}`
    ),

  createGroup: (b) =>
    req("/api/groups", {
      method: "POST",
      body: b,
    }),

  addGroupMember: (id, b) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/members`,
      {
        method: "POST",
        body: b,
      }
    ),

  removeGroupMember: (id, memberId) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
      {
        method: "DELETE",
      }
    ),

  addExpense: (id, b) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/expenses`,
      {
        method: "POST",
        body: b,
        idempotent: true,
      }
    ),

  deleteExpense: (id, expenseId) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/expenses/${encodeURIComponent(expenseId)}`,
      {
        method: "DELETE",
      }
    ),

  addRecurring: (id, b) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/recurring`,
      {
        method: "POST",
        body: b,
      }
    ),

  deleteRecurring: (id, rid) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/recurring/${encodeURIComponent(rid)}`,
      {
        method: "DELETE",
      }
    ),

  settle: (id, b) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/settle`,
      {
        method: "POST",
        body: b,
        idempotent: true,
      }
    ),

  quickSplit: (b) =>
    req("/api/split", {
      method: "POST",
      body: b,
      idempotent: true,
    }),

  remind: (id, b) =>
    req(
      `/api/groups/${encodeURIComponent(id)}/remind`,
      {
        method: "POST",
        body: b,
      }
    ),

  reminders: () =>
    req("/api/reminders"),

  dismissReminder: (id) =>
    req(
      `/api/reminders/${encodeURIComponent(id)}/seen`,
      {
        method: "POST",
      }
    ),

  // ─────────────────────────────────────────────
  // BILLING
  // ─────────────────────────────────────────────

  billingStatus: () =>
    req("/api/billing/status"),

  billingCheckout: () =>
    req("/api/billing/checkout", {
      method: "POST",
    }),

  billingPortal: () =>
    req("/api/billing/portal", {
      method: "POST",
    }),
};
