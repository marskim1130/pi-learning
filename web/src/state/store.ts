// zustand 学习工作台 store：连接状态、session、pending interactions、transcript，
// 以及 SSE 事件处理（spec 9.3/9.4）。

import { create } from "zustand";

import { ApiError, client, getToken } from "../api/client";
import { interactionQuestion } from "../types/protocol";
import type {
  LearningInteraction,
  LearningSessionSnapshot,
  ResolvedAnswer
} from "../types/protocol";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface TranscriptEntry {
  id: string;
  kind: "submitted" | "tutor_message" | "tutor_status";
  interactionId?: string;
  type?: LearningInteraction["type"];
  question?: string;
  answerText?: string;
  role?: string;
  text?: string;
  /** 流式合并 key（server 透传的 messageId）；缺省为旧版消息，只能追加。 */
  messageId?: string;
  /** false = 流式中间帧，true = 最终帧（缺省视为 true，兼容旧 server）。 */
  done?: boolean;
  status?: string;
  time: number;
}

interface LearningWorkspaceState {
  status: ConnectionStatus;
  session: LearningSessionSnapshot | null;
  pending: LearningInteraction[];
  transcript: TranscriptEntry[];
  bootError: string | null;
  codeExecutionEnabled: boolean;

  connect: () => void;
  disconnect: () => void;
  /** 提交成功（POST 200 即已 resolved）：乐观移除 pending 并写入 transcript。 */
  submitSuccess: (
    interaction: LearningInteraction,
    answer: ResolvedAnswer,
    answerText: string
  ) => void;
  setBootError: (message: string) => void;
}

export const useLearningWorkspace = create<LearningWorkspaceState>()(
  (set, get) => ({
    status: "connecting",
    session: null,
    pending: [],
    transcript: [],
    bootError: null,
    codeExecutionEnabled: false,

    connect: () => {
      openEventSource();
    },
    disconnect: () => {
      closeEventSource();
      set({ status: "disconnected" });
    },
    submitSuccess: (interaction, answer, answerText) => {
      set((state) => ({
        pending: state.pending.filter((p) => p.id !== interaction.id),
        transcript: upsertSubmitted(
          state.transcript,
          interaction.id,
          answer,
          interaction,
          answerText
        )
      }));
    },
    setBootError: (message) => set({ bootError: message })
  })
);

/** 启动序列（spec 9.4）：health → session → pending → SSE。 */
export async function initialize(): Promise<void> {
  const token = getToken();
  if (token === null) {
    useLearningWorkspace.getState().setBootError(
      "未找到会话 token。请使用 /learn 或 /learn-open 提供的链接打开工作台。"
    );
    return;
  }
  try {
    const health = await client.health();
    if (!health.ok) {
      throw new Error("health check failed");
    }
    const [session, pending] = await Promise.all([
      client.getSession(),
      client.getPendingInteractions()
    ]);
    useLearningWorkspace.setState({
      session,
      pending,
      codeExecutionEnabled: health.codeExecutionEnabled
    });
  } catch {
    useLearningWorkspace.getState().setBootError(
      "无法连接本地学习服务。请确认 Pi 会话正在运行，并用带 token 的链接重新打开。"
    );
    return;
  }
  openEventSource();
}

let eventSource: EventSource | null = null;
let retryTimer: number | undefined;

function openEventSource(): void {
  const token = getToken();
  if (token === null) {
    return;
  }
  eventSource?.close();
  const es = new EventSource(
    `${window.location.origin}/api/events?token=${encodeURIComponent(token)}`
  );
  eventSource = es;

  es.addEventListener("open", () => {
    useLearningWorkspace.setState({ status: "connected" });
    // 重连成功后重新拉取（幂等：pending 为空就无事发生）。
    void refresh();
  });

  for (const name of [
    "interaction.presented",
    "interaction.resolved",
    "interaction.cancelled",
    "session.updated",
    "tutor.message",
    "tutor.status"
  ]) {
    es.addEventListener(name, handleSseEvent as EventListener);
  }

  es.onerror = () => {
    useLearningWorkspace.setState({ status: "disconnected" });
    // EventSource 自带重连；若 5s 仍未恢复，手动重建连接兜底。
    if (retryTimer !== undefined) {
      return;
    }
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      if (es.readyState !== EventSource.OPEN) {
        openEventSource();
      }
    }, 5000);
  };
}

function closeEventSource(): void {
  if (retryTimer !== undefined) {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  eventSource?.close();
  eventSource = null;
}

function handleSseEvent(event: MessageEvent): void {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(event.data as string) as Record<string, unknown>;
  } catch {
    return;
  }
  const store = useLearningWorkspace;
  switch (event.type) {
    case "interaction.presented":
      if (isInteraction(data.interaction)) {
        store.setState((state) => ({
          pending: upsertPending(state.pending, data.interaction as LearningInteraction)
        }));
      }
      break;
    case "interaction.resolved": {
      const interactionId = data.interactionId;
      if (typeof interactionId === "string" && isResolvedAnswer(data.answer)) {
        store.setState((state) => ({
          pending: state.pending.filter((p) => p.id !== interactionId),
          transcript: upsertSubmitted(
            state.transcript,
            interactionId,
            data.answer as ResolvedAnswer
          )
        }));
      }
      break;
    }
    case "interaction.cancelled": {
      const interactionId = data.interactionId;
      if (typeof interactionId === "string") {
        store.setState((state) => ({
          pending: state.pending.filter((p) => p.id !== interactionId)
        }));
      }
      break;
    }
    case "session.updated":
      if (isSession(data.session)) {
        store.setState({ session: data.session as LearningSessionSnapshot });
      }
      break;
    case "tutor.message": {
      const role = data.role;
      const text = data.text;
      if (typeof role === "string" && typeof text === "string") {
        const messageId =
          typeof data.messageId === "string" ? data.messageId : undefined;
        // 缺省视为最终帧：兼容旧 server（无 done/messageId 字段）。
        const done = data.done !== false;
        store.setState((state) => ({
          transcript: upsertTutorMessage(
            state.transcript,
            role,
            text,
            messageId,
            done
          )
        }));
      }
      break;
    }
    case "tutor.status": {
      const status = data.status;
      if (typeof status === "string") {
        store.setState((state) => ({
          transcript: [
            ...state.transcript,
            {
              id: crypto.randomUUID(),
              kind: "tutor_status",
              status,
              time: Date.now()
            }
          ]
        }));
      }
      break;
    }
    default:
      // 未知事件静默忽略（server 尚未发送的事件类型也在这里被吸收）。
      break;
  }
}

async function refresh(): Promise<void> {
  try {
    const [session, pending] = await Promise.all([
      client.getSession(),
      client.getPendingInteractions()
    ]);
    useLearningWorkspace.setState({ session, pending });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      useLearningWorkspace.getState().setBootError(
        "会话已失效，请使用带 token 的链接重新打开工作台。"
      );
    }
  }
}

function upsertPending(
  pending: LearningInteraction[],
  interaction: LearningInteraction
): LearningInteraction[] {
  const existing = pending.some((p) => p.id === interaction.id);
  return existing ? pending : [...pending, interaction];
}

/**
 * 流式合并（spec 26）：同 messageId 的帧原地替换 text（保留原 id），
 * done:true 直接替换/落定；无 messageId 的旧式消息按追加处理。
 */
function upsertTutorMessage(
  transcript: TranscriptEntry[],
  role: string,
  text: string,
  messageId: string | undefined,
  done: boolean
): TranscriptEntry[] {
  if (messageId !== undefined) {
    const existing = transcript.find(
      (t) => t.kind === "tutor_message" && t.messageId === messageId
    );
    if (existing !== undefined) {
      return transcript.map((t) =>
        t === existing
          ? { ...t, text, done, time: Date.now() }
          : t
      );
    }
  }
  return [
    ...transcript,
    {
      id: crypto.randomUUID(),
      kind: "tutor_message",
      role,
      text,
      messageId,
      done,
      time: Date.now()
    }
  ];
}

function upsertSubmitted(
  transcript: TranscriptEntry[],
  interactionId: string,
  answer: ResolvedAnswer,
  interaction?: LearningInteraction,
  answerText?: string
): TranscriptEntry[] {
  const existing = transcript.find(
    (t) => t.kind === "submitted" && t.interactionId === interactionId
  );
  if (existing !== undefined) {
    return transcript.map((t) =>
      t === existing
        ? {
            ...t,
            // resolved 事件可能先于 POST 响应到达，这里补上更友好的文案。
            ...(answerText === undefined ? {} : { answerText }),
            time: Date.now()
          }
        : t
    );
  }
  const entry: TranscriptEntry = {
    id: crypto.randomUUID(),
    kind: "submitted",
    interactionId,
    type: interaction?.type ?? answer.type,
    question: interaction === undefined ? undefined : interactionQuestion(interaction),
    answerText: answerText ?? describeResolvedAnswer(answer),
    time: Date.now()
  };
  return [...transcript, entry];
}

function describeResolvedAnswer(answer: ResolvedAnswer): string {
  if ("skipped" in answer) {
    return "已跳过此题";
  }
  switch (answer.type) {
    case "single_choice":
      return answer.answer.optionId;
    case "multi_choice":
      return answer.answer.optionIds.join(", ");
    case "free_response":
      return answer.answer.text;
    case "code":
      return `代码（${answer.answer.language}）已提交`;
  }
}

function isInteraction(value: unknown): value is LearningInteraction {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    (record.type === "single_choice" ||
      record.type === "multi_choice" ||
      record.type === "free_response" ||
      record.type === "code")
  );
}

function isResolvedAnswer(value: unknown): value is ResolvedAnswer {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.skipped === true) {
    return (
      typeof record.interactionId === "string" &&
      (record.type === "single_choice" || record.type === "multi_choice") &&
      typeof record.responseTimeMs === "number"
    );
  }
  return (
    typeof record.interactionId === "string" &&
    (record.type === "single_choice" ||
      record.type === "multi_choice" ||
      record.type === "free_response" ||
      record.type === "code") &&
    typeof record.answer === "object" &&
    record.answer !== null
  );
}

function isSession(value: unknown): value is LearningSessionSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.learningMode === "boolean" &&
    typeof record.phase === "string" &&
    Array.isArray(record.concepts)
  );
}
