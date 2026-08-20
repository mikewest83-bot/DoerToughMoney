# DoerToughMoney Security Policy

## Current Status

DoerToughMoney is in **pre-launch** status as of 2026-08-19. All core systems are passing production readiness checks (migrations, builds, database schema), but the following security items must be completed before live user data is accepted.

## Pre-Launch Security Tasks

### 🔴 CRITICAL: Plaid Access-Token Encryption

**Status**: Not yet implemented
**Deadline**: Before accepting user data

Plaid access tokens are stored in the `PlaidItem.accessToken` field in plaintext. Before going live, these must be encrypted at rest using envelope encryption (e.g., AWS KMS, HashiCorp Vault, or a similar key management service).

- **Location**: `server/prisma/schema.prisma`, line 74
- **Approach**: 
  1. Add a `encryptedAccessToken` field to store encrypted data
  2. Add a `keyVersion` field to support key rotation
  3. Implement encrypt/decrypt helpers in a new `server/crypto.js` module
  4. Update Plaid sync and token-refresh logic to use encrypted storage
  5. Add a migration to encrypt existing tokens in place

**Why it matters**: If the database is compromised, plaintext Plaid access tokens allow an attacker to impersonate your users to their connected banks.

### 🟡 HIGH: Dependency Security

**Status**: 8 vulnerabilities in server dependencies, 5 in frontend (as of build 2026-08-19)

Run `npm audit` in both `server/` and `web/` directories and apply patches:
```bash
cd server && npm audit fix
cd ../web && npm audit fix
```

Most are transitive dependencies (old versions of `glob`, `uuid`, `node-domexception`). Use `npm audit fix --force` if necessary to upgrade breaking changes, but test against your schema first.

### 🟡 MEDIUM: Prisma Version

**Status**: v5.19.0 (current), v7.9.1+ available

Consider upgrading Prisma to the latest major version. This is a planned upgrade but not a blocker to launch. Follow the official [migration guide](https://pris.ly/d/major-version-upgrade) and test against a replica of your production schema.

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
- **Webhooks**: Plaid sends transaction updates to `/api/webhooks/plaid`; signature validation is required (not yet implemented — add before going live)
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
2. Email: [security@example.com](mailto:security@example.com) with:
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

- [ ] Plaid access-token encryption implemented
- [ ] `npm audit` run and vulnerabilities addressed
- [ ] Prisma upgraded to v7.x (optional but recommended)
- [ ] NODE_ENV validation passes on startup
- [ ] JWT_SECRET is 32+ characters
- [ ] DEALTOUGH_API_URL is configured
- [ ] PLAID_CLIENT_ID and PLAID_SECRET are configured
- [ ] Plaid webhook signature validation implemented
- [ ] 2FA considered (optional for launch)
- [ ] Privacy and Terms pages reviewed and updated

---

**Last Updated**: 2026-08-19  
**Status**: Pre-launch, pending above tasks

