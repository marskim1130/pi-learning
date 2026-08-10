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
import type { LearningServer } from "../extension/server/learning-server.js";
import { LearningStateStore } from "../extension/state/learning-state.js";

const MOCK_WORKSPACE_URL = "http://127.0.0.1:43210/?token=mock-token";

function createServerMock() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    url: vi.fn(() => MOCK_WORKSPACE_URL),
    hasWebClient: vi.fn(() => false),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

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
    const server = createServerMock();
    const notify = vi.fn();
    registerLearningCommands(pi, {
      state,
      broker: new InteractionBroker(),
      server: server as unknown as LearningServer,
      openWorkspace: vi.fn()
    });
    const ctx = {
      isIdle: () => true,
      ui: { notify }
    } as unknown as ExtensionCommandContext;

    await commands.get("learn")?.handler("rust generics", ctx);

    expect(state.snapshot()).toMatchObject({
      enabled: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "diagnosing"
    });
    expect(server.start).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(`Workspace: ${MOCK_WORKSPACE_URL}`),
      "info"
    );
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
    registerLearningCommands(pi, {
      state,
      broker,
      server: createServerMock() as unknown as LearningServer,
      openWorkspace: vi.fn()
    });

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
    registerLearningCommands(pi, {
      state,
      broker,
      server: createServerMock() as unknown as LearningServer,
      openWorkspace: vi.fn()
    });

    await commands.get("learn-stop")?.handler("", {
      ui: { notify: vi.fn() }
    } as unknown as ExtensionCommandContext);

    expect(state.snapshot()).toMatchObject({ enabled: false, phase: "idle" });
    expect(broker.getPending()).toEqual([]);
    await expect(pending).rejects.toMatchObject({
      name: "InteractionCancelledError"
    });
  });

  it("starts the server and opens the workspace from /learn-open", async () => {
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
    const server = createServerMock();
    const openWorkspace = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    registerLearningCommands(pi, {
      state: new LearningStateStore(),
      broker: new InteractionBroker(),
      server: server as unknown as LearningServer,
      openWorkspace
    });

    await commands.get("learn-open")?.handler("", {
      ui: { notify }
    } as unknown as ExtensionCommandContext);

    expect(server.start).toHaveBeenCalled();
    expect(openWorkspace).toHaveBeenCalledWith(MOCK_WORKSPACE_URL);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(MOCK_WORKSPACE_URL),
      "info"
    );
  });

  it("warns and skips the browser when the server fails to start", async () => {
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
    const server = createServerMock();
    server.start.mockRejectedValue(new Error("port in use"));
    const openWorkspace = vi.fn();
    const notify = vi.fn();
    registerLearningCommands(pi, {
      state: new LearningStateStore(),
      broker: new InteractionBroker(),
      server: server as unknown as LearningServer,
      openWorkspace
    });

    await commands.get("learn-open")?.handler("", {
      ui: { notify }
    } as unknown as ExtensionCommandContext);

    expect(openWorkspace).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("failed to start"),
      "warning"
    );
  });
});
