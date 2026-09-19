# DoerToughMoney Security Policy

## Current Status

DoerToughMoney is in **pre-launch** status. Core systems pass production readiness checks. Plaid token encryption and Plaid webhook signature verification are **in the codebase**. Confirm the matching env vars are set on Railway before accepting live bank data.

## Pre-Launch Security Tasks

### 🟢 Plaid Access-Token Encryption

**Status**: Implemented in `server/plaid/tokenCrypto.js` (AES-256-GCM).

Set `PLAID_TOKEN_ENCRYPTION_KEY` to a 64-character hex string (32 bytes) before production bank data:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Legacy plaintext tokens still decrypt during migration. Do not ship bank linking without this key.

### 🟢 Plaid webhook signatures

**Status**: Implemented in `server/plaid/webhook.js`. Unsigned or stale JWTs return 403.

### 🟡 HIGH: Dependency Security

Run `npm audit` in both `server/` and `web/` and apply patches.

### 🟡 MEDIUM: Prisma Version

Prisma v5.19.0 is current in-repo. Upgrade to 7.x is optional, not a launch blocker.

## Operational Security

### Secrets Management

- **JWT_SECRET**: Must be 32+ characters. Validated on startup by `validateProductionConfig()`.
- **Plaid credentials**: Stored as environment variables; never logged or exposed in errors.
- **DATABASE_URL**: Railway reference variable; never hardcoded.
- **NODE_ENV**: Must be set to `production` in production; config validation runs unconditionally on startup.

All secrets are validated at startup; the server will refuse to boot if required credentials are missing.

### API Security

- **Rate Limiting**: 
  - 120 req/min general API
  - 12 req/min on auth routes (login, register, passkey)
  - 20 req/min on Plaid routes (rate-limited by Plaid itself)
  - 60 req/min on ledger routes
- **CORS**: Restricted to `WEB_ORIGIN` environment variable
- **JWT Validation**: All authed routes require a valid JWT in the `Authorization: Bearer` header

### Database

- **Migrations**: All 11 migrations have been applied successfully; schema is production-ready
- **Row-Level Security**: Not yet enabled; consider adding RLS for additional protection on `Transaction`, `PlaidItem`, and `Bill` tables
- **Connection Pooling**: Uses Prisma Client with default pool settings; adjust for high concurrency if needed

### Plaid Integration

- **Scope**: Read-only access to accounts and transactions
- **Webhooks**: Plaid sends transaction updates to `/api/webhooks/plaid`; JWT + body-hash verification is required and implemented in `server/plaid/webhook.js`.
- **Token Refresh**: Handled automatically by Plaid; no manual refresh logic needed

### DealTough Integration

- **API Calls**: One-time purchase analysis only; no persistent connection
- **Bill Negotiation**: Stub (intentionally unimplemented) — UI labels it "coming soon"
- **No Data Transmission**: DoerToughMoney does not send bank account data or personal info to DealTough; users manually input item details for analysis

## Known Limitations

### What DoerToughMoney Does NOT Do

- **No money transmission** — This is not a fintech platform. Shared expenses are cash-only; no bank transfers, payments, or balance holds.
- **No KYC/AML** — User identity is not verified beyond email validation.
- **No PCI compliance** — Credit cards are not processed directly; Plaid and analysis APIs handle their own compliance.
- **No 2FA** — Authentication is JWT-based; consider adding 2FA before accepting high-value financial data.

### Shared Expenses (Low Risk)

- Group tracking is **cash-only**
- No bank accounts or payment methods involved
- Settlement is a record of who owes whom, not an automated transfer

## Reporting a Vulnerability

If you discover a security issue:

1. **Do not open a public GitHub issue.**
2. Email: [mike.west83@gmail.com](mailto:mike.west83@gmail.com) with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your report within 48 hours and work toward a fix. Public disclosure will be coordinated with you once a patch is available.

## Dependencies

- **Node.js**: 20.x LTS
- **Postgres**: 14+ (tested with Railway-managed instances)
- **Prisma**: 5.19.0 (plan to upgrade to 7.x pre-launch)
- **Express.js**: 4.x
- **React**: 18.x
- **Vite**: 5.x

All dependencies are pinned in `package-lock.json` and reviewed regularly for security updates.

## Compliance Notes

DoerToughMoney does not collect, process, or store:
- Social Security numbers
- Government IDs
- Bank account numbers (Plaid stores these securely; we only store access tokens)
- Payment card data (handled entirely by Plaid and DealTough)

Personal data collected is limited to:
- Email address
- Hashed password (bcrypt)
- Passkey credentials (WebAuthn)
- Transaction data (from Plaid)
- User-created bills, budgets, goals

See `PRIVACY.md` for details on data use and retention.

## Security Checklist (Pre-Launch)

- [x] Plaid access-token encryption implemented (set `PLAID_TOKEN_ENCRYPTION_KEY` on Railway)
- [ ] `npm audit` run and vulnerabilities addressed
- [ ] Prisma upgraded to v7.x (optional but recommended)
- [x] NODE_ENV validation passes on startup
- [x] JWT_SECRET is 32+ characters
- [ ] DEALTOUGH_API_URL is configured (production defaults to https://dealtoughai.com)
- [ ] PLAID_CLIENT_ID and PLAID_SECRET are configured
- [x] Plaid webhook signature validation implemented
- [ ] 2FA considered (optional for launch)
- [ ] Privacy and Terms pages reviewed and updated
- [ ] PAYWALL_ENABLED=1 (or leave unset in production once Stripe keys are set)
- [x] DoerToughMoney Pro default_price set on Stripe (`price_1UEiyvF68Jizq2F0FmlSFbN2`)

---

**Last Updated**: 2026-08-19  
**Status**: Pre-launch, pending above tasks

