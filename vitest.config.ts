import { defineConfig } from "vitest/config";

/**
 * Explicit test include so the Playwright E2E spec (tests/e2e-browser.spec.ts)
 * is never collected by the unit-test runner. Keeps the historical set: root
 * extension/server tests plus the web component/store tests.
 */
export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"]
  }
});
