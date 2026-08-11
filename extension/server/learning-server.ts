import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";

import type { LearningStateStore } from "../state/learning-state.js";
import {
  CodeRunUnavailableError,
  isSupportedLanguage
} from "../runner/code-runner.js";
import type { CodeRunner } from "../runner/code-runner.js";
import type { InteractionBroker } from "./interaction-broker.js";
import type {
  InteractionSubmission,
  LearningEvent,
  LearningSessionSnapshot
} from "./protocol.js";
import { SseHub } from "./sse-hub.js";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_CODE_BYTES = 100 * 1024;

/** 规格 25：/api/code/run 的 timeoutMs 取值范围。 */
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;

export interface LearningServerOptions {
  broker: InteractionBroker;
  state: LearningStateStore;
  now?: () => number;
  /** Injectable for tests; defaults to a random 48-hex-char session token. */
  token?: string;
  /**
   * Root of the built web app (spec 9.2 GET / + assets). Defaults to
   * <repo>/web/dist; injectable for tests.
   */
  staticRoot?: string;
  /**
   * Explicitly enables POST /api/code/run. Omit unless the host provides an
   * appropriately isolated runner; local execution is disabled by default.
   */
  runner?: CodeRunner;
}

/**
 * Local HTTP/SSE server for the web learning workspace (spec 9).
 *
 * Listens on 127.0.0.1 with an OS-chosen port; never on public interfaces.
 * Every /api/* route requires the session token (spec 31); /api/events also
 * accepts ?token= because EventSource cannot send headers.
 *
 * The server starts lazily via start(). GET / serves the built web app from
 * web/dist when present (path traversal guarded), otherwise a small inline
 * placeholder page; everything else is JSON or SSE.
 */
export class LearningServer {
  private readonly broker: InteractionBroker;
  private readonly state: LearningStateStore;
  private readonly token: string;
  private readonly now: () => number;
  private readonly sseHub = new SseHub();
  private readonly staticRoot: string;
  private readonly runner: CodeRunner | undefined;
  private server: Server | undefined;
  private startPromise: Promise<void> | undefined;

  constructor(options: LearningServerOptions) {
    this.broker = options.broker;
    this.state = options.state;
    this.token = options.token ?? randomBytes(24).toString("hex");
    this.now = options.now ?? Date.now;
    this.staticRoot =
      options.staticRoot ?? path.resolve(import.meta.dirname, "../../web/dist");
    this.runner = options.runner;
    this.broker.subscribe({
      onPresented: (interaction) =>
        this.sseHub.broadcast({ event: "interaction.presented", interaction }),
      onResolved: (answer) =>
        this.sseHub.broadcast({
          event: "interaction.resolved",
          interactionId: answer.interactionId,
          answer
        }),
      onCancelled: (interactionId, reason) =>
        this.sseHub.broadcast({
          event: "interaction.cancelled",
          interactionId,
          reason
        })
    });
  }

  /** Start listening on 127.0.0.1:0. Idempotent; resolves once 'listening'. */
  start(): Promise<void> {
    if (this.startPromise !== undefined) {
      return this.startPromise;
    }

    this.startPromise = new Promise<void>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handleRequest(request, response);
      });
      this.server = server;
      server.on("error", (error) => {
        console.error("[pi-learning-server] server error:", error);
        if (this.server === server) {
          this.server = undefined;
        }
        reject(error);
      });
      server.listen(0, HOST, () => {
        if (this.server !== server) {
          server.close();
          return;
        }
        resolve();
      });
    });

    return this.startPromise;
  }

  /**
   * Workspace URL, e.g. http://127.0.0.1:54321/?token=<token>.
   * Returns undefined while the server is not running (or has been closed).
   */
  url(): string | undefined {
    const address = this.server?.address();
    if (address === undefined || address === null || typeof address === "string") {
      return undefined;
    }
    return `http://${HOST}:${address.port}/?token=${this.token}`;
  }

  /**
   * True while at least one SSE client is connected.
   * ponytail: brief false window during a page refresh (old SSE closing,
   * new one not yet connected) is accepted for MVP auto-open decisions.
   */
  hasWebClient(): boolean {
    return this.sseHub.size > 0;
  }

  /** End all SSE connections and stop the HTTP server. Idempotent. */
  async close(): Promise<void> {
    this.sseHub.close();
    const server = this.server;
    this.server = undefined;
    this.startPromise = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  }

  /**
   * Broadcast the tutor's final visible assistant text (spec 26). Safe no-op
   * while not started / with no SSE clients: the hub simply has no receivers.
   */
  broadcastTutorMessage(
    role: "assistant",
    text: string,
    messageId: string | undefined,
    done: boolean
  ): void {
    // messageId undefined 时不带该字段（SSE JSON 兼容旧客户端）。
    this.sseHub.broadcast({
      event: "tutor.message",
      role,
      text,
      ...(messageId === undefined ? {} : { messageId }),
      done
    });
  }

  /** Broadcast tutor waiting/idle status (spec 26). Safe no-op with no clients. */
  broadcastTutorStatus(status: "waiting" | "idle", toolName?: string): void {
    this.sseHub.broadcast(
      toolName === undefined
        ? { event: "tutor.status", status }
        : { event: "tutor.status", status, toolName }
    );
  }

  /**
   * Broadcast the current learning state as session.updated (spec 16/30). Safe
   * no-op while not started / with no SSE clients: the hub has no receivers.
   */
  broadcastSessionUpdated(): void {
    this.sseHub.broadcast({
      event: "session.updated",
      session: this.sessionSnapshot()
    });
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      await this.route(request, response);
    } catch (error) {
      console.error("[pi-learning-server] request failed:", error);
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, 500, { ok: false, message: "Internal server error." });
    }
  }

  private async route(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${HOST}`);
    const { pathname } = url;
    const method = request.method ?? "GET";

    if (method === "GET" && pathname === "/") {
      await this.serveStatic(response, "/");
      return;
    }

    if (!pathname.startsWith("/api/")) {
      if (method === "GET") {
        await this.serveStatic(response, pathname);
        return;
      }
      sendJson(response, 404, { ok: false, message: "Not found." });
      return;
    }

    const allowQueryToken = pathname === "/api/events";
    if (!this.isAuthorized(request, allowQueryToken)) {
      sendJson(response, 401, { ok: false, message: "Unauthorized." });
      return;
    }

    if (method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "pi-learning-agent",
        capabilities: { codeExecution: this.runner !== undefined }
      });
      return;
    }

    if (method === "GET" && pathname === "/api/session") {
      sendJson(response, 200, this.sessionSnapshot());
      return;
    }

    if (method === "GET" && pathname === "/api/interactions/pending") {
      sendJson(response, 200, { interactions: this.broker.getPending() });
      return;
    }

    if (method === "GET" && pathname === "/api/events") {
      this.handleSse(response);
      return;
    }

    const submitMatch = /^\/api\/interactions\/([^/]+)\/submit$/u.exec(pathname);
    if (method === "POST" && submitMatch !== null) {
      await this.handleSubmit(request, response, submitMatch[1] ?? "");
      return;
    }

    // 规格 9.2：跳过题目（仅 allowSkip 的题目）。与 submit 一样走 broker
    // 解析，返回结构化 skipped answer（规格 7.5）。
    const skipMatch = /^\/api\/interactions\/([^/]+)\/skip$/u.exec(pathname);
    if (method === "POST" && skipMatch !== null) {
      await this.handleSkip(request, response, skipMatch[1] ?? "");
      return;
    }

    // 规格 25：只有宿主显式注入 runner 时才开放。临时目录、env 白名单、
    // 超时和输出截断都不是安全沙箱，因此正式扩展默认返回 403。结果只回给
    // 学习者自测，不进入 learning_ask_code 的 tool result。
    if (method === "POST" && pathname === "/api/code/run") {
      await this.handleCodeRun(request, response);
      return;
    }

    sendJson(response, 404, { ok: false, message: "Not found." });
  }

  /**
   * Serve a file from the built web app root (spec 9.2). Paths are resolved
   * against staticRoot and must stay inside it (blocks ../ and encoded
   * traversal); GET / defaults to index.html and falls back to the inline
   * placeholder page when no build exists (spec 33: frontend bundle missing).
   */
  private async serveStatic(response: ServerResponse, pathname: string): Promise<void> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendJson(response, 404, { ok: false, message: "Not found." });
      return;
    }
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/u, "");
    const resolved = path.resolve(this.staticRoot, relative);
    if (resolved !== this.staticRoot && !resolved.startsWith(this.staticRoot + path.sep)) {
      // Resolved outside the dist root: path traversal attempt.
      sendJson(response, 404, { ok: false, message: "Not found." });
      return;
    }

    let content: Buffer;
    try {
      content = await readFile(resolved);
    } catch {
      if (decoded === "/") {
        sendIndex(response);
        return;
      }
      sendJson(response, 404, { ok: false, message: "Not found." });
      return;
    }

    const contentType =
      CONTENT_TYPES[path.extname(resolved).toLowerCase()] ??
      "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length
    });
    response.end(content);
  }

  private isAuthorized(request: IncomingMessage, allowQueryToken: boolean): boolean {
    if (request.headers.authorization === `Bearer ${this.token}`) {
      return true;
    }
    if (allowQueryToken) {
      const url = new URL(request.url ?? "/", `http://${HOST}`);
      return url.searchParams.get("token") === this.token;
    }
    return false;
  }

  private sessionSnapshot(): LearningSessionSnapshot {
    const snapshot = this.state.snapshot();
    return {
      learningMode: snapshot.enabled,
      ...(snapshot.course === undefined ? {} : { course: { ...snapshot.course } }),
      ...(snapshot.topic === undefined ? {} : { topic: { ...snapshot.topic } }),
      phase: snapshot.phase,
      concepts: Object.values(snapshot.concepts)
    };
  }

  private handleSse(response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.write(
      `event: connected\ndata: ${JSON.stringify({ event: "connected", time: this.now() })}\n\n`
    );
    this.sseHub.addClient(response);
  }

  private async handleSubmit(
    request: IncomingMessage,
    response: ServerResponse,
    rawPathId: string
  ): Promise<void> {
    let interactionId: string;
    try {
      interactionId = decodeURIComponent(rawPathId);
    } catch {
      sendJson(response, 400, { ok: false, message: "Invalid interaction id." });
      return;
    }
    if (interactionId === "") {
      sendJson(response, 400, { ok: false, message: "Invalid interaction id." });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { ok: false, message: "Request body too large." });
        return;
      }
      throw error;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      sendJson(response, 400, {
        ok: false,
        message: "Request body must be valid JSON."
      });
      return;
    }
    if (!isRecord(body)) {
      sendJson(response, 400, { ok: false, message: "Request body must be a JSON object." });
      return;
    }
    if (body.interactionId !== interactionId) {
      sendJson(response, 400, {
        ok: false,
        message: "interactionId does not match the URL."
      });
      return;
    }
    if (!("answer" in body)) {
      sendJson(response, 400, { ok: false, message: "answer is required." });
      return;
    }
    if (typeof body.clientTimestamp !== "number") {
      sendJson(response, 400, {
        ok: false,
        message: "clientTimestamp must be a number."
      });
      return;
    }

    const submission: InteractionSubmission = {
      interactionId,
      answer: body.answer,
      clientTimestamp: body.clientTimestamp
    };
    const result = this.broker.submit(submission);
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "already_resolved"
            ? 409
            : 400;
      sendJson(response, status, {
        ok: false,
        reason: result.reason,
        message: result.message
      });
      return;
    }

    sendJson(response, 200, { ok: true, answer: result.answer });
  }

  /**
   * POST /api/interactions/:id/skip (spec 9.2): learner declines the question.
   * Body: { interactionId } (no answer). Delegate to broker.skip so the
   * pending tool promise resolves with a structured skipped answer.
   */
  private async handleSkip(
    request: IncomingMessage,
    response: ServerResponse,
    rawPathId: string
  ): Promise<void> {
    let interactionId: string;
    try {
      interactionId = decodeURIComponent(rawPathId);
    } catch {
      sendJson(response, 400, { ok: false, message: "Invalid interaction id." });
      return;
    }
    if (interactionId === "") {
      sendJson(response, 400, { ok: false, message: "Invalid interaction id." });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { ok: false, message: "Request body too large." });
        return;
      }
      throw error;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      sendJson(response, 400, {
        ok: false,
        message: "Request body must be valid JSON."
      });
      return;
    }
    if (!isRecord(body)) {
      sendJson(response, 400, { ok: false, message: "Request body must be a JSON object." });
      return;
    }
    if (body.interactionId !== interactionId) {
      sendJson(response, 400, {
        ok: false,
        message: "interactionId does not match the URL."
      });
      return;
    }

    const result = this.broker.skip(interactionId);
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "already_resolved"
            ? 409
            : 400;
      sendJson(response, status, {
        ok: false,
        reason: result.reason,
        message: result.message
      });
      return;
    }

    sendJson(response, 200, { ok: true, answer: result.answer });
  }

  /**
   * POST /api/code/run (spec 25): run learner code locally for self-testing.
   * Validation: language must be in the program-defined whitelist, code is a
   * string ≤ 100KB, timeoutMs optional within [100, 30000] (default 8000).
   * 503 when the runtime binary is missing; other failures bubble to the 500
   * handler in handleRequest.
   */
  private async handleCodeRun(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const runner = this.runner;
    if (runner === undefined) {
      sendJson(response, 403, {
        ok: false,
        reason: "code_execution_disabled",
        message: "Local code execution is disabled for this session."
      });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { ok: false, message: "Request body too large." });
        return;
      }
      throw error;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      sendJson(response, 400, {
        ok: false,
        message: "Request body must be valid JSON."
      });
      return;
    }
    if (!isRecord(body)) {
      sendJson(response, 400, { ok: false, message: "Request body must be a JSON object." });
      return;
    }
    if (typeof body.language !== "string" || !isSupportedLanguage(body.language)) {
      sendJson(response, 400, {
        ok: false,
        message: `Unsupported language: ${String(body.language)}.`
      });
      return;
    }
    if (typeof body.code !== "string") {
      sendJson(response, 400, { ok: false, message: "code must be a string." });
      return;
    }
    if (Buffer.byteLength(body.code, "utf8") > MAX_CODE_BYTES) {
      sendJson(response, 400, {
        ok: false,
        message: `code must be at most ${MAX_CODE_BYTES} bytes.`
      });
      return;
    }
    let timeoutMs = 8000;
    if (body.timeoutMs !== undefined) {
      if (
        typeof body.timeoutMs !== "number" ||
        !Number.isFinite(body.timeoutMs) ||
        body.timeoutMs < MIN_TIMEOUT_MS ||
        body.timeoutMs > MAX_TIMEOUT_MS
      ) {
        sendJson(response, 400, {
          ok: false,
          message: `timeoutMs must be a number between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`
        });
        return;
      }
      timeoutMs = body.timeoutMs;
    }

    try {
      const result = await runner.run({
        language: body.language,
        code: body.code,
        timeoutMs
      });
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      if (error instanceof CodeRunUnavailableError) {
        sendJson(response, 503, {
          ok: false,
          reason: "runtime_unavailable",
          message: error.message
        });
        return;
      }
      throw error;
    }
  }
}

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds 256KB.");
    this.name = "BodyTooLargeError";
  }
}

/** Read the request body, rejecting as soon as it exceeds MAX_BODY_BYTES. */
function readBody(request: IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  return new Promise((resolve, reject) => {
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      reject(new BodyTooLargeError());
      return;
    }

    const chunks: Buffer[] = [];
    let received = 0;
    let overflow = false;
    request.on("data", (chunk: Buffer) => {
      if (overflow) {
        return;
      }
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        overflow = true;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", (error) => reject(error));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function sendIndex(response: ServerResponse): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(INDEX_HTML);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Minimal content-type map for the built web app assets. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

/**
 * Minimal placeholder page (spec 9.2 GET /), used only when no built web app
 * is present. Reads the token from the URL, keeps it in sessionStorage, then
 * verifies /api/health. The real React app (web/dist) replaces this after
 * `npm run build:web`.
 */
const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Pi Learning Session</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; }
  #status { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<h1>Pi Learning Session</h1>
<p>Connected to Pi Learning Session</p>
<p id="status">Checking server...</p>
<script>
  (function () {
    var params = new URLSearchParams(location.search);
    var token = params.get("token");
    if (token) {
      sessionStorage.setItem("pi_learning_token", token);
    }
    var saved = sessionStorage.getItem("pi_learning_token");
    var status = document.getElementById("status");
    if (!saved) {
      status.textContent = "No token found in URL.";
      return;
    }
    fetch("/api/health", {
      headers: { Authorization: "Bearer " + saved }
    })
      .then(function (res) {
        status.textContent = res.ok ? "Server: ok" : "Server: HTTP " + res.status;
      })
      .catch(function () {
        status.textContent = "Server unreachable.";
      });
  })();
</script>
</body>
</html>`;
