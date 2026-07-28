import { defineConfig } from "vitest/config";

// Default `vitest` runs only the fast, DB-free unit tests.
// Integration tests (*.integration.test.js) need Postgres and are run
// explicitly via `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["**/*.test.js"],
    exclude: ["**/*.integration.test.js", "node_modules/**"],
  },
});
