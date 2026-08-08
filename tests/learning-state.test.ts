import { describe, expect, it } from "vitest";

import { LearningStateStore } from "../extension/state/learning-state.js";

describe("LearningStateStore", () => {
  it("starts in an idle disabled state", () => {
    const store = new LearningStateStore();

    expect(store.snapshot()).toEqual({
      enabled: false,
      phase: "idle",
      concepts: {},
      recentAttempts: []
    });
  });

  it("starts learning for a course and topic in diagnosing phase", () => {
    const store = new LearningStateStore();

    store.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });

    expect(store.snapshot()).toEqual({
      enabled: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "diagnosing",
      concepts: {},
      recentAttempts: []
    });
  });

  it("stops learning without erasing the selected topic", () => {
    const store = new LearningStateStore();
    store.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });

    store.stop();

    expect(store.snapshot()).toMatchObject({
      enabled: false,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "idle"
    });
  });

  it("restores a serialized learning state snapshot", () => {
    const store = new LearningStateStore();
    const snapshot = {
      enabled: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "checking" as const,
      concepts: {},
      recentAttempts: []
    };

    expect(store.restore(snapshot)).toBe(true);
    expect(store.snapshot()).toEqual(snapshot);
  });
});
