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

export type AttemptOutcome = "correct" | "partial" | "incorrect";

export type EvidenceType = "choice" | "free_response" | "code";

/** One recorded answer, newest first; drives the 0.75 ceiling rule (spec 16.1). */
export interface RecentOutcome {
  outcome: AttemptOutcome;
  evidenceType: EvidenceType;
}

export interface ConceptState {
  id: string;
  title: string;
  mastery: number;
  attempts: number;
  correct: number;
  lastPracticedAt?: number;
  misconceptions: string[];
  /**
   * Optional: absent in snapshots written before this field existed, so
   * restore() must keep accepting concepts without it (backward compatible).
   */
  recentOutcomes?: RecentOutcome[];
}

export interface AttemptSummary {
  interactionId: string;
  conceptId: string;
  outcome: AttemptOutcome;
  evidenceType: EvidenceType;
  misconception?: string;
  recordedAt: number;
}

export interface LearningState {
  enabled: boolean;
  course?: LearningCourse;
  topic?: LearningTopic;
  phase: LearningPhase;
  concepts: Record<string, ConceptState>;
  recentAttempts: AttemptSummary[];
}
