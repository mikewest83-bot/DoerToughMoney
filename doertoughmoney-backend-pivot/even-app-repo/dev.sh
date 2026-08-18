#!/usr/bin/env bash
# One command to run the whole stack locally: Postgres + API + Stripe webhook + web.
# Ctrl-C stops everything this script started (the Postgres container keeps
# running so restarts are fast; `make stop` shuts it down).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Kill every child process (API, web, stripe listen) when the script exits.
trap 'echo; echo "▸ Stopping…"; kill 0 2>/dev/null || true' EXIT

step() { printf "\n\033[1;35m▸ %s\033[0m\n" "$1"; }

command -v docker >/dev/null || { echo "Docker is required (https://docker.com)"; exit 1; }
command -v node   >/dev/null || { echo "Node.js 18+ is required"; exit 1; }

# 1. Postgres
step "Starting Postgres"
docker compose up -d db
printf "  waiting for the database"
until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do printf "."; sleep 1; done
echo " ready"

# 2. First-run setup: env files + installs
[ -f server/.env ] || cp server/.env.example server/.env
[ -f web/.env ]    || cp web/.env.example web/.env
[ -d server/node_modules ] || { step "Installing server deps"; (cd server && npm install); }
[ -d web/node_modules ]    || { step "Installing web deps";    (cd web && npm install); }

# 3. Apply the committed migration
step "Applying database migrations"
(cd server && npx prisma migrate deploy)

# 4. Stripe webhook listener — auto-wire the signing secret if logged in
step "Stripe webhooks"
if command -v stripe >/dev/null 2>&1; then
  SECRET="$(stripe listen --print-secret 2>/dev/null || true)"
  if [ -n "$SECRET" ]; then
    export STRIPE_WEBHOOK_SECRET="$SECRET"   # dotenv won't override this, so it wins
    stripe listen --forward-to localhost:4000/api/stripe/webhook >/dev/null 2>&1 &
    echo "  forwarding to the API — secret wired automatically"
  else
    echo "  run 'stripe login' first to make 'Add funds' credit balances locally"
  fi
else
  echo "  Stripe CLI not installed — everything else works; 'Add funds' just won't credit locally"
fi

# 5. API + web
step "Starting API on :4000 and web on :5173"
(cd server && npm run dev) &
(cd web && npm run dev) &

cat <<'BANNER'

  ─────────────────────────────────────────────
   even is running
     web    http://localhost:5173
     api    http://localhost:4000/api/health
   Test card for Add funds: 4242 4242 4242 4242
   Press Ctrl-C to stop everything.
  ─────────────────────────────────────────────
BANNER

wait
