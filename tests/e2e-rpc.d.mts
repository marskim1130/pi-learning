/**
 * Type declarations for tests/e2e-rpc.mjs, so the Playwright spec
 * (tests/e2e-browser.spec.ts) typechecks under the root tsconfig.
 */
export interface RpcSessionOptions {
  cwd: string;
  env: Record<string, string>;
  extraArgs: string[];
}

export type JsonRpcEvent = Record<string, unknown> & { type: string };

export declare class RpcSession {
  constructor(options: RpcSessionOptions);
  eventLog: JsonRpcEvent[];
  stderr: string;
  exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null;
  start(): void;
  onEvent(listener: (event: JsonRpcEvent) => void): void;
  command<T = unknown>(obj: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  sendUiResponse(requestId: string, payload: Record<string, unknown>): void;
  waitForEvent(
    predicate: (event: JsonRpcEvent) => boolean,
    opts?: { timeout?: number; label?: string; since?: number }
  ): Promise<JsonRpcEvent>;
  prompt(
    text: string,
    opts?: { streamingBehavior?: "steer" | "followUp" }
  ): Promise<unknown>;
  getCommands(): Promise<{ commands: Array<{ name: string }> } | Array<{ name: string }>>;
  stop(opts?: { graceMs?: number }): Promise<void>;
}

export interface PendingInteraction {
  id: string;
  type: "single_choice" | "multi_choice" | "free_response" | "code";
  question?: string;
  instructions?: string;
  language?: string;
  starterCode?: string;
  options?: Array<{ id: string; label: string }>;
  [key: string]: unknown;
}

export declare class LearningApi {
  constructor(baseUrl: string, token: string);
  session(): Promise<Record<string, unknown>>;
  pending(): Promise<PendingInteraction[]>;
  submit(
    interactionId: string,
    answer: unknown
  ): Promise<{ ok: boolean; status: number; body: unknown }>;
}

export declare const WORKSPACE_URL_PATTERN: RegExp;
export declare const LEARNING_TOOL_ALLOWLIST: string[];
export declare function captureWorkspaceUrl(
  eventLog: JsonRpcEvent[]
): string | undefined;
export declare function makeApiFactory(rpc: RpcSession): () => LearningApi;
export declare function isQuestionTool(name: string): boolean;
export declare function buildAnswer(
  interaction: PendingInteraction,
  opts?: { wrong?: boolean }
): unknown;
