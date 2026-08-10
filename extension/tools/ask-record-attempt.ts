import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  INITIAL_MASTERY,
  type LearningStateStore
} from "../state/learning-state.js";

const parameters = Type.Object({
  interactionId: Type.String({ minLength: 1 }),
  conceptId: Type.String({ minLength: 1 }),
  // Spec 11.6 prefers pi-ai StringEnum for Google-provider compat, but pi-ai
  // is not a declared dependency of this repo, so TypeBox literals match the
  // existing tools' style. Swap to StringEnum when pi-ai becomes a dependency.
  outcome: Type.Union([
    Type.Literal("correct"),
    Type.Literal("partial"),
    Type.Literal("incorrect")
  ]),
  evidenceType: Type.Union([
    Type.Literal("choice"),
    Type.Literal("free_response"),
    Type.Literal("code")
  ]),
  misconception: Type.Optional(Type.String({ minLength: 1 }))
});

export interface RecordAttemptToolDetails {
  interactionId: string;
  conceptId: string;
  outcome: "correct" | "partial" | "incorrect";
  evidenceType: "choice" | "free_response" | "code";
  previousMastery: number;
  newMastery: number;
}

export interface RecordAttemptToolDependencies {
  state: LearningStateStore;
}

/**
 * Non-blocking: records the tutor's evaluation, returns immediately (no
 * executionMode needed; the default is sequential already). No interactionId
 * existence check against the broker: the broker has no resolved-query API
 * and forcing one would widen its interface — MVP accepts any id.
 */
export function createAskRecordAttemptTool(
  dependencies: RecordAttemptToolDependencies
) {
  const { state } = dependencies;

  return defineTool<typeof parameters, RecordAttemptToolDetails>({
    name: "learning_record_attempt",
    label: "Learning: Record Attempt",
    description:
      "Record the learner's attempt on a concept after evaluating it. Use this to update mastery when the learner answered a learning_ask_* question (or any exercise), instead of describing the outcome in prose.",
    promptSnippet: "Record the learner's attempt and update concept mastery",
    parameters,
    async execute(_toolCallId, params) {
      const previousMastery =
        state.snapshot().concepts[params.conceptId]?.mastery ??
        INITIAL_MASTERY;
      const summary = state.recordAttempt({
        interactionId: params.interactionId,
        conceptId: params.conceptId,
        outcome: params.outcome,
        evidenceType: params.evidenceType,
        ...(params.misconception === undefined
          ? {}
          : { misconception: params.misconception })
      });
      const newMastery =
        state.snapshot().concepts[params.conceptId]?.mastery ??
        previousMastery;

      const details: RecordAttemptToolDetails = {
        interactionId: summary.interactionId,
        conceptId: summary.conceptId,
        outcome: summary.outcome,
        evidenceType: summary.evidenceType,
        previousMastery,
        newMastery
      };

      return {
        content: [
          {
            type: "text",
            text: `Recorded attempt for concept ${params.conceptId}: ${params.outcome} (${previousMastery.toFixed(2)} → ${newMastery.toFixed(2)}).`
          }
        ],
        details
      };
    }
  });
}
