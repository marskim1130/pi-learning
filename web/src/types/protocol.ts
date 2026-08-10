// 与 extension/server/protocol.ts 对应的前端类型（手写对齐，避免前端依赖扩展代码）。

export type LearningPhase =
  | "idle"
  | "diagnosing"
  | "explaining"
  | "checking"
  | "practicing"
  | "reviewing";

export interface LearningCourse {
  id: string;
  title: string;
}

export interface LearningTopic {
  id: string;
  title: string;
}

export interface ConceptState {
  id: string;
  title: string;
  mastery: number;
  attempts: number;
  correct: number;
  lastPracticedAt?: number;
  misconceptions: string[];
  recentOutcomes?: Array<{
    outcome: "correct" | "partial" | "incorrect";
    evidenceType: "choice" | "free_response" | "code";
  }>;
}

/** Shape of GET /api/session 与 session.updated SSE 事件。 */
export interface LearningSessionSnapshot {
  learningMode: boolean;
  course?: LearningCourse;
  topic?: LearningTopic;
  phase: LearningPhase;
  concepts: ConceptState[];
}

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

export interface FreeResponseInteraction {
  id: string;
  type: "free_response";
  question: string;
  placeholder?: string;
  multiline: boolean;
  conceptId?: string;
  createdAt: number;
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

export type LearningInteraction =
  | SingleChoiceInteraction
  | MultiChoiceInteraction
  | FreeResponseInteraction
  | CodeExerciseInteraction;

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

export interface FreeResponseAnswer {
  text: string;
}

export interface CodeExerciseAnswer {
  language: string;
  code: string;
}

/** 本地代码 runner 结果（规格 25；与 extension/server/protocol.ts 对齐）。 */
export interface CodeRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
}

export type LearningAnswer =
  | SingleChoiceAnswer
  | MultiChoiceAnswer
  | FreeResponseAnswer
  | CodeExerciseAnswer;

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

export type ResolvedAnswer =
  | SingleChoiceResolvedAnswer
  | MultiChoiceResolvedAnswer
  | FreeResponseResolvedAnswer
  | CodeExerciseResolvedAnswer;

/** 题目文本，用于 transcript 展示。 */
export function interactionQuestion(interaction: LearningInteraction): string {
  switch (interaction.type) {
    case "single_choice":
      return interaction.question;
    case "multi_choice":
      return interaction.question;
    case "free_response":
      return interaction.question;
    case "code":
      return interaction.instructions;
  }
}
