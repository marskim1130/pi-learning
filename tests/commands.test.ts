import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  parseLearningTarget,
  registerLearningCommands
} from "../extension/commands.js";
import { InteractionBroker } from "../extension/server/interaction-broker.js";
import { LearningStateStore } from "../extension/state/learning-state.js";

describe("learning commands", () => {
  it("parses /learn rust generics into course and topic", () => {
    expect(parseLearningTarget("rust generics")).toEqual({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });
  });

  it("enables learning and sends a tutor kickoff from /learn", async () => {
    const commands = new Map<
      string,
      Omit<RegisteredCommand, "name" | "sourceInfo">
    >();
    const sendUserMessage = vi.fn();
    const pi = {
      registerCommand: (
        name: string,
        command: Omit<RegisteredCommand, "name" | "sourceInfo">
      ) => commands.set(name, command),
      sendUserMessage,
      setSessionName: vi.fn(),
      appendEntry: vi.fn()
    } as unknown as ExtensionAPI;
    const state = new LearningStateStore();
    registerLearningCommands(pi, {
      state,
      broker: new InteractionBroker()
    });
    const ctx = {
      isIdle: () => true,
      ui: { notify: vi.fn() }
    } as unknown as ExtensionCommandContext;

    await commands.get("learn")?.handler("rust generics", ctx);

    expect(state.snapshot()).toMatchObject({
      enabled: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "diagnosing"
    });
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Rust / Generics")
    );
  });

  it("reports learning status without inventing a workspace URL", async () => {
    const commands = new Map<
      string,
      Omit<RegisteredCommand, "name" | "sourceInfo">
    >();
    const pi = {
      registerCommand: (
        name: string,
        command: Omit<RegisteredCommand, "name" | "sourceInfo">
      ) => commands.set(name, command)
    } as unknown as ExtensionAPI;
    const state = new LearningStateStore();
    state.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });
    const broker = new InteractionBroker();
    const notify = vi.fn();
    registerLearningCommands(pi, { state, broker });

    await commands.get("learn-status")?.handler("", {
      ui: { notify }
    } as unknown as ExtensionCommandContext);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Learning Mode: ON"),
      "info"
    );
    expect(notify.mock.calls[0]?.[0]).toContain("Course: Rust");
    expect(notify.mock.calls[0]?.[0]).toContain("Topic: Generics");
    expect(notify.mock.calls[0]?.[0]).not.toContain("Workspace:");
  });

  it("stops learning and cancels pending interactions", async () => {
    const commands = new Map<
      string,
      Omit<RegisteredCommand, "name" | "sourceInfo">
    >();
    const pi = {
      registerCommand: (
        name: string,
        command: Omit<RegisteredCommand, "name" | "sourceInfo">
      ) => commands.set(name, command),
      appendEntry: vi.fn()
    } as unknown as ExtensionAPI;
    const state = new LearningStateStore();
    state.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });
    const broker = new InteractionBroker();
    const pending = broker.present({
      id: "q_stop",
      type: "single_choice",
      question: "Pending",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    });
    registerLearningCommands(pi, { state, broker });

    await commands.get("learn-stop")?.handler("", {
      ui: { notify: vi.fn() }
    } as unknown as ExtensionCommandContext);

    expect(state.snapshot()).toMatchObject({ enabled: false, phase: "idle" });
    expect(broker.getPending()).toEqual([]);
    await expect(pending).rejects.toMatchObject({
      name: "InteractionCancelledError"
    });
  });
});
