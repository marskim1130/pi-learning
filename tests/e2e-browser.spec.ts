import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { resolve } from "node:path";

import {
  captureWorkspaceUrl,
  LEARNING_TOOL_ALLOWLIST,
  LearningApi,
  RpcSession,
  type JsonRpcEvent,
  type PendingInteraction
} from "./e2e-rpc.mjs";

/**
 * Browser E2E for spec §37 scenarios A (browser side) and C (refresh
 * recovery). Drives a live Pi agent over RPC (reusing tests/e2e-rpc.mjs), then
 * answers the model's questions in a real browser via the React components.
 *
 * Prerequisite: `npm run build:web` (the workspace must be built so GET /
 * serves the real app, not the placeholder page).
 *
 * Run: `npx playwright test`
 */
const REPO_ROOT = resolve(import.meta.dirname, "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.setTimeout(420_000);

let rpc: RpcSession;
let api: LearningApi;
let workspaceUrl: string;

test.beforeAll(async () => {
  rpc = new RpcSession({
    cwd: REPO_ROOT,
    env: { ...process.env, PI_LEARNING_NO_BROWSER: "1" },
    extraArgs: ["--tools", LEARNING_TOOL_ALLOWLIST.join(",")]
  });
  rpc.start();
  await sleep(600);

  // Boot check: the extension must be loaded with all /learn commands.
  const boot = await rpc.getCommands();
  const commands = Array.isArray(boot) ? boot : boot?.commands ?? [];
  const learn = commands.map((c) => c.name).filter((n) => n?.startsWith("learn"));
  if (learn.length < 5) {
    throw new Error(`extension /learn commands not all registered: ${JSON.stringify(learn)}`);
  }

  // /learn starts the workspace server and notifies the URL+token.
  await rpc.prompt("/learn rust trait bound");
  const urlDeadline = Date.now() + 30_000;
  while (Date.now() < urlDeadline && workspaceUrl === undefined) {
    workspaceUrl = captureWorkspaceUrl(rpc.eventLog) ?? workspaceUrl;
    if (workspaceUrl === undefined) {
      await sleep(200);
    }
  }
  if (workspaceUrl === undefined) {
    throw new Error("/learn did not surface a workspace URL");
  }
  const parsed = new URL(workspaceUrl);
  api = new LearningApi(parsed.origin, parsed.searchParams.get("token") ?? "");
});

test.afterAll(async () => {
  try {
    await rpc.prompt("/learn-stop");
  } catch {
    // agent may already be gone
  }
  await rpc.stop();
});

/** Poll for a pending question; nudge the model if it settles without asking. */
async function waitForPendingQuestion(timeoutMs: number): Promise<PendingInteraction> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = Date.now();
  let nudges = 0;
  while (Date.now() < deadline) {
    const pending = await api.pending();
    const next = pending[0];
    if (next !== undefined) {
      return next;
    }
    if (Date.now() - lastSeen > 30_000 && nudges < 3) {
      await rpc.prompt(
        "Please continue: ask me a practice question now using one of the learning_ask_* tools.",
        { streamingBehavior: "followUp" }
      );
      nudges += 1;
      lastSeen = Date.now();
    }
    await sleep(200);
  }
  throw new Error("timeout waiting for a pending question");
}

/** Wait until the broker no longer holds `id` (i.e. it was resolved). */
function pendingNoLongerHas(id: string) {
  return expect
    .poll(
      async () => {
        const pending = await api.pending();
        return pending.some((p) => p.id === id);
      },
      { timeout: 30_000 }
    )
    .toBe(false);
}

/** Answer whatever interaction the Active Panel currently shows via the DOM. */
async function answerInBrowser(page: Page, interaction: PendingInteraction): Promise<void> {
  switch (interaction.type) {
    case "single_choice":
      await page.locator('input[type="radio"]').first().click();
      break;
    case "multi_choice":
      await page.locator('input[type="checkbox"]').first().click();
      break;
    case "free_response":
      await page
        .locator(".free-response-input")
        .fill(
          "I think a bound constrains the generic type parameter; let me practice this."
        );
      break;
    case "code":
      await ensureCodeEditable(page);
      break;
    default:
      throw new Error(`unsupported interaction type: ${String(interaction.type)}`);
  }
  const submit = page.locator(".interaction button.primary");
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
}

/** For code exercises: if the starter is empty the submit is disabled; type a stub. */
async function ensureCodeEditable(page: Page): Promise<void> {
  const submit = page.locator(".interaction button.primary");
  if (await submit.isEnabled()) {
    return; // starter code already present
  }
  const editor = page.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText('fn main() {\n    println!("hello");\n}\n');
}

async function openWorkspaceAndWaitForInteraction(
  context: BrowserContext,
  timeoutMs = 60_000
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".interaction", { timeout: timeoutMs });
  await expect(page.locator(".interaction-question")).not.toBeEmpty();
  return page;
}

test("scenario A (browser answer) + scenario C (refresh recovery)", async ({ browser }) => {
  // ---- the model must ask a first question (spec 37 A step 1-2) ----
  const first = await waitForPendingQuestion(150_000);

  // ---- open the real workspace in a browser; the pending question renders ----
  const context = await browser.newContext();
  const page = await openWorkspaceAndWaitForInteraction(context);
  const beforeReload = (await page.locator(".interaction").innerText())?.slice(0, 120);

  // ---- scenario C #1: reload while the question is pending; it must re-render ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".interaction", { timeout: 60_000 });
  const afterReload = (await page.locator(".interaction").innerText())?.slice(0, 120);
  expect(beforeReload?.length).toBeGreaterThan(0);
  expect(afterReload?.length).toBeGreaterThan(0);

  // ---- scenario A: answer the question in the browser ----
  await answerInBrowser(page, first);
  await pendingNoLongerHas(first.id); // resolved via the browser's POST

  // ---- Pi continues: the model keeps teaching (spec 37 A step 5-8). If a
  // second question appears, exercise scenario C on it too; if the model
  // settles after one question, the first two phases already covered A+C. ----
  let second: PendingInteraction | undefined;
  try {
    second = await waitForPendingQuestion(150_000);
  } catch {
    second = undefined;
  }

  if (second !== undefined && second.id !== first.id) {
    await page.waitForSelector(".interaction", { timeout: 60_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".interaction", { timeout: 60_000 });
    await answerInBrowser(page, second);
    await pendingNoLongerHas(second.id);
  }

  // The agent should settle at the end of its teaching turn; not fatal if it
  // keeps asking (the resolution assertions above are the real gate).
  try {
    await rpc.waitForEvent(
      (e: JsonRpcEvent) => e.type === "agent_settled",
      { timeout: 120_000, since: rpc.eventLog.length }
    );
  } catch {
    console.warn("agent did not settle within 120s (may have kept asking questions)");
  }

  await context.close();
});
