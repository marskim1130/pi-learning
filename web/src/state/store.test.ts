// 前端 store 的 SSE 事件处理（规格 9.3/9.4）：presented 入队去重、resolved 幂等、
// submitSuccess 乐观移除与 resolved 事件不产生双帧。Node 环境 + 手写 stub，
// 不依赖 jsdom（store 只用到 sessionStorage/window.location/EventSource）。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialize, useLearningWorkspace } from "./store";
import type { LearningInteraction, ResolvedAnswer } from "../types/protocol";

function singleChoice(id: string): LearningInteraction {
  return {
    id,
    type: "single_choice",
    question: `Q ${id}`,
    options: [
      { id: "A", label: "First" },
      { id: "B", label: "Second" }
    ],
    allowSkip: false,
    createdAt: Date.now()
  };
}

function resolvedFor(interaction: LearningInteraction): ResolvedAnswer {
  return {
    interactionId: interaction.id,
    type: "single_choice",
    answer: { optionId: "B" },
    responseTimeMs: 12
  };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource | null {
    return this.instances[this.instances.length - 1] ?? null;
  }
  static reset(): void {
    this.instances = [];
  }

  readonly url: string;
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, handler: (event: MessageEvent) => void): void {
    let set = this.listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(handler);
  }

  dispatch(name: string, data?: unknown): void {
    if (this.closed) {
      return; // 真实 EventSource close() 后不再投递任何事件
    }
    const event = { type: name, data: JSON.stringify(data) } as MessageEvent;
    for (const handler of this.listeners.get(name) ?? []) {
      handler(event);
    }
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open");
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
}

interface FakeWindow {
  location: { origin: string };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

function fakeSessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value))
  } as Storage;
}

describe("web workspace store SSE handling", () => {
  const token = "store-test-token";

  beforeEach(() => {
    vi.restoreAllMocks();
    FakeEventSource.reset();
    const storage = fakeSessionStorage();
    storage.setItem("pi_learning_token", token);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", {
      location: { origin: "http://127.0.0.1:54321" },
      setTimeout,
      clearTimeout
    } as FakeWindow);
    vi.stubGlobal("EventSource", FakeEventSource);
    useLearningWorkspace.setState({
      status: "connecting",
      session: null,
      pending: [],
      transcript: [],
      bootError: null
    });
  });

  it("boot sequence loads session + pending and opens SSE (spec 9.4)", async () => {
    const interaction = singleChoice("boot_1");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/api/health")) {
        return new Response(JSON.stringify({ ok: true }));
      }
      if (path.endsWith("/api/session")) {
        return new Response(JSON.stringify({ learningMode: true, phase: "practicing", concepts: [] }));
      }
      if (path.endsWith("/api/interactions/pending")) {
        return new Response(JSON.stringify({ interactions: [interaction] }));
      }
      throw new Error(`unexpected fetch ${path}`);
    }));

    await initialize();

    expect(useLearningWorkspace.getState().session?.phase).toBe("practicing");
    expect(useLearningWorkspace.getState().pending).toEqual([interaction]);
    const es = FakeEventSource.last();
    expect(es).not.toBeNull();
    expect(es?.url).toContain(`token=${token}`);

    es?.open();
    expect(useLearningWorkspace.getState().status).toBe("connected");
  });

  it("presented adds pending exactly once; resolved removes it and records transcript once (idempotent)", () => {
    const interaction = singleChoice("sse_1");
    useLearningWorkspace.getState().connect();
    const es = FakeEventSource.last();
    expect(es).not.toBeNull();

    es?.dispatch("interaction.presented", { interaction });
    es?.dispatch("interaction.presented", { interaction }); // 重复事件
    expect(useLearningWorkspace.getState().pending).toEqual([interaction]);

    const answer = resolvedFor(interaction);
    es?.dispatch("interaction.resolved", { interactionId: interaction.id, answer });
    es?.dispatch("interaction.resolved", { interactionId: interaction.id, answer }); // 重复事件
    const state = useLearningWorkspace.getState();
    expect(state.pending).toEqual([]);
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]?.kind).toBe("submitted");
    expect(state.transcript[0]?.answerText).toBe("B");
  });

  it("submitSuccess then late resolved event does not double-frame (QA regression)", () => {
    const interaction = singleChoice("race_1");
    const answer = resolvedFor(interaction);
    useLearningWorkspace.getState().connect();
    const store = useLearningWorkspace.getState();
    store.submitSuccess(interaction, answer, "First");

    const es = FakeEventSource.last();
    es?.dispatch("interaction.resolved", { interactionId: interaction.id, answer });

    const state = useLearningWorkspace.getState();
    expect(state.pending).toEqual([]);
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]?.answerText).toBe("First"); // 保留更友好的 label
  });

  it("resolved event before POST response, then submitSuccess fills the label in place", () => {
    const interaction = singleChoice("race_2");
    const answer = resolvedFor(interaction);
    useLearningWorkspace.getState().connect();
    useLearningWorkspace.setState({
      pending: [interaction]
    });

    const es = FakeEventSource.last();
    es?.dispatch("interaction.resolved", { interactionId: interaction.id, answer });
    useLearningWorkspace.getState().submitSuccess(interaction, answer, "First");

    const state = useLearningWorkspace.getState();
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]?.answerText).toBe("First");
    expect(state.pending).toEqual([]);
  });

  it("reopening SSE replaces the old EventSource instead of stacking listeners", () => {
    useLearningWorkspace.getState().connect(); // 第一次连接
    const es1 = FakeEventSource.last();
    useLearningWorkspace.getState().connect(); // 再次 connect → openEventSource
    const es2 = FakeEventSource.last();
    expect(es2).not.toBeNull();
    expect(es2).not.toBe(es1);
    expect(es1?.closed).toBe(true);
    // 旧连接上的事件不再影响 store。
    es1?.dispatch("interaction.presented", { interaction: singleChoice("stale_1") });
    expect(useLearningWorkspace.getState().pending).toEqual([]);
    es2?.dispatch("interaction.presented", { interaction: singleChoice("stale_1") });
    expect(useLearningWorkspace.getState().pending).toHaveLength(1);
  });
});
