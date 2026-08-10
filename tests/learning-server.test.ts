import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InteractionBroker } from "../extension/server/interaction-broker.js";
import { LearningServer } from "../extension/server/learning-server.js";
import type { LearningInteraction } from "../extension/server/protocol.js";
import { LearningStateStore } from "../extension/state/learning-state.js";

const TOKEN = "test-token";

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
    createdAt: 1_000
  };
}

function multiChoiceInteraction(id: string): LearningInteraction {
  return {
    id,
    type: "multi_choice",
    question: `Question ${id}`,
    options: [
      { id: "A", label: "First" },
      { id: "B", label: "Second" },
      { id: "C", label: "Third" }
    ],
    allowSkip: false,
    createdAt: 1_000
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

type SseData = Record<string, unknown>;

/** Incremental SSE frame reader over one response body. */
class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(body: ReadableStream<Uint8Array> | null) {
    if (body === null) {
      throw new Error("SSE response has no body.");
    }
    this.reader = body.getReader();
  }

  async nextFrame(): Promise<string> {
    for (;;) {
      const separator = this.buffer.indexOf("\n\n");
      if (separator !== -1) {
        const frame = this.buffer.slice(0, separator);
        this.buffer = this.buffer.slice(separator + 2);
        return frame;
      }
      const { done, value } = await withTimeout(this.reader.read(), 5_000);
      if (done) {
        throw new Error("SSE stream ended before the expected event.");
      }
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  async waitFor(predicate: (data: SseData) => boolean): Promise<SseData> {
    for (;;) {
      const frame = await this.nextFrame();
      const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
      if (dataLine === undefined) {
        continue; // comment frames (e.g. heartbeat) carry no data
      }
      const data = JSON.parse(dataLine.slice(5).trim()) as SseData;
      if (predicate(data)) {
        return data;
      }
    }
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

describe("LearningServer HTTP API", () => {
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
    origin = new URL(server.url() ?? "http://127.0.0.1").origin;
  });

  afterEach(async () => {
    await server.close();
  });

  it("rejects /api requests without a token", async () => {
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(401);
  });

  it("rejects /api requests with a wrong token", async () => {
    const response = await fetch(`${origin}/api/health`, {
      headers: { Authorization: "Bearer wrong" }
    });
    expect(response.status).toBe(401);
  });

  it("serves health with a valid token", async () => {
    const response = await fetch(`${origin}/api/health`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "pi-learning-agent"
    });
  });

  it("maps the learning state snapshot to /api/session", async () => {
    state.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });
    const response = await fetch(`${origin}/api/session`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      learningMode: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "diagnosing",
      concepts: []
    });
  });

  it("lists pending interactions and hides them once resolved", async () => {
    void broker.present(singleChoiceInteraction("q_pending"));
    const response = await fetch(`${origin}/api/interactions/pending`, {
      headers
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      interactions: [{ id: "q_pending" }]
    });

    broker.submit({
      interactionId: "q_pending",
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    });
    const empty = await fetch(`${origin}/api/interactions/pending`, { headers });
    expect(await empty.json()).toEqual({ interactions: [] });
  });

  it("serves the placeholder index page when no dist build exists", async () => {
    const placeholderServer = new LearningServer({
      broker,
      state,
      token: TOKEN,
      // 与构建产物无关：显式指向不存在的目录，验证内联占位页回退。
      staticRoot: path.join(tmpdir(), `pi-learning-missing-${Date.now()}`)
    });
    await placeholderServer.start();
    try {
      const response = await fetch(`${new URL(placeholderServer.url() ?? "").origin}/`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Pi Learning Session");
      expect(html).toContain("Connected to Pi Learning Session");
    } finally {
      await placeholderServer.close();
    }
  });

  it("returns 404 for unknown paths", async () => {
    const response = await fetch(`${origin}/api/nope`, { headers });
    expect(response.status).toBe(404);
  });

  it("rejects an oversized request body with 413", async () => {
    const oversized = JSON.stringify({
      interactionId: "q_big",
      answer: { optionId: "A" },
      clientTimestamp: 1,
      padding: "x".repeat(300_000)
    });
    const response = await fetch(`${origin}/api/interactions/q_big/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: oversized
    });
    expect(response.status).toBe(413);
  });

  it("rejects a body that is not valid JSON with 400", async () => {
    const response = await fetch(`${origin}/api/interactions/q_bad/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "definitely not json"
    });
    expect(response.status).toBe(400);
  });

  it("rejects a submission whose interactionId does not match the URL", async () => {
    const response = await fetch(`${origin}/api/interactions/q_url/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: "q_other",
        answer: { optionId: "A" },
        clientTimestamp: 1_100
      })
    });
    expect(response.status).toBe(400);
  });

  it("rejects a submission missing answer or clientTimestamp", async () => {
    const missingAnswer = await fetch(
      `${origin}/api/interactions/q_fields/submit`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: "q_fields", clientTimestamp: 1 })
      }
    );
    expect(missingAnswer.status).toBe(400);

    const badTimestamp = await fetch(
      `${origin}/api/interactions/q_fields/submit`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: "q_fields", answer: { optionId: "A" }, clientTimestamp: "now" })
      }
    );
    expect(badTimestamp.status).toBe(400);
  });

  it("returns 404 when submitting an unknown interaction", async () => {
    const response = await fetch(`${origin}/api/interactions/q_missing/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: "q_missing",
        answer: { optionId: "A" },
        clientTimestamp: 1_100
      })
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: "not_found"
    });
  });

  it("returns 409 for a duplicate submission of a resolved interaction", async () => {
    void broker.present(singleChoiceInteraction("q_dup"));
    const submission = {
      interactionId: "q_dup",
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    };
    const first = await fetch(`${origin}/api/interactions/q_dup/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(submission)
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${origin}/api/interactions/q_dup/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(submission)
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      ok: false,
      reason: "already_resolved"
    });
  });

  it("rejects an answer with an option the interaction does not offer", async () => {
    void broker.present(singleChoiceInteraction("q_option"));
    const response = await fetch(`${origin}/api/interactions/q_option/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: "q_option",
        answer: { optionId: "Z" },
        clientTimestamp: 1_100
      })
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: "invalid_answer"
    });
  });

  it("accepts a valid submission and clears the pending interaction", async () => {
    void broker.present(singleChoiceInteraction("q_valid"));
    const response = await fetch(`${origin}/api/interactions/q_valid/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: "q_valid",
        answer: { optionId: "A" },
        clientTimestamp: 1_100
      })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      answer: {
        interactionId: "q_valid",
        type: "single_choice",
        answer: { optionId: "A" }
      }
    });
    expect(broker.getPending()).toEqual([]);
  });

  it("accepts a valid multi_choice submission and clears the pending interaction", async () => {
    void broker.present(multiChoiceInteraction("q_multi_valid"));
    const response = await fetch(
      `${origin}/api/interactions/q_multi_valid/submit`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionId: "q_multi_valid",
          answer: { optionIds: ["A", "C"] },
          clientTimestamp: 1_100
        })
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      answer: {
        interactionId: "q_multi_valid",
        type: "multi_choice",
        answer: { optionIds: ["A", "C"] }
      }
    });
    expect(broker.getPending()).toEqual([]);
  });

  it("rejects an empty multi_choice answer with 400", async () => {
    void broker.present(multiChoiceInteraction("q_multi_empty"));
    const response = await fetch(
      `${origin}/api/interactions/q_multi_empty/submit`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionId: "q_multi_empty",
          answer: { optionIds: [] },
          clientTimestamp: 1_100
        })
      }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: "invalid_answer"
    });
  });

  it("streams connected/presented/resolved events over SSE", async () => {
    const sse = await fetch(`${origin}/api/events?token=${TOKEN}`);
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const reader = new SseReader(sse.body);

    const connected = await reader.waitFor((data) => data.event === "connected");
    expect(connected.event).toBe("connected");

    void broker.present(singleChoiceInteraction("q_sse"));
    const presented = await reader.waitFor(
      (data) => data.event === "interaction.presented"
    );
    expect(presented).toMatchObject({ interaction: { id: "q_sse" } });

    const response = await fetch(`${origin}/api/interactions/q_sse/submit`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: "q_sse",
        answer: { optionId: "A" },
        clientTimestamp: 1_100
      })
    });
    expect(response.status).toBe(200);
    const resolved = await reader.waitFor(
      (data) => data.event === "interaction.resolved"
    );
    expect(resolved).toMatchObject({ interactionId: "q_sse" });

    await reader.close();
  });

  it("reports whether a web client is connected", async () => {
    expect(server.hasWebClient()).toBe(false);
    const sse = await fetch(`${origin}/api/events`, { headers });
    expect(sse.status).toBe(200);
    expect(server.hasWebClient()).toBe(true);
    await new SseReader(sse.body).close();
  });

  it("broadcasts session.updated over SSE after state changes", async () => {
    let liveServer: LearningServer;
    const liveState = new LearningStateStore({
      onChange: () => liveServer.broadcastSessionUpdated()
    });
    liveServer = new LearningServer({ broker, state: liveState, token: TOKEN });
    await liveServer.start();
    try {
      const liveOrigin = new URL(liveServer.url() ?? "http://127.0.0.1").origin;
      const sse = await fetch(`${liveOrigin}/api/events?token=${TOKEN}`);
      const reader = new SseReader(sse.body);
      await reader.waitFor((data) => data.event === "connected");

      liveState.recordAttempt({
        interactionId: "q_1",
        conceptId: "generics",
        outcome: "correct",
        evidenceType: "choice"
      });

      const updated = await reader.waitFor(
        (data) => data.event === "session.updated"
      );
      expect(updated).toMatchObject({
        session: {
          learningMode: false,
          phase: "idle",
          concepts: [{ id: "generics", mastery: 0.28, attempts: 1, correct: 1 }]
        }
      });
      await reader.close();
    } finally {
      await liveServer.close();
    }
  });

  it("broadcastSessionUpdated is a safe no-op with no SSE clients", () => {
    const idleServer = new LearningServer({ broker, state, token: TOKEN });
    expect(() => idleServer.broadcastSessionUpdated()).not.toThrow();
  });
});
