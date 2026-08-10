import type { ExtensionAPI, ExtensionHandler } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  extractAssistantText,
  registerTranscriptSync,
  type TranscriptSyncServer
} from "../extension/transcript-sync.js";

function createMockPi() {
  const handlers = new Map<string, ExtensionHandler<any, any>>();
  const pi = {
    on: (event: string, handler: ExtensionHandler<any, any>) => {
      handlers.set(event, handler);
    }
  } as unknown as ExtensionAPI;
  const emit = (event: string, payload: unknown): void => {
    const handler = handlers.get(event);
    if (handler === undefined) {
      throw new Error(`No handler registered for ${event}`);
    }
    void handler(payload, {} as never);
  };
  return { pi, emit };
}

function createSpyServer() {
  const server: TranscriptSyncServer = {
    broadcastTutorMessage: vi.fn(),
    broadcastTutorStatus: vi.fn()
  };
  return server;
}

describe("extractAssistantText", () => {
  it("returns string content of assistant messages as-is", () => {
    expect(extractAssistantText({ role: "assistant", content: "Hello" })).toBe(
      "Hello"
    );
  });

  it("concatenates only text parts of array content, skipping images", () => {
    expect(
      extractAssistantText({
        role: "assistant",
        content: [
          { type: "text", text: "First " },
          { type: "image", image: {} },
          { type: "text", text: "second." }
        ]
      })
    ).toBe("First second.");
  });

  it("returns undefined for non-assistant roles", () => {
    expect(extractAssistantText({ role: "user", content: "hi" })).toBeUndefined();
    expect(extractAssistantText({ role: "toolResult", content: "x" })).toBeUndefined();
  });

  it("returns undefined for non-string non-array content", () => {
    expect(extractAssistantText({ role: "assistant", content: 42 })).toBeUndefined();
  });

  it("returns the raw string when the string is empty (caller skips broadcast)", () => {
    expect(extractAssistantText({ role: "assistant", content: "" })).toBe("");
  });
});

describe("registerTranscriptSync", () => {
  it("broadcasts assistant message_end text", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("message_end", { type: "message_end", message: { role: "assistant", content: "Final answer." } });

    expect(server.broadcastTutorMessage).toHaveBeenCalledWith(
      "assistant",
      "Final answer."
    );
  });

  it("broadcasts joined text parts from array content", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Part " },
          { type: "image", image: {} },
          { type: "text", text: "two" }
        ]
      }
    });

    expect(server.broadcastTutorMessage).toHaveBeenCalledWith("assistant", "Part two");
  });

  it("does not broadcast non-assistant message_end", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("message_end", { type: "message_end", message: { role: "user", content: "hi" } });
    emit("message_end", { type: "message_end", message: { role: "toolResult", content: "ok" } });

    expect(server.broadcastTutorMessage).not.toHaveBeenCalled();
  });

  it("does not broadcast empty text (pure reasoning / no visible text)", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("message_end", { type: "message_end", message: { role: "assistant", content: "" } });

    expect(server.broadcastTutorMessage).not.toHaveBeenCalled();
  });

  it("does not broadcast whitespace-only text", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("message_end", { type: "message_end", message: { role: "assistant", content: "   \n\t  " } });

    expect(server.broadcastTutorMessage).not.toHaveBeenCalled();
  });

  it("broadcasts waiting only for learning_ tools on tool_execution_start", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "learning_ask_single_choice",
      args: {}
    });
    emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "t2",
      toolName: "read",
      args: {}
    });

    expect(server.broadcastTutorStatus).toHaveBeenCalledTimes(1);
    expect(server.broadcastTutorStatus).toHaveBeenCalledWith(
      "waiting",
      "learning_ask_single_choice"
    );
  });

  it("broadcasts idle on tool_execution_end regardless of tool", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "learning_ask_single_choice",
      result: {},
      isError: false
    });

    expect(server.broadcastTutorStatus).toHaveBeenCalledWith("idle");
  });

  it("broadcasts idle on agent_settled", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("agent_settled", { type: "agent_settled" });

    expect(server.broadcastTutorStatus).toHaveBeenCalledWith("idle");
  });
});
