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
}

export interface AttemptSummary {
  interactionId: string;
  conceptId: string;
  outcome: "correct" | "partial" | "incorrect";
  evidenceType: "choice" | "free_response" | "code";
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
