import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InteractionBroker } from "../extension/server/interaction-broker.js";
import { LearningServer } from "../extension/server/learning-server.js";
import type { LearningInteraction } from "../extension/server/protocol.js";
import { LearningStateStore } from "../extension/state/learning-state.js";

const TOKEN = "qa-token";

function singleChoiceInteraction(id: string): LearningInteraction {
  return {
    id,
    type: "single_choice",
    question: `Question ${id}`,
    options: [
      { id: "A", label: "First" },
      { id: "B", label: "Second" }
    ],
    allowSkip: false,
    createdAt: Date.now()
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(body: ReadableStream<Uint8Array> | null) {
    if (body === null) throw new Error("no body");
    this.reader = body.getReader();
  }

  async nextFrame(): Promise<string> {
    for (;;) {
      const sep = this.buffer.indexOf("\n\n");
      if (sep !== -1) {
        const frame = this.buffer.slice(0, sep);
        this.buffer = this.buffer.slice(sep + 2);
        return frame;
      }
      const { done, value } = await withTimeout(this.reader.read(), 5000);
      if (done) throw new Error("SSE stream ended early");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  async waitFor(predicate: (d: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    for (;;) {
      const frame = await this.nextFrame();
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine === undefined) continue;
      const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
      if (predicate(data)) return data;
    }
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

describe("LearningServer QA scenarios", () => {
  let broker: InteractionBroker;
  let state: LearningStateStore;
  let server: LearningServer;
  let origin: string;
  const headers = { Authorization: `Bearer ${TOKEN}` };

  beforeEach(async () => {
    broker = new InteractionBroker();
    state = new LearningStateStore();
    server = new LearningServer({ broker, state, token: TOKEN });
    await server.start();
    origin = new URL(server.url() ?? "").origin;
  });

  afterEach(async () => {
    await server.close();
  });

  it("auto-selects a non-zero port on 127.0.0.1", () => {
    const url = server.url();
    expect(url).toBeDefined();
    expect(new URL(url ?? "").hostname).toBe("127.0.0.1");
    expect(Number(new URL(url ?? "").port)).toBeGreaterThan(0);
  });

  it("rejects unknown API paths with 404", async () => {
    const r1 = await fetch(`${origin}/api/events/extra`, { headers });
    expect(r1.status).toBe(404);
    const r2 = await fetch(`${origin}/api/interactions/q_skip/skip`, {
      method: "POST",
      headers,
      body: "{}"
    });
    expect(r2.status).toBe(404);
    const r3 = await fetch(`${origin}/../package.json`, { headers });
    expect(r3.status).toBe(404);
  });

  it("serves the inline placeholder page when no dist build exists", async () => {
    const noDist = new LearningServer({
      broker,
      state,
      token: TOKEN,
      staticRoot: path.join(tmpdir(), `pi-learning-qa-missing-${Date.now()}`)
    });
    await noDist.start();
    try {
      const response = await fetch(`${new URL(noDist.url() ?? "").origin}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Pi Learning Session");
    } finally {
      await noDist.close();
    }
  });

  it("serves dist files with correct content types and blocks path traversal", async () => {
    const distRoot = mkdtempSync(path.join(tmpdir(), "pi-learning-qa-dist-"));
    try {
      mkdirSync(path.join(distRoot, "assets"), { recursive: true });
      writeFileSync(
        path.join(distRoot, "index.html"),
        "<!doctype html><title>fixture</title>"
      );
      writeFileSync(
        path.join(distRoot, "assets", "app.js"),
        "console.log('fixture');"
      );
      const staticServer = new LearningServer({
        broker,
        state,
        token: TOKEN,
        staticRoot: distRoot
      });
      await staticServer.start();
      const staticOrigin = new URL(staticServer.url() ?? "").origin;
      try {
        const index = await fetch(`${staticOrigin}/`);
        expect(index.status).toBe(200);
        expect(index.headers.get("content-type")).toContain("text/html");
        expect(await index.text()).toContain("fixture");

        const js = await fetch(`${staticOrigin}/assets/app.js`);
        expect(js.status).toBe(200);
        expect(js.headers.get("content-type")).toContain("javascript");
        expect(await js.text()).toBe("console.log('fixture');");

        const missing = await fetch(`${staticOrigin}/assets/nope.js`);
        expect(missing.status).toBe(404);

        // Path traversal attempts must never escape the dist root.
        const traversal1 = await fetch(`${staticOrigin}/../package.json`);
        expect(traversal1.status).toBe(404);
        const traversal2 = await fetch(`${staticOrigin}/%2e%2e/package.json`);
        expect(traversal2.status).toBe(404);
        const traversal3 = await fetch(`${staticOrigin}/..%2fpackage.json`);
        expect(traversal3.status).toBe(404);
      } finally {
        await staticServer.close();
      }
    } finally {
      rmSync(distRoot, { recursive: true, force: true });
    }
  });

  it("delivers one presented broadcast to two concurrent SSE clients", async () => {
    const a = await fetch(`${origin}/api/events?token=${TOKEN}`);
    const b = await fetch(`${origin}/api/events?token=${TOKEN}`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const readerA = new SseReader(a.body);
    const readerB = new SseReader(b.body);
    await readerA.waitFor((d) => d.event === "connected");
    await readerB.waitFor((d) => d.event === "connected");

    void broker.present(singleChoiceInteraction("q_two_clients"));
    const fromA = await readerA.waitFor((d) => d.event === "interaction.presented");
    const fromB = await readerB.waitFor((d) => d.event === "interaction.presented");
    expect(fromA).toMatchObject({ interaction: { id: "q_two_clients" } });
    expect(fromB).toMatchObject({ interaction: { id: "q_two_clients" } });

    await readerA.close();
    await readerB.close();
  });

  it("broadcasts interaction.resolved exactly once per submit", async () => {
    const pending = broker.present(singleChoiceInteraction("q_once"));
    const sse = await fetch(
      `${origin}/api/events?token=${TOKEN}`,
      { headers: { Accept: "text/event-stream" } }
    );
    const reader = new SseReader(sse.body);

    expect(broker.submit({
      interactionId: "q_once",
      answer: { optionId: "A" },
      clientTimestamp: Date.now()
    })).toMatchObject({ ok: true });
    await pending;

    const resolved = await reader.waitFor(
      (d) => d.event === "interaction.resolved"
    );
    expect(resolved).toMatchObject({ interactionId: "q_once" });

    // Give any duplicate broadcast a chance to arrive, then assert nothing else did.
    await expect(
      withTimeout(reader.nextFrame(), 300).then((frame) =>
        frame.includes("interaction.resolved")
      )
    ).rejects.toThrow(/Timed out/);
    await reader.close();
  });

  it("drops a disconnected SSE client and reports no web client", async () => {
    const sse = await fetch(`${origin}/api/events`, { headers });
    expect(server.hasWebClient()).toBe(true);
    const reader = new SseReader(sse.body);
    await reader.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.hasWebClient()).toBe(false);
  });

  it("does not leak unhandled rejections when pending interactions are cancelled at shutdown", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const pending = broker.present(singleChoiceInteraction("q_shutdown"));
      void pending.catch(() => undefined);
      broker.cancelAll("session_shutdown");
      await pending.catch(() => undefined);
      await server.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
