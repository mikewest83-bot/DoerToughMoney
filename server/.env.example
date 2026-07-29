# ── Server ──────────────────────────────────────────────
PORT=4000
# Long random string. Generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=replace_me_with_a_long_random_string
WEB_ORIGIN=http://localhost:5173

# ── Database (Postgres) ─────────────────────────────────
# Local docker:  docker run --name even-pg -e POSTGRES_PASSWORD=pg -p 5432:5432 -d postgres:16
# Then:          DATABASE_URL="postgresql://postgres:pg@localhost:5432/even?schema=public"
# On Railway this is provided automatically by the Postgres plugin.
DATABASE_URL=postgresql://postgres:pg@localhost:5432/even?schema=public

# ── Stripe ──────────────────────────────────────────────
# TEST keys from https://dashboard.stripe.com/test/apikeys — NEVER ship live keys to the client.
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# ── Platform fee (revenue) ──────────────────────────────
# All optional; leave at 0 for no fee. Fee is taken from the SENDER on each
# payment and credited to the platform account (@even).
PLATFORM_FEE_BPS=150          # basis points; 150 = 1.5%
PLATFORM_FEE_FLAT_CENTS=0     # flat add-on per payment, in cents
# PLATFORM_FEE_CAP_CENTS=1000 # optional max fee per payment, in cents
