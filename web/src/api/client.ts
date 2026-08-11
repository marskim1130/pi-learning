// 本地学习服务 API client（spec 9.2）。token 优先从 URL query（index.html 已写入
// sessionStorage）读取；所有请求带 Authorization: Bearer。

import type {
  CodeRunResult,
  LearningInteraction,
  LearningSessionSnapshot,
  ResolvedAnswer
} from "../types/protocol";

const TOKEN_KEY = "pi_learning_token";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface HealthStatus {
  ok: boolean;
  codeExecutionEnabled: boolean;
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (token === null) {
    throw new ApiError(401, "未找到会话 token。");
  }
  let response: Response;
  try {
    response = await fetch(`${window.location.origin}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers
      }
    });
  } catch {
    throw new ApiError(0, "无法连接本地学习服务。");
  }
  if (response.status === 401) {
    throw new ApiError(401, "会话已失效，请使用带 token 的链接重新打开工作台。");
  }
  const body = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;
  if (!response.ok) {
    throw new ApiError(response.status, body?.message ?? `HTTP ${response.status}`);
  }
  return body as T;
}

/** 提交失败时给组件的用户可读文案。 */
export function describeSubmitError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "会话已失效，请使用带 token 的链接重新打开工作台。";
    }
    return error.message;
  }
  return "提交失败，请重试。";
}

/** 运行失败时给组件的用户可读文案。 */
export function describeRunError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "会话已失效，请使用带 token 的链接重新打开工作台。";
    }
    if (error.status === 503) {
      return "本机未安装该语言的运行环境（python / node）。";
    }
    return error.message;
  }
  return "运行失败，请重试。";
}

export const client = {
  async health(): Promise<HealthStatus> {
    const body = await request<{
      ok: boolean;
      capabilities?: { codeExecution?: boolean };
    }>("/api/health");
    return {
      ok: body.ok,
      codeExecutionEnabled: body.capabilities?.codeExecution === true
    };
  },

  async getSession(): Promise<LearningSessionSnapshot> {
    return request<LearningSessionSnapshot>("/api/session");
  },

  async getPendingInteractions(): Promise<LearningInteraction[]> {
    const body = await request<{ interactions: LearningInteraction[] }>(
      "/api/interactions/pending"
    );
    return body.interactions;
  },

  async submit(
    interactionId: string,
    answer: unknown
  ): Promise<{ ok: true; answer: ResolvedAnswer }> {
    return request<{ ok: true; answer: ResolvedAnswer }>(
      `/api/interactions/${encodeURIComponent(interactionId)}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionId,
          answer,
          clientTimestamp: Date.now()
        })
      }
    );
  },

  /** 规格 25：本地自测运行，结果只回给学习者，不提交答案。 */
  async runCode(language: string, code: string): Promise<CodeRunResult> {
    const body = await request<{ ok: true; result: CodeRunResult }>(
      "/api/code/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code })
      }
    );
    return body.result;
  }
};
