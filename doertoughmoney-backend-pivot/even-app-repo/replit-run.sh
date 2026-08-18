#!/usr/bin/env bash
# Replit entrypoint: one service that serves the API and the built web app.
set -euo pipefail

# Public URL Stripe redirects and pay-me links point at. On Replit this is the
# repl's domain; override by setting WEB_ORIGIN in Secrets for a custom domain.
export WEB_ORIGIN="${WEB_ORIGIN:-https://${REPLIT_DEV_DOMAIN:-localhost:4000}}"
export SERVE_WEB=1
export PORT="${PORT:-4000}"

echo "▸ Installing deps"
(cd server && npm install)
(cd web && npm install)

echo "▸ Building web (same-origin API)"
(cd web && npm run build)     # no VITE_API_URL => relative /api calls

echo "▸ Migrating database"
(cd server && npx prisma migrate deploy)

echo "▸ Starting even on :$PORT  (public: $WEB_ORIGIN)"
cd server && node server.js
