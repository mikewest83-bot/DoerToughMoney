import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.js"],
    fileParallelism: false, // tests share one DB; run them serially
  },
});
