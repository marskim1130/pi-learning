import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Subset of LearningServer used by transcript sync (spec 26). */
export interface TranscriptSyncServer {
  broadcastTutorMessage(
    role: "assistant",
    text: string,
    messageId: string | undefined,
    done: boolean
  ): void;
  broadcastTutorStatus(status: "waiting" | "idle", toolName?: string): void;
}

/** Injectable scheduler/clock for throttling tests. */
export interface TranscriptSyncOptions {
  throttleMs?: number;
  /** Opaque timer handle (number in browsers/tests, NodeJS.Timeout in Node). */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/**
 * Extract the learner-visible assistant text from a message (spec 26).
 * Only role === "assistant" messages qualify; string content is used as-is,
 * array content is concatenated from `text` parts only (images and other
 * parts are skipped). Returns undefined for non-assistant or non-text
 * content. Reasoning/thinking is never part of the visible text.
 */
export function extractAssistantText(message: {
  role?: string;
  content?: unknown;
}): string | undefined {
  if (message.role !== "assistant") {
    return undefined;
  }
  const { content } = message;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text)
    .join("");
  return text;
}

/**
 * Key a pi message for streaming correlation. AgentMessage has no id field;
 * AssistantMessage.responseId is the provider response id, stable across all
 * message_update/message_end frames of one streamed response. When absent,
 * fall back to the current streaming key (set by message_update) or a local
 * per-sync sequence — Pi delivers one message's events sequentially, so the
 * end frame always follows the updates of the same message.
 */
function messageKey(responseId: unknown, current: string | undefined): string {
  if (typeof responseId === "string" && responseId !== "") {
    return responseId;
  }
  return current ?? "";
}

/**
 * Sync the tutor's visible transcript to web clients (spec 26): streamed
 * assistant text on message_update (throttled), final text on message_end,
 * learning-tool waiting status, and idle signals.
 *
 * Ordering guarantee: the done:true frame for a messageId is always last.
 * On message_end any throttled-but-unflushed partial frame for that message
 * is dropped (the final frame carries the complete text, so the client
 * converges to the same content — simpler than force-flushing).
 */
export function registerTranscriptSync(
  pi: ExtensionAPI,
  server: TranscriptSyncServer,
  options: TranscriptSyncOptions = {}
): void {
  const throttleMs = options.throttleMs ?? 100;
  const schedule: (fn: () => void, ms: number) => unknown =
    options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel: (handle: unknown) => void =
    options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));

  // ponytail: single in-flight streaming message tracked; Pi streams one
  // message at a time, per-message trackers only if concurrency appears.
  let currentKey: string | undefined;
  let pendingText: string | undefined;
  let pendingKey: string | undefined;
  let timer: unknown;
  let seq = 0;

  function flush(): void {
    timer = undefined;
    if (pendingKey !== undefined && pendingText !== undefined) {
      server.broadcastTutorMessage("assistant", pendingText, pendingKey, false);
    }
    pendingKey = undefined;
    pendingText = undefined;
  }

  pi.on("message_update", (event) => {
    const text = extractAssistantText(event.message);
    if (text === undefined || text.trim() === "") {
      return;
    }
    let key = messageKey(
      (event.message as { responseId?: unknown }).responseId,
      currentKey
    );
    if (key === "") {
      key = `msg-${++seq}`;
    }
    currentKey = key;
    // 节流窗口内只保留最新文本，flush 时广播一帧。
    pendingKey = key;
    pendingText = text;
    if (timer === undefined) {
      timer = schedule(flush, throttleMs);
    }
  });

  pi.on("message_end", (event) => {
    const text = extractAssistantText(event.message);
    if (text === undefined || text.trim() === "") {
      // 无可见文本：丢弃未 flush 的流式帧（终帧也不发）。
      if (timer !== undefined) {
        cancel(timer);
        timer = undefined;
      }
      pendingKey = undefined;
      pendingText = undefined;
      currentKey = undefined;
      return;
    }
    const key = messageKey(
      (event.message as { responseId?: unknown }).responseId,
      currentKey
    );
    const messageId = key === "" ? `msg-${++seq}` : key;
    // 终帧携带完整文本：取消未 flush 的节流帧，保证 done:true 最后到达。
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    pendingKey = undefined;
    pendingText = undefined;
    currentKey = undefined;
    server.broadcastTutorMessage("assistant", text, messageId, true);
  });

  pi.on("tool_execution_start", (event) => {
    if (event.toolName.startsWith("learning_")) {
      server.broadcastTutorStatus("waiting", event.toolName);
    }
  });

  pi.on("tool_execution_end", () => {
    server.broadcastTutorStatus("idle");
  });

  pi.on("agent_settled", () => {
    server.broadcastTutorStatus("idle");
  });
}
