import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  SessionEntry,
  SessionStartEvent
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { LearningStateStore } from "../extension/state/learning-state.js";
import {
  registerLearningStatePersistence,
  restoreLearningStateFromEntries
} from "../extension/state/session-persistence.js";

describe("learning session persistence", () => {
  it("restores the latest valid learning-state entry from the active branch", () => {
    const state = new LearningStateStore();
    const entries = [
      {
        type: "custom" as const,
        id: "entry-1",
        parentId: null,
        timestamp: "2026-08-08T00:00:00.000Z",
        customType: "learning-state",
        data: {
          version: 1,
          state: {
            enabled: true,
            course: { id: "rust", title: "Rust" },
            topic: { id: "ownership", title: "Ownership" },
            phase: "diagnosing" as const,
            concepts: {},
            recentAttempts: []
          }
        }
      },
      {
        type: "custom" as const,
        id: "entry-2",
        parentId: "entry-1",
        timestamp: "2026-08-08T00:01:00.000Z",
        customType: "learning-state",
        data: {
          version: 1,
          state: {
            enabled: true,
            course: { id: "rust", title: "Rust" },
            topic: { id: "generics", title: "Generics" },
            phase: "checking" as const,
            concepts: {},
            recentAttempts: []
          }
        }
      }
    ] satisfies SessionEntry[];

    expect(restoreLearningStateFromEntries(state, entries)).toBe(true);
    expect(state.snapshot()).toMatchObject({
      topic: { id: "generics", title: "Generics" },
      phase: "checking"
    });
  });

  it("restores state from the current branch when a Pi session starts", async () => {
    let sessionStart: ExtensionHandler<SessionStartEvent> | undefined;
    const pi = {
      on: (
        event: string,
        handler: ExtensionHandler<SessionStartEvent>
      ) => {
        if (event === "session_start") {
          sessionStart = handler;
        }
      }
    } as unknown as ExtensionAPI;
    const state = new LearningStateStore();
    const getBranch = vi.fn(() => [
      {
        type: "custom" as const,
        id: "entry-resume",
        parentId: null,
        timestamp: "2026-08-08T00:00:00.000Z",
        customType: "learning-state",
        data: {
          version: 1,
          state: {
            enabled: true,
            course: { id: "rust", title: "Rust" },
            topic: { id: "lifetimes", title: "Lifetimes" },
            phase: "practicing" as const,
            concepts: {},
            recentAttempts: []
          }
        }
      }
    ] satisfies SessionEntry[]);
    registerLearningStatePersistence(pi, state);

    await sessionStart?.(
      { type: "session_start", reason: "resume" },
      { sessionManager: { getBranch } } as unknown as ExtensionContext
    );

    expect(getBranch).toHaveBeenCalledOnce();
    expect(state.snapshot()).toMatchObject({
      enabled: true,
      topic: { id: "lifetimes", title: "Lifetimes" },
      phase: "practicing"
    });
  });
});
