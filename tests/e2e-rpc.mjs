#!/usr/bin/env node
/**
 * E2E harness for the implementation spec §37 scenarios A/B/D/E, driving a
 * real Pi agent (model included) over `--mode rpc` with the learning
 * extension loaded. Not a unit test: it runs a live model and records what
 * actually happens, failing only on hard infrastructure breaks (crash, hang,
 * protocol rejection, server rejecting a valid submission).
 *
 * Usage:
 *   node tests/e2e-rpc.mjs <scenario> [--model <pattern>] [--timeout <sec>]
 *
 * Scenarios (spec §37):
 *   a  full /learn rust trait bound teaching loop, answers submitted via the
 *      server API (reasonable answers)
 *   b  same loop but every answer is deliberately wrong / weak; asserts the
 *      session still advances (model keeps teaching after errors)
 *   d  abort the agent mid-question; asserts no permanent pending promise
 *   e  no web client: every interaction is answered through TUI fallback
 *      dialogs (extension_ui_response), proving auto fallback to TUI
 *
 * Environment:
 *   PI_E2E_MODEL    optional model pattern, forwarded to --model
 *   PI_E2E_SESSION  optional directory for the RPC session (default temp)
 *   PI_LEARNING_NO_BROWSER=1 is forced so no browser opens (spec 19 guard).
 *
 * Exit codes: 0 = scenario asserted, 1 = assertion/infrastructure failure,
 * 2 = crash, 3 = usage error. A JSON report goes to stdout.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const CLI_PATH = resolve(
  REPO_ROOT,
  "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
);
const EXTENSION_PATH = resolve(REPO_ROOT, "extension/index.ts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The E2E agent must be able to teach through the learning tools and nothing
 * else: no bash/write/read, so the model cannot touch the working tree or hit
 * permission prompts during a headless run. Passed as --tools.
 */
export const LEARNING_TOOL_ALLOWLIST = [
  "learning_ask_single_choice",
  "learning_ask_multi_choice",
  "learning_ask_free_response",
  "learning_ask_code",
  "learning_record_attempt"
];

// ---------------------------------------------------------------------------
// Raw JSONL RPC client. The bundled RpcClient hides dialog responses behind a
// private send(), so this speaks the protocol directly. Exported so the
// Playwright browser spec can reuse it.
// ---------------------------------------------------------------------------

export class RpcSession {
  constructor({ cwd, env, extraArgs }) {
    this.cwd = cwd;
    this.env = env;
    this.extraArgs = extraArgs;
    this.proc = null;
    this.listeners = [];
    this.pending = new Map();
    this.nextId = 1;
    this.eventLog = [];
    this.stderr = "";
    this.buffer = "";
    this.exitInfo = null;
  }

  start() {
    const args = [CLI_PATH, "--mode", "rpc", "-e", EXTENSION_PATH, ...this.extraArgs];
    const proc = spawn("node", args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.proc = proc;
    proc.stdout.on("data", (chunk) => this._onStdout(chunk));
    proc.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      this._emit({ type: "_agent_error", error: String(error) });
    });
    proc.on("exit", (code, signal) => {
      this.exitInfo = { code, signal };
      const error = new Error(`agent exited (code=${code} signal=${signal})`);
      for (const [, pending] of this.pending) {
        pending.reject(error);
      }
      this.pending.clear();
      this._emit({ type: "_agent_exit", code, signal });
    });
  }

  _onStdout(chunk) {
    this.buffer += chunk.toString("utf8");
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "") {
        continue;
      }
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        this._emit({ type: "parse_error", raw: line.slice(0, 500) });
        continue;
      }
      if (obj?.type === "response") {
        const pending = this.pending.get(obj.id);
        if (pending !== undefined) {
          this.pending.delete(obj.id);
          if (obj.success) {
            pending.resolve(obj.data);
          } else {
            pending.reject(new Error(obj.error ?? "command failed"));
          }
        }
      } else {
        this._emit(obj);
      }
    }
  }

  _emit(event) {
    this.eventLog.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // a subscriber must never kill the event pump
      }
    }
  }

  onEvent(listener) {
    this.listeners.push(listener);
  }

  async command(obj, timeoutMs = 30_000) {
    if (this.proc === null || this.proc.killed) {
      throw new Error("agent not running");
    }
    const id = obj.id ?? `e2e-${this.nextId++}`;
    const full = { ...obj, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`command ${obj.type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      this.proc.stdin.write(`${JSON.stringify(full)}\n`);
    });
  }

  /** Reply to a pending extension_ui_request (select/input/editor/confirm). */
  sendUiResponse(requestId, payload) {
    if (this.proc === null || this.proc.killed) {
      return;
    }
    this.proc.stdin.write(
      `${JSON.stringify({ type: "extension_ui_response", id: requestId, ...payload })}\n`
    );
  }

  /**
   * Wait for an event matching predicate. `since` (eventLog index) skips events
   * that arrived before a baseline, so an earlier matching event cannot satisfy
   * the wait.
   */
  async waitForEvent(
    predicate,
    { timeout = 90_000, label = "event", since = 0 } = {}
  ) {
    const existing = this.eventLog.slice(since).find(predicate);
    if (existing !== undefined) {
      return existing;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `timeout waiting for ${label} (${timeout}ms); saw ${this.eventLog.length - since} events since baseline`
          )
        );
      }, timeout);
      const listener = (event) => {
        if (predicate(event)) {
          cleanup();
          resolve(event);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
      this.listeners.push(listener);
    });
  }

  prompt(text, opts = {}) {
    return this.command({ type: "prompt", message: text, ...opts });
  }

  getCommands() {
    return this.command({ type: "get_commands" });
  }

  async stop({ graceMs = 5_000 } = {}) {
    if (this.proc === null || this.proc.killed) {
      return;
    }
    try {
      this.proc.stdin.end();
    } catch {
      // ignore
    }
    await Promise.race([new Promise((r) => this.proc.once("exit", r)), sleep(graceMs)]);
    if (this.proc.exitCode === null) {
      this.proc.kill("SIGKILL");
    }
  }
}

// ---------------------------------------------------------------------------
// Learning server HTTP client (the extension exposes the API on 127.0.0.1).
// ---------------------------------------------------------------------------

export class LearningApi {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.headers = { Authorization: `Bearer ${token}` };
  }

  async _get(path) {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers });
    if (!response.ok) {
      throw new Error(`GET ${path} -> HTTP ${response.status}`);
    }
    return response.json();
  }

  session() {
    return this._get("/api/session");
  }

  async pending() {
    const body = await this._get("/api/interactions/pending");
    return body.interactions ?? [];
  }

  async submit(interactionId, answer) {
    const response = await fetch(
      `${this.baseUrl}/api/interactions/${encodeURIComponent(interactionId)}/submit`,
      {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionId,
          answer,
          clientTimestamp: Date.now()
        })
      }
    );
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }
}

// ---------------------------------------------------------------------------
// Answer builders (validated against extension/utils/validation.ts).
// ---------------------------------------------------------------------------

export function buildAnswer(interaction, { wrong = false } = {}) {
  switch (interaction.type) {
    case "single_choice": {
      const optionId =
        wrong && interaction.options.length > 1
          ? interaction.options[interaction.options.length - 1].id
          : interaction.options[0]?.id;
      return { optionId };
    }
    case "multi_choice": {
      const first = interaction.options[0]?.id;
      const last = interaction.options[interaction.options.length - 1]?.id;
      return { optionIds: wrong && last !== undefined && last !== first ? [last] : [first] };
    }
    case "free_response":
      return {
        text: wrong
          ? "I am not sure. Could you explain the key idea again in simpler terms?"
          : "A bound that constrains a generic parameter; I would apply it to practice this topic."
      };
    case "code":
      return { language: interaction.language, code: starterOrDefault(interaction) };
    default:
      throw new Error(`unknown interaction type ${interaction.type}`);
  }
}

function starterOrDefault(interaction) {
  if (typeof interaction.starterCode === "string" && interaction.starterCode.trim() !== "") {
    return interaction.starterCode;
  }
  const snippets = {
    rust: "fn main() {\n    println!(\"hello\");\n}\n",
    typescript: "export function answer(): string {\n  return \"ok\";\n}\n",
    javascript: "export function answer() {\n  return 'ok';\n}\n",
    python: "def answer():\n    return 'ok'\n",
    go: "package main\n\nfunc main() {}\n"
  };
  return snippets[interaction.language.toLowerCase()] ?? `// answer for ${interaction.language}\n`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export const WORKSPACE_URL_PATTERN = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/u;

export function captureWorkspaceUrl(eventLog) {
  for (const event of eventLog) {
    if (event.type === "extension_ui_request" && typeof event.message === "string") {
      const match = WORKSPACE_URL_PATTERN.exec(event.message);
      if (match !== null) {
        return match[1];
      }
    }
  }
  return undefined;
}

/** Lazy LearningApi bound to the workspace URL advertised by /learn. */
export function makeApiFactory(rpc) {
  let apiRef = null;
  return () => {
    if (apiRef === null) {
      const url = captureWorkspaceUrl(rpc.eventLog);
      if (url === undefined) {
        throw new Error("workspace URL not captured from /learn notify");
      }
      const parsed = new URL(url);
      apiRef = new LearningApi(parsed.origin, parsed.searchParams.get("token"));
    }
    return apiRef;
  };
}

export function isQuestionTool(name) {
  return (
    typeof name === "string" &&
    name.startsWith("learning_ask_") &&
    name !== "learning_record_attempt"
  );
}

/**
 * Core loop for server-API scenarios (a/b/d): watch for learning tools, answer
 * any new pending interaction via the server, and finish once the agent has
 * settled for `settleQuietMs` with no pending question. Some models settle
 * after a pure diagnostic without asking anything; `maxNudges` lets the loop
 * push the model to use a learning tool before giving up.
 */
async function driveServerScenarios({
  rpc,
  getApi,
  answerPolicy,
  settleQuietMs = 8_000,
  activityTimeoutMs = 120_000,
  maxNudges = 3,
  log
}) {
  const answered = new Set();
  const toolStarts = [];
  const submits = [];
  let recordAttempts = 0;
  let lastActivity = Date.now();
  let settledAt = null;
  let nudges = 0;
  let done = false;

  rpc.onEvent((event) => {
    if (event.type === "message_update" || event.type === "message_end") {
      lastActivity = Date.now();
    }
    if (event.type === "tool_execution_start") {
      if (isQuestionTool(event.toolName)) {
        toolStarts.push(event.toolName);
      } else if (event.toolName === "learning_record_attempt") {
        recordAttempts += 1;
      }
      lastActivity = Date.now();
    }
    if (event.type === "agent_settled") {
      settledAt = Date.now();
      lastActivity = Date.now();
    }
  });

  const api = getApi();
  while (!done) {
    let interactions = [];
    try {
      interactions = await api.pending();
    } catch {
      // server not up yet; keep polling
    }
    for (const interaction of interactions) {
      if (answered.has(interaction.id)) {
        continue;
      }
      const started = Date.now();
      const result = await api.submit(interaction.id, answerPolicy(interaction));
      if (!result.ok) {
        throw new Error(
          `submit for ${interaction.type} ${interaction.id} rejected: ` +
            `HTTP ${result.status} ${JSON.stringify(result.body)}`
        );
      }
      answered.add(interaction.id);
      submits.push({
        id: interaction.id,
        type: interaction.type,
        latencyMs: Date.now() - started
      });
      lastActivity = Date.now();
    }

    // The model settled without asking anything: nudge it to use a tool.
    if (settledAt !== null && toolStarts.length === 0 && nudges < maxNudges) {
      log?.(`nudge #${nudges + 1}: model settled without a question`);
      await rpc.prompt(
        "Please continue: ask me a practice question now using one of the learning_ask_* tools.",
        { streamingBehavior: "followUp" }
      );
      nudges += 1;
      settledAt = null;
      lastActivity = Date.now();
      continue;
    }

    if (
      settledAt !== null &&
      interactions.length === 0 &&
      Date.now() - settledAt >= settleQuietMs
    ) {
      done = true;
      break;
    }
    if (Date.now() - lastActivity > activityTimeoutMs) {
      throw new Error(
        `no learning activity for ${activityTimeoutMs}ms ` +
          `(${toolStarts.length} question tools, ${submits.length} answered)`
      );
    }
    await sleep(150);
  }

  return { toolStarts, submits, settledAt, nudges, recordAttempts };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function runScenarioA(rpc, { getApi }) {
  await rpc.prompt("/learn rust trait bound");
  const workspaceUrl = captureWorkspaceUrl(rpc.eventLog);
  if (workspaceUrl === undefined) {
    throw new Error("/learn did not surface a workspace URL");
  }

  const result = await driveServerScenarios({
    rpc,
    getApi,
    answerPolicy: (interaction) => buildAnswer(interaction, { wrong: false })
  });
  const session = await getApi().session();

  const hard = [];
  if (result.toolStarts.length === 0) {
    hard.push("model never called a question learning_ask_* tool");
  }
  if (result.submits.length === 0) {
    hard.push("no interaction was answered");
  }
  if (!session.learningMode) {
    hard.push("session.learningMode is not true after /learn");
  }
  if (session.phase === "idle") {
    hard.push("session phase is still idle");
  }
  if (hard.length > 0) {
    throw new Error(`scenario A failed: ${hard.join("; ")}`);
  }

  return {
    workspaceUrl,
    tools: result.toolStarts,
    answered: result.submits.map((s) => ({ id: s.id, type: s.type })),
    nudges: result.nudges,
    recordAttempts: result.recordAttempts,
    phase: session.phase,
    concepts: session.concepts.length,
    masteries: session.concepts.map((c) => c.mastery)
  };
}

async function runScenarioB(rpc, { getApi }) {
  await rpc.prompt("/learn rust trait bound");
  const workspaceUrl = captureWorkspaceUrl(rpc.eventLog);
  if (workspaceUrl === undefined) {
    throw new Error("/learn did not surface a workspace URL");
  }

  const result = await driveServerScenarios({
    rpc,
    getApi,
    answerPolicy: (interaction) => buildAnswer(interaction, { wrong: true })
  });

  const hard = [];
  if (result.toolStarts.length < 2) {
    hard.push(
      `model stopped after ${result.toolStarts.length} question(s); ` +
        "expected it to keep teaching after errors"
    );
  }
  if (result.submits.length === 0) {
    hard.push("no interaction was answered");
  }
  if (hard.length > 0) {
    throw new Error(`scenario B failed: ${hard.join("; ")}`);
  }

  return { workspaceUrl, tools: result.toolStarts, answered: result.submits.length, nudges: result.nudges };
}

async function runScenarioD(rpc, { getApi }) {
  await rpc.prompt("/learn rust trait bound");
  const workspaceUrl = captureWorkspaceUrl(rpc.eventLog);
  if (workspaceUrl === undefined) {
    throw new Error("/learn did not surface a workspace URL");
  }
  const api = getApi();

  // Wait for the first question to become pending, then abort mid-question.
  // Nudge the model if it settles without asking (same variance as scenarios
  // A/B).
  let interactionId;
  let nudges = 0;
  let lastPendingSeen = 0;
  const pendingDeadline = Date.now() + 120_000;
  while (Date.now() < pendingDeadline) {
    const interactions = await api.pending();
    if (interactions.length > 0) {
      interactionId = interactions[0].id;
      break;
    }
    if (Date.now() - lastPendingSeen > 30_000 && nudges < 3) {
      await rpc.prompt(
        "Please continue: ask me a practice question now using one of the learning_ask_* tools.",
        { streamingBehavior: "followUp" }
      );
      nudges += 1;
      lastPendingSeen = Date.now();
    }
    await sleep(150);
  }
  if (interactionId === undefined) {
    throw new Error("scenario D: no question became pending before abort");
  }

  // session.abort() resolves only after the agent is fully idle, which includes
  // the model's turn reacting to the aborted tool, so the response is slow. The
  // spec-37-D assertion that matters is that the broker promise is released
  // promptly: poll pending until the aborted interaction disappears.
  const abortStart = Date.now();
  let abortCommandResult = "pending";
  rpc
    .command({ type: "abort" }, 150_000)
    .then(() => {
      abortCommandResult = "ok";
    })
    .catch((error) => {
      abortCommandResult = `error: ${error.message}`;
    });

  let removedAt = null;
  while (Date.now() - abortStart < 60_000) {
    const pending = await api.pending();
    if (!pending.some((i) => i.id === interactionId)) {
      removedAt = Date.now();
      break;
    }
    await sleep(200);
  }
  if (removedAt === null) {
    throw new Error(`scenario D failed: aborted interaction stayed pending (${interactionId})`);
  }

  // After the aborted tool the agent loop may continue and the model may ask a
  // fresh question, which stays pending and keeps the run "active" (so
  // session.abort()'s waitForIdle never resolves). That is continuation
  // behavior, not a broker leak — the aborted promise was already released.
  // Clean up with /learn-stop (cancels every pending interaction), then check
  // the agent is idle via get_state (isStreaming false). /learn-stop does not
  // spawn a model turn, so no fresh agent_settled can be expected.
  await rpc.prompt("/learn-stop");
  let agentIdle = false;
  for (let i = 0; i < 45; i += 1) {
    try {
      const state = await rpc.command({ type: "get_state" }, 10_000);
      if (state?.isStreaming === false) {
        agentIdle = true;
        break;
      }
    } catch {
      // transient command issue; keep polling
    }
    await sleep(1_000);
  }

  return {
    workspaceUrl,
    abortedInteractionId: interactionId,
    abortBrokerReleaseMs: removedAt - abortStart,
    abortCommandResult,
    abortedInteractionStayedPending: false,
    agentIdleAfterCleanup: agentIdle,
    nudges
  };
}

async function runScenarioE(rpc, { getApi }) {
  // No web client attaches here: every interaction must fall back to TUI
  // dialogs, answered below via extension_ui_response. The learning server is
  // still started by /learn but no SSE client ever connects.
  void getApi;

  let activeTool = null;
  const dialogAnswers = [];

  rpc.onEvent((event) => {
    if (event.type === "tool_execution_start" && isQuestionTool(event.toolName)) {
      activeTool = { name: event.toolName, multiPicks: 0 };
    }
  });

  rpc.onEvent((event) => {
    if (event.type !== "extension_ui_request") {
      return;
    }
    if (event.method === "select") {
      const options = Array.isArray(event.options) ? event.options : [];
      const doneItem = options.find((o) => typeof o === "string" && o.includes("✔"));
      const skipItem = options.find((o) => typeof o === "string" && o.includes("跳过"));
      const real = options.filter(
        (o) => typeof o === "string" && o !== doneItem && o !== skipItem
      );
      let value;
      if (activeTool?.name === "learning_ask_multi_choice") {
        value = activeTool.multiPicks > 0 ? doneItem : real[0];
        activeTool.multiPicks += 1;
      } else {
        value = real[0];
      }
      dialogAnswers.push({ method: "select", value });
      rpc.sendUiResponse(event.id, { value });
      return;
    }
    if (event.method === "input") {
      dialogAnswers.push({ method: "input" });
      rpc.sendUiResponse(event.id, { value: "I will try to answer this." });
      return;
    }
    if (event.method === "editor") {
      const prefill = typeof event.prefill === "string" ? event.prefill : "";
      const value =
        prefill.trim() !== "" ? prefill : "fn main() {\n    println!(\"hello\");\n}\n";
      dialogAnswers.push({ method: "editor", usedPrefill: value === prefill });
      rpc.sendUiResponse(event.id, { value });
      return;
    }
    if (event.method === "confirm") {
      rpc.sendUiResponse(event.id, { confirmed: true });
    }
  });

  const baseline = rpc.eventLog.length;
  await rpc.prompt("/learn rust trait bound");
  const workspaceUrl = captureWorkspaceUrl(rpc.eventLog);

  // Dialogs resolve the tools, so the teaching loop completes on its own; the
  // session is over once the agent settles after this kickoff.
  await rpc.waitForEvent((e) => e.type === "agent_settled", {
    timeout: 180_000,
    label: "agent_settled (TUI dialog loop)",
    since: baseline
  });

  const toolStarts = rpc.eventLog
    .slice(baseline)
    .filter((e) => e.type === "tool_execution_start" && isQuestionTool(e.toolName))
    .map((e) => e.toolName);

  const hard = [];
  if (toolStarts.length === 0) {
    hard.push("model never called a question tool");
  }
  if (dialogAnswers.length === 0) {
    hard.push("no TUI dialog was answered (expected the TUI fallback)");
  }
  if (hard.length > 0) {
    throw new Error(`scenario E failed: ${hard.join("; ")}`);
  }

  return { workspaceUrl, tools: toolStarts, dialogs: dialogAnswers };
}

// ---------------------------------------------------------------------------
// Bootstrap / report
// ---------------------------------------------------------------------------

async function main() {
  const [scenario, ...rest] = process.argv.slice(2);
  let modelPattern = process.env.PI_E2E_MODEL;
  let timeoutSec = 600;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--model" && rest[i + 1] !== undefined) {
      modelPattern = rest[i + 1];
      i += 1;
    } else if (rest[i] === "--timeout" && rest[i + 1] !== undefined) {
      timeoutSec = Number(rest[i + 1]);
      i += 1;
    }
  }

  const runners = { a: runScenarioA, b: runScenarioB, d: runScenarioD, e: runScenarioE };
  if (runners[scenario] === undefined) {
    console.error(`unknown scenario "${scenario}"; expected one of ${Object.keys(runners).join("/")}`);
    process.exit(3);
  }

  const sessionDir = process.env.PI_E2E_SESSION ?? mkdtempSync(join(tmpdir(), "pi-learning-e2e-"));
  const extraArgs = ["--tools", LEARNING_TOOL_ALLOWLIST.join(",")];
  if (modelPattern !== undefined) {
    extraArgs.push("--model", modelPattern);
  }

  const rpc = new RpcSession({
    cwd: REPO_ROOT,
    env: { ...process.env, PI_LEARNING_NO_BROWSER: "1" },
    extraArgs
  });

  const report = {
    scenario,
    startedAt: new Date().toISOString(),
    model: modelPattern ?? "(pi default)",
    sessionDir
  };

  const budgetTimer = setTimeout(() => {
    console.error(`scenario ${scenario} exceeded ${timeoutSec}s budget`);
    void rpc.stop().finally(() => process.exit(2));
  }, timeoutSec * 1_000);

  try {
    rpc.start();
    await sleep(500);

    // Boot check: the extension must be loaded and /learn registered.
    const bootData = await rpc.getCommands();
    const commands = Array.isArray(bootData) ? bootData : bootData?.commands ?? [];
    const learningCommands = commands
      .map((c) => c.name)
      .filter((name) => typeof name === "string" && name.startsWith("learn"))
      .sort();
    if (learningCommands.length < 5) {
      throw new Error(`extension /learn commands not all registered: ${JSON.stringify(learningCommands)}`);
    }

    // Record the actual model the session resolved to (spec: the report should
    // say which model was exercised, not just "pi default").
    try {
      const state = await rpc.command({ type: "get_state" }, 15_000);
      report.resolvedModel =
        state?.model && typeof state.model.id === "string"
          ? `${state.model.provider ?? "?"}/${state.model.id}`
          : undefined;
    } catch {
      report.resolvedModel = "unknown";
    }

    const startedAt = Date.now();
    const scenarioResult = await runners[scenario](rpc, { getApi: makeApiFactory(rpc) });
    report.durationMs = Date.now() - startedAt;
    report.result = scenarioResult;
    report.exit = 0;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.exit = 1;
  } finally {
    clearTimeout(budgetTimer);
    await rpc.stop();
  }

  const crashPattern = /unhandledRejection|Unhandled/i;
  if (report.exit === 0 && crashPattern.test(rpc.stderr)) {
    report.exit = 1;
    report.error = "unhandledRejection detected in agent stderr";
  }
  report.stderrIssues = crashPattern.test(rpc.stderr) ? rpc.stderr.slice(-1_500) : undefined;
  report.stderrTail = rpc.stderr.slice(-1_500);
  report.eventCount = rpc.eventLog.length;

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.exit ?? 1);
}

// ---------------------------------------------------------------------------
// Entry point: only run main when executed directly (the Playwright spec
// imports this file as a library).
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
