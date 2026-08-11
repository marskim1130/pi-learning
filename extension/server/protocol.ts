export interface ChoiceOption {
  id: string;
  label: string;
}

export interface SingleChoiceInteraction {
  id: string;
  type: "single_choice";
  title?: string;
  question: string;
  options: ChoiceOption[];
  conceptId?: string;
  allowSkip: boolean;
  createdAt: number;
}

export interface SingleChoiceAnswer {
  optionId: string;
}

export interface MultiChoiceInteraction {
  id: string;
  type: "multi_choice";
  title?: string;
  question: string;
  options: ChoiceOption[];
  conceptId?: string;
  allowSkip: boolean;
  createdAt: number;
}

export interface MultiChoiceAnswer {
  optionIds: string[];
}

export interface FreeResponseInteraction {
  id: string;
  type: "free_response";
  question: string;
  placeholder?: string;
  multiline: boolean;
  conceptId?: string;
  createdAt: number;
}

export interface FreeResponseAnswer {
  text: string;
}

export interface CodeExerciseInteraction {
  id: string;
  type: "code";
  title?: string;
  instructions: string;
  language: string;
  starterCode: string;
  readOnlyRanges?: Array<{ start: number; end: number }>;
  conceptId?: string;
  createdAt: number;
}

export interface CodeExerciseAnswer {
  language: string;
  code: string;
}

export type LearningInteraction =
  | SingleChoiceInteraction
  | MultiChoiceInteraction
  | FreeResponseInteraction
  | CodeExerciseInteraction;

export interface SingleChoiceResolvedAnswer {
  interactionId: string;
  type: "single_choice";
  answer: SingleChoiceAnswer;
  responseTimeMs: number;
}

export interface MultiChoiceResolvedAnswer {
  interactionId: string;
  type: "multi_choice";
  answer: MultiChoiceAnswer;
  responseTimeMs: number;
}

export interface FreeResponseResolvedAnswer {
  interactionId: string;
  type: "free_response";
  answer: FreeResponseAnswer;
  responseTimeMs: number;
}

export interface CodeExerciseResolvedAnswer {
  interactionId: string;
  type: "code";
  answer: CodeExerciseAnswer;
  responseTimeMs: number;
}

/**
 * Structured skip answer (spec 7.5 allowSkip): the learner declined the
 * question. Only single/multi choice interactions carry allowSkip; the type
 * mirrors the pending interaction's type.
 */
export interface SkippedResolvedAnswer {
  interactionId: string;
  type: "single_choice" | "multi_choice";
  skipped: true;
  responseTimeMs: number;
}

export type ResolvedAnswer =
  | SingleChoiceResolvedAnswer
  | MultiChoiceResolvedAnswer
  | FreeResponseResolvedAnswer
  | CodeExerciseResolvedAnswer
  | SkippedResolvedAnswer;

export interface InteractionSubmission {
  interactionId: string;
  answer: unknown;
  clientTimestamp: number;
}

export type SubmitResult =
  | { ok: true; answer: ResolvedAnswer }
  | {
      ok: false;
      reason: "not_found" | "already_resolved" | "invalid_answer" | "skip_not_allowed";
      message: string;
    };

// --- Server-sent events (spec 7.1) ---

import type {
  ConceptState,
  LearningCourse,
  LearningPhase,
  LearningTopic
} from "../state/types.js";

/** Shape of GET /api/session and the session.updated SSE event. */
export interface LearningSessionSnapshot {
  learningMode: boolean;
  course?: LearningCourse;
  topic?: LearningTopic;
  phase: LearningPhase;
  /** Array in insertion order of the state's concept map. */
  concepts: ConceptState[];
}

export interface InteractionPresentedEvent {
  event: "interaction.presented";
  interaction: LearningInteraction;
}

export interface InteractionResolvedEvent {
  event: "interaction.resolved";
  interactionId: string;
  answer: ResolvedAnswer;
}

export interface InteractionCancelledEvent {
  event: "interaction.cancelled";
  interactionId: string;
  reason: string;
}

export interface SessionUpdatedEvent {
  event: "session.updated";
  session: LearningSessionSnapshot;
}

/** Corresponds to spec 7.1's ErrorEvent. */
export interface LearningErrorEvent {
  event: "error";
  message: string;
}

/**
 * Tutor's visible assistant text (spec 26; only text, never reasoning).
 * Streaming: done=false frames carry partial text keyed by messageId;
 * the final done=true frame replaces them. Compatible with pre-streaming
 * clients (they ignore messageId/done and append every frame).
 */
export interface TutorMessageEvent {
  event: "tutor.message";
  role: "assistant";
  text: string;
  /** Stable per pi message: AssistantMessage.responseId, or a local seq fallback. */
  messageId?: string;
  /** false = streaming partial frame; true = final text. */
  done: boolean;
}

/** Tutor waiting for the learner (learning tool running) or idle (spec 26). */
export interface TutorStatusEvent {
  event: "tutor.status";
  status: "waiting" | "idle";
  toolName?: string;
}

export type LearningEvent =
  | InteractionPresentedEvent
  | InteractionResolvedEvent
  | InteractionCancelledEvent
  | SessionUpdatedEvent
  | LearningErrorEvent
  | TutorMessageEvent
  | TutorStatusEvent;

// --- Code runner (spec 25) ---

/**
 * Local code-run request. Only the runner's language whitelist is accepted;
 * the command template is defined by the program, never by the learner.
 */
export interface CodeRunRequest {
  language: string;
  code: string;
  /** Optional override of the default 8s timeout (server clamps to 100..30000). */
  timeoutMs?: number;
}

/** Result of a local code run; shown only to the learner, never a tool result. */
export interface CodeRunResult {
  /** null when the process was killed before exiting (timeout/abort). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** True when stdout/stderr hit the 64KB cap and were truncated. */
  truncated: boolean;
}
