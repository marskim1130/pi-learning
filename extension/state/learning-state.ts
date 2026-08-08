import type {
  AttemptSummary,
  ConceptState,
  LearningCourse,
  LearningState,
  LearningTopic,
  LearningPhase
} from "./types.js";

export interface StartLearningInput {
  course: LearningCourse;
  topic: LearningTopic;
}

export class LearningStateStore {
  private state: LearningState = {
    enabled: false,
    phase: "idle",
    concepts: {},
    recentAttempts: []
  };

  snapshot(): LearningState {
    return structuredClone(this.state);
  }

  restore(candidate: unknown): boolean {
    if (!isLearningState(candidate)) {
      return false;
    }

    this.state = structuredClone(candidate);
    return true;
  }

  start(input: StartLearningInput): void {
    this.state = {
      ...this.state,
      enabled: true,
      course: { ...input.course },
      topic: { ...input.topic },
      phase: "diagnosing"
    };
  }

  stop(): void {
    this.state = {
      ...this.state,
      enabled: false,
      phase: "idle"
    };
  }
}

const phases: readonly LearningPhase[] = [
  "idle",
  "diagnosing",
  "explaining",
  "checking",
  "practicing",
  "reviewing"
];

function isLearningState(value: unknown): value is LearningState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.enabled === "boolean" &&
    typeof value.phase === "string" &&
    phases.includes(value.phase as LearningPhase) &&
    isOptionalCourseOrTopic(value.course) &&
    isOptionalCourseOrTopic(value.topic) &&
    isConceptMap(value.concepts) &&
    Array.isArray(value.recentAttempts) &&
    value.recentAttempts.every(isAttemptSummary)
  );
}

function isOptionalCourseOrTopic(value: unknown): boolean {
  return value === undefined || isCourseOrTopic(value);
}

function isCourseOrTopic(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title)
  );
}

function isConceptMap(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isConceptState);
}

function isConceptState(value: unknown): value is ConceptState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isBoundedNumber(value.mastery, 0, 1) &&
    isNonNegativeInteger(value.attempts) &&
    isNonNegativeInteger(value.correct) &&
    (value.lastPracticedAt === undefined ||
      (typeof value.lastPracticedAt === "number" &&
        Number.isFinite(value.lastPracticedAt))) &&
    Array.isArray(value.misconceptions) &&
    value.misconceptions.every((item) => typeof item === "string")
  );
}

function isAttemptSummary(value: unknown): value is AttemptSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.interactionId) &&
    isNonEmptyString(value.conceptId) &&
    (value.outcome === "correct" ||
      value.outcome === "partial" ||
      value.outcome === "incorrect") &&
    (value.evidenceType === "choice" ||
      value.evidenceType === "free_response" ||
      value.evidenceType === "code") &&
    (value.misconception === undefined ||
      typeof value.misconception === "string") &&
    typeof value.recordedAt === "number" &&
    Number.isFinite(value.recordedAt)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
