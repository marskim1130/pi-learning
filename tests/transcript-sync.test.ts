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

/** 虚拟时钟：setTimeout/clearTimeout 注入点，配合 throttleMs 做确定性测试。 */
function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeoutFn: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeoutFn: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance(ms: number): void {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size
  };
}

function messageUpdate(
  responseId: string | undefined,
  content: unknown,
  role = "assistant"
) {
  return {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta" },
    message: {
      role,
      content,
      ...(responseId === undefined ? {} : { responseId })
    }
  };
}

function messageEnd(responseId: string | undefined, content: unknown, role = "assistant") {
  return {
    type: "message_end",
    message: {
      role,
      content,
      ...(responseId === undefined ? {} : { responseId })
    }
  };
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

    emit("message_end", messageEnd("resp-1", "Final answer."));

    expect(server.broadcastTutorMessage).toHaveBeenCalledWith(
      "assistant",
      "Final answer.",
      "resp-1",
      true
    );
  });

  it("broadcasts joined text parts from array content", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    registerTranscriptSync(pi, server);

    emit("message_end", messageEnd("resp-2", [
      { type: "text", text: "Part " },
      { type: "image", image: {} },
      { type: "text", text: "two" }
    ]));

    expect(server.broadcastTutorMessage).toHaveBeenCalledWith(
      "assistant",
      "Part two",
      "resp-2",
      true
    );
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

  it("throttles message_update to the latest text per window (done:false)", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    const clock = createFakeClock();
    registerTranscriptSync(pi, server, {
      throttleMs: 100,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    emit("message_update", messageUpdate("resp-s1", "A"));
    emit("message_update", messageUpdate("resp-s1", "AB"));
    emit("message_update", messageUpdate("resp-s1", "ABC"));
    expect(server.broadcastTutorMessage).not.toHaveBeenCalled();

    clock.advance(100);
    expect(server.broadcastTutorMessage).toHaveBeenCalledTimes(1);
    expect(server.broadcastTutorMessage).toHaveBeenCalledWith(
      "assistant",
      "ABC",
      "resp-s1",
      false
    );
  });

  it("message_end broadcasts done:true and drops the unflushed throttled frame", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    const clock = createFakeClock();
    registerTranscriptSync(pi, server, {
      throttleMs: 100,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    emit("message_update", messageUpdate("resp-s2", "part"));
    emit("message_end", messageEnd("resp-s2", "complete"));

    expect(server.broadcastTutorMessage).toHaveBeenCalledTimes(1);
    expect(server.broadcastTutorMessage).toHaveBeenCalledWith(
      "assistant",
      "complete",
      "resp-s2",
      true
    );
    // 被取消的节流帧不得在终帧之后到达（顺序保证）。
    clock.advance(500);
    expect(server.broadcastTutorMessage).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast empty/whitespace message_update text", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    const clock = createFakeClock();
    registerTranscriptSync(pi, server, {
      throttleMs: 100,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    emit("message_update", messageUpdate("resp-s3", ""));
    emit("message_update", messageUpdate("resp-s3", "   \n  "));
    clock.advance(100);
    expect(server.broadcastTutorMessage).not.toHaveBeenCalled();
  });

  it("does not broadcast non-assistant message_update", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    const clock = createFakeClock();
    registerTranscriptSync(pi, server, {
      throttleMs: 100,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    emit("message_update", messageUpdate("resp-s4", "hi", "user"));
    emit("message_update", messageUpdate("resp-s4", "ok", "toolResult"));
    clock.advance(100);
    expect(server.broadcastTutorMessage).not.toHaveBeenCalled();
  });

  it("falls back to a local seq key when responseId is absent, correlated across frames", () => {
    const { pi, emit } = createMockPi();
    const server = createSpyServer();
    const clock = createFakeClock();
    registerTranscriptSync(pi, server, {
      throttleMs: 100,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    emit("message_update", messageUpdate(undefined, "x"));
    emit("message_end", messageEnd(undefined, "xyz"));

    // 终帧覆盖未 flush 的流式帧；两者 messageId 相同（seq 兜底）。
    expect(server.broadcastTutorMessage).toHaveBeenCalledTimes(1);
    expect(server.broadcastTutorMessage).toHaveBeenCalledWith(
      "assistant",
      "xyz",
      "msg-1",
      true
    );
  });
});
