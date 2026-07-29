{
  "name": "even-server",
  "version": "1.0.0",
  "type": "module",
  "description": "even \u2014 P2P payments backend (auth + Postgres ledger + Stripe Connect, idempotent + rate-limited + tested)",
  "main": "server.js",
  "scripts": {
    "start": "prisma migrate deploy && node server.js",
    "dev": "node --watch server.js",
    "migrate": "prisma migrate dev",
    "studio": "prisma studio",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.js",
    "postinstall": "prisma generate"
  },
  "prisma": {
    "schema": "prisma/schema.prisma"
  },
  "dependencies": {
    "@prisma/client": "^5.19.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-async-errors": "^3.1.1",
    "express-rate-limit": "^7.4.0",
    "jsonwebtoken": "^9.0.2",
    "prisma": "^5.19.0",
    "stripe": "^16.9.0"
  },
  "devDependencies": {
    "vitest": "^2.1.1"
  }
}
