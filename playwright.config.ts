import { defineConfig } from "@playwright/test";

/**
 * Browser E2E for spec §37 scenarios A (browser side) and C (refresh
 * recovery). Reuses the RPC harness (tests/e2e-rpc.mjs) to drive a live Pi
 * agent; only the interactive answering happens in a real browser.
 *
 * Uses the system Microsoft Edge (channel: "msedge") so no browser download
 * is required. Build the web workspace first: `npm run build:web`.
 */
export default defineConfig({
  testDir: "tests",
  testMatch: "**/e2e-browser.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 }
  }
});
