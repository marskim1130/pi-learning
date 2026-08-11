import type {
  AttemptOutcome,
  AttemptSummary,
  ConceptState,
  EvidenceType,
  LearningCourse,
  LearningState,
  LearningTopic,
  LearningPhase,
  RecentOutcome
} from "./types.js";

export interface StartLearningInput {
  course: LearningCourse;
  topic: LearningTopic;
}

/**
 * Application-layer phase transition events (spec 15). The model decides the
 * teaching, the app only records the current phase label: transitions fire
 * from /learn, question presentation (broker.onPresented) and recorded
 * attempts.
 */
export type PhaseEvent =
  | { type: "start" }
  | { type: "stop" }
  | { type: "question_presented" }
  | { type: "attempt_recorded"; outcome: AttemptOutcome };

/**
 * Pure phase transition table (spec 15). Deliberately coarse:
 * - start → diagnosing
 * - stop → idle
 * - question_presented: explaining → checking; other phases keep their label
 *   (diagnosing questions stay diagnosing, application stays practicing)
 * - attempt_recorded: correct → practicing, incorrect → diagnosing
 *   (misconception loop), partial keeps the current phase
 * reviewing is not auto-reached by any event yet (no /learn-review trigger);
 * it survives only via state restore/persistence.
 */
export function nextPhase(phase: LearningPhase, event: PhaseEvent): LearningPhase {
  switch (event.type) {
    case "start":
      return "diagnosing";
    case "stop":
      return "idle";
    case "question_presented":
      return phase === "explaining" ? "checking" : phase;
    case "attempt_recorded":
      if (event.outcome === "correct") {
        return "practicing";
      }
      return event.outcome === "incorrect" ? "diagnosing" : phase;
  }
}

export interface RecordAttemptInput {
  interactionId: string;
  conceptId: string;
  outcome: AttemptOutcome;
  evidenceType: EvidenceType;
  misconception?: string;
}

export interface LearningStateStoreOptions {
  /** Invoked after every state mutation (start/stop/recordAttempt) with the post-change snapshot. */
  onChange?: (snapshot: LearningState) => void;
}

/** Initial mastery for a newly created concept (spec 16.1). */
export const INITIAL_MASTERY = 0.2;

/** Mastery gains per correct answer, by evidence form (spec 16.1). */
const MASTERY_GAINS: Record<EvidenceType, number> = {
  choice: 0.08,
  free_response: 0.12,
  code: 0.15
};

/**
 * Mastery penalties (spec 16.1 defines only incorrect -0.08; partial is not
 * defined there, so it gets the same -0.04 penalty used for "mostly right").
 */
const MASTERY_PENALTIES: Record<Exclude<AttemptOutcome, "correct">, number> = {
  incorrect: 0.08,
  partial: 0.04
};

/**
 * Ceiling rule (spec 16.1): mastery may exceed 0.75 only after the most
 * recent consecutive correct records include at least 2 distinct evidence
 * forms — a single question type alone cannot reach "mastered".
 */
const MASTERY_CEILING = 0.75;
const MAX_RECENT_ATTEMPTS = 20;
const MAX_RECORDED_INTERACTION_IDS = 1_000;
const MAX_RECENT_OUTCOMES = 10;
const MAX_MISCONCEPTIONS = 10;

/**
 * Pure mastery update (spec 16.1). `concept.recentOutcomes` is the recent
 * history INCLUDING the attempt being recorded (newest first); callers must
 * prepend the new outcome before calling.
 */
export function updateMastery(
  concept: ConceptState,
  attempt: { outcome: AttemptOutcome; evidenceType: EvidenceType }
): number {
  const delta =
    attempt.outcome === "correct"
      ? MASTERY_GAINS[attempt.evidenceType]
      : -MASTERY_PENALTIES[attempt.outcome];
  let mastery = round2(concept.mastery + delta);

  if (attempt.outcome === "correct" && mastery > MASTERY_CEILING) {
    if (!hasDiverseRecentCorrect(concept.recentOutcomes)) {
      mastery = MASTERY_CEILING;
    }
  }

  return clamp01(mastery);
}

export class LearningStateStore {
  private readonly onChange: ((snapshot: LearningState) => void) | undefined;
  private state: LearningState = initialLearningState();

  constructor(options: LearningStateStoreOptions = {}) {
    this.onChange = options.onChange;
  }

  snapshot(): LearningState {
    return structuredClone(this.state);
  }

  /** Clear process-local state before replaying a different Pi session branch. */
  resetForSession(): void {
    this.state = initialLearningState();
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
      phase: nextPhase(this.state.phase, { type: "start" })
    };
    this.notifyChange();
  }

  stop(): void {
    this.state = {
      ...this.state,
      enabled: false,
      phase: nextPhase(this.state.phase, { type: "stop" })
    };
    this.notifyChange();
  }

  /**
   * Spec 18 /learn-reset: clear the current topic's learner state (concepts,
   * mastery, attempt history, idempotency ledger) but keep course/topic and
   * learning mode; a fresh session starts diagnosing again.
   */
  resetTopic(): void {
    this.state = {
      ...this.state,
      phase: nextPhase(this.state.phase, { type: "start" }),
      concepts: {},
      recentAttempts: [],
      recordedInteractionIds: []
    };
    this.notifyChange();
  }

  /**
   * Spec 15: a learning_ask_* tool presented a question. Only migrates
   * explaining → checking; other phases keep their label. No-op when learning
   * mode is off.
   */
  questionPresented(): void {
    if (!this.state.enabled) {
      return;
    }
    const phase = nextPhase(this.state.phase, { type: "question_presented" });
    if (phase !== this.state.phase) {
      this.state.phase = phase;
      this.notifyChange();
    }
  }

  /**
   * Record a tutor-evaluated attempt (spec 30): creates the concept at
   * INITIAL_MASTERY when unknown, updates mastery via updateMastery, and
   * prepends to recentAttempts/recentOutcomes (bounded).
   */
  recordAttempt(input: RecordAttemptInput): AttemptSummary {
    const recordedInteractionIds =
      this.state.recordedInteractionIds ??
      [...new Set(this.state.recentAttempts.map((attempt) => attempt.interactionId))];
    if (recordedInteractionIds.includes(input.interactionId)) {
      throw new Error(
        `Attempt for interaction ${input.interactionId} has already been recorded.`
      );
    }

    const recordedAt = Date.now();
    const existing = this.state.concepts[input.conceptId];
    const concept: ConceptState =
      existing === undefined
        ? {
            id: input.conceptId,
            title: input.conceptId,
            mastery: INITIAL_MASTERY,
            attempts: 0,
            correct: 0,
            misconceptions: []
          }
        : { ...existing, misconceptions: [...existing.misconceptions] };

    concept.attempts += 1;
    if (input.outcome === "correct") {
      concept.correct += 1;
    }
    if (
      input.outcome === "incorrect" &&
      input.misconception !== undefined &&
      !concept.misconceptions.includes(input.misconception)
    ) {
      concept.misconceptions = [
        input.misconception,
        ...concept.misconceptions
      ].slice(0, MAX_MISCONCEPTIONS);
    }
    concept.recentOutcomes = (
      [
        { outcome: input.outcome, evidenceType: input.evidenceType },
        ...(concept.recentOutcomes ?? [])
      ] as RecentOutcome[]
    ).slice(0, MAX_RECENT_OUTCOMES);
    concept.mastery = updateMastery(concept, input);
    concept.lastPracticedAt = recordedAt;

    this.state.concepts[input.conceptId] = concept;

    const summary: AttemptSummary = {
      interactionId: input.interactionId,
      conceptId: input.conceptId,
      outcome: input.outcome,
      evidenceType: input.evidenceType,
      ...(input.misconception === undefined
        ? {}
        : { misconception: input.misconception }),
      recordedAt
    };
    this.state.recentAttempts = [summary, ...this.state.recentAttempts].slice(
      0,
      MAX_RECENT_ATTEMPTS
    );
    this.state.recordedInteractionIds = [
      input.interactionId,
      ...recordedInteractionIds
    ].slice(0, MAX_RECORDED_INTERACTION_IDS);

    // Spec 15: correct answer moves to application (practicing), incorrect
    // moves back to misconception diagnosis. Only while learning mode is on.
    if (this.state.enabled) {
      this.state.phase = nextPhase(this.state.phase, {
        type: "attempt_recorded",
        outcome: input.outcome
      });
    }

    this.notifyChange();
    return summary;
  }

  private notifyChange(): void {
    this.onChange?.(this.snapshot());
  }
}

function initialLearningState(): LearningState {
  return {
    enabled: false,
    phase: "idle",
    concepts: {},
    recentAttempts: []
  };
}

/** True when the trailing run of correct records contains >= 2 evidence forms. */
function hasDiverseRecentCorrect(
  recentOutcomes: readonly RecentOutcome[] | undefined
): boolean {
  const seen = new Set<EvidenceType>();
  for (const entry of recentOutcomes ?? []) {
    if (entry.outcome !== "correct") {
      break;
    }
    seen.add(entry.evidenceType);
    if (seen.size >= 2) {
      return true;
    }
  }
  return false;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
    value.recentAttempts.every(isAttemptSummary) &&
    (value.recordedInteractionIds === undefined ||
      (Array.isArray(value.recordedInteractionIds) &&
        value.recordedInteractionIds.length <= MAX_RECORDED_INTERACTION_IDS &&
        value.recordedInteractionIds.every(isNonEmptyString) &&
        new Set(value.recordedInteractionIds).size ===
          value.recordedInteractionIds.length))
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
    value.misconceptions.every((item) => typeof item === "string") &&
    (value.recentOutcomes === undefined ||
      (Array.isArray(value.recentOutcomes) &&
        value.recentOutcomes.every(isRecentOutcome)))
  );
}

function isRecentOutcome(value: unknown): value is RecentOutcome {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.outcome === "correct" ||
      value.outcome === "partial" ||
      value.outcome === "incorrect") &&
    (value.evidenceType === "choice" ||
      value.evidenceType === "free_response" ||
      value.evidenceType === "code")
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
