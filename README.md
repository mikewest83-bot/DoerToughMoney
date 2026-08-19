# DoerToughMoney

**Personal finance: accounts, transactions, bills, budgets, and goals — with AI-powered savings insights.**

DoerToughMoney connects your bank accounts via Plaid, tracks your transactions by category, helps you manage bills and budgets, set financial goals, and analyze one-time purchase decisions with DealTough's savings AI. It also supports shared/group expense tracking with cash-settlement.

```
doertoughmoney/
├── server/   Node + Express + Prisma/Postgres — auth, Plaid, bills, budgets, goals, DealTough, webhooks
└── web/      Vite + React client — accounts, transactions, bills, budgets, goals, insights, shared expenses
```

## Features

- **Linked Bank Accounts** — Connect via Plaid; read-only access to accounts and transaction history
- **Transaction Tracking** — Auto-fetched from linked accounts; filter by category, tag with bills/budgets
- **Bills & Recurring Expenses** — Track amounts, due dates, and auto-recurring materialization
- **Budgets & Goals** — Set monthly or annual spending limits and savings targets by category
- **Insights** — Spending by category, month-over-month trends, budget/goal status
- **DealTough Analysis** — One-time purchase decisions: "Should I buy this?" analysis against comparable alternatives
- **Shared Expenses** — Group tracking with cash-settlement; no money transmission involved
- **Passkey & Password Auth** — Sign in with face ID / touch ID or password; optional Google OAuth

## Quick Start (Local Development)

### Prerequisites
- Node 20.x
- Docker (for Postgres)
- npm

### 1. Start Postgres
```bash
docker compose up -d db
```

### 2. Backend
```bash
cd server
npm install
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET, optional Plaid/DealTough/Google OAuth keys
npm run migrate
npm run dev  # http://localhost:4000
```

### 3. Frontend
```bash
cd ../web
npm install
cp .env.example .env
# Set VITE_API_URL=http://localhost:4000
npm run dev  # http://localhost:5173
```

### Testing

**Unit tests** (logic, groups, rate limiting):
```bash
cd server
npm test
```

**Integration tests** (database behavior):
```bash
docker compose up -d db
cd server
DATABASE_URL="postgresql://postgres:pg@localhost:5432/doertoughmoney_test?schema=public" \
  npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:pg@localhost:5432/doertoughmoney_test?schema=public" \
  npm run test:integration
```

## Environment Variables

### Backend (`server/.env`)
- **DATABASE_URL** — Postgres connection string
- **JWT_SECRET** — 32+ character secret for signing auth tokens
- **NODE_ENV** — Set to `production` for production deploys
- **WEB_ORIGIN** — Frontend URL (e.g., https://doertoughmoney.up.railway.app)
- **PLAID_CLIENT_ID** / **PLAID_SECRET** — Plaid API keys for account linking (https://plaid.com)
- **PLAID_ENV** — `sandbox` or `production`
- **PLAID_WEBHOOK_URL** — Webhook endpoint for Plaid transaction updates (optional)
- **DEALTOUGH_API_URL** — DealTough deployment base URL for purchase analysis
- **GOOGLE_CLIENT_ID** — Google OAuth credential ID (optional; password auth always works)

### Frontend (`web/.env`)
- **VITE_API_URL** — Backend API base URL

## Deployment

### Railway

1. Create a new Railway project and connect your GitHub repo
2. **Add Postgres database** — Railway auto-sets `DATABASE_URL`
3. **API service** — root directory `server/`, uses `server/railway.json`
   - Set env vars: `DATABASE_URL` (reference the Postgres plugin), `JWT_SECRET`, `WEB_ORIGIN`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `DEALTOUGH_API_URL`
4. **Web service** — root directory `web/`, uses `web/railway.json`
   - Set env var: `VITE_API_URL` to the API's public URL

The backend runs `prisma migrate deploy` on startup, applying all committed migrations.

### Scaling & Security

- Rate limiting: 120 req/min general, 12/min on auth, 20/min on Plaid, 60/min on ledger routes
- Plaid access tokens are stored but not encrypted at rest; pre-launch task: implement envelope encryption (see SECURITY.md)
- Shared expenses are cash-only; no money transmission
- Frontend is served as static assets; backend handles all auth and data

## Running Tests & Production Build

```bash
# Unit tests
cd server && npm test

# Integration tests (requires Postgres running)
DATABASE_URL="postgresql://postgres:pg@localhost:5432/doertoughmoney_test?schema=public" npm run test:integration

# Production build (both backend and frontend)
npm run build  # from root directory
```

## Architecture Notes

- **Server** — Express.js with Prisma ORM; async error handling with `express-async-errors`
- **Frontend** — React with Vite; Tailwind CSS for styling; Plaid Link for account connection
- **Database** — Postgres with 11 committed migrations (see `server/prisma/migrations/`)
- **Auth** — JWTs signed with `JWT_SECRET`; passkeys via WebAuthn, passwords hashed with bcrypt
- **Plaid** — Lazy-loading client; public-token exchange; cursor-based transaction sync
- **DealTough** — Integrated analysis endpoint for one-time purchase decisions

## Shared Expenses (Group Tracking)

- Create groups, invite members via email, track shared expenses
- Settlement is **cash-only**: records who owes whom, but no automatic money transfer
- No integration with Plaid accounts or bills; purely a tracking/settlement tool

## License

Proprietary — DoerToughMoney is a private product.

