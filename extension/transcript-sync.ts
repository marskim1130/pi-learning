import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Subset of LearningServer used by transcript sync (spec 26). */
export interface TranscriptSyncServer {
  broadcastTutorMessage(role: "assistant", text: string): void;
  broadcastTutorStatus(status: "waiting" | "idle", toolName?: string): void;
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
 * Sync the tutor's visible transcript to web clients (spec 26): final
 * assistant text on message_end, learning-tool waiting status, and idle
 * signals. Deliberately does not subscribe to message_update — streaming
 * display can be added later once correctness is proven.
 */
export function registerTranscriptSync(
  pi: ExtensionAPI,
  server: TranscriptSyncServer
): void {
  pi.on("message_end", (event) => {
    const text = extractAssistantText(event.message);
    if (text === undefined || text.trim() === "") {
      return;
    }
    server.broadcastTutorMessage("assistant", text);
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
