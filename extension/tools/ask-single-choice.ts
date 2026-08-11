import {
  defineTool,
  type ExtensionContext
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  SingleChoiceAnswer,
  SingleChoiceInteraction
} from "../server/protocol.js";
import { createInteractionId } from "../utils/ids.js";
import { presentSingleChoiceInTui } from "./tui-presenter.js";
import type { ChoiceResolvedAnswer } from "./tui-presenter.js";

const parameters = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1 })),
  question: Type.String({ minLength: 1 }),
  options: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      label: Type.String({ minLength: 1 })
    }),
    { minItems: 2 }
  ),
  conceptId: Type.Optional(Type.String({ minLength: 1 })),
  allowSkip: Type.Optional(Type.Boolean())
});

/**
 * Answered or skipped (spec 7.5): a skipped interaction carries
 * `skipped: true` and no answer, so the model can tell a decline from a
 * wrong answer.
 */
export type SingleChoiceToolDetails = (
  | { interactionId: string; type: "single_choice"; answer: SingleChoiceAnswer; responseTimeMs: number }
  | { interactionId: string; type: "single_choice"; skipped: true; responseTimeMs: number }
) & { conceptId?: string };

export interface SingleChoiceToolDependencies {
  createId?: () => string;
  now?: () => number;
  present?: SingleChoicePresenter;
}

export type SingleChoicePresenter = (
  interaction: SingleChoiceInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext
) => Promise<ChoiceResolvedAnswer>;

export function createAskSingleChoiceTool(
  dependencies: SingleChoiceToolDependencies = {}
) {
  const createId =
    dependencies.createId ?? (() => createInteractionId("choice"));
  const now = dependencies.now ?? Date.now;
  const present =
    dependencies.present ??
    ((interaction, signal, ctx) =>
      presentSingleChoiceInTui(interaction, signal, ctx, now));

  return defineTool<typeof parameters, SingleChoiceToolDetails>({
    name: "learning_ask_single_choice",
    label: "Learning: Single Choice",
    description:
      "Ask the learner one single-choice question and wait for their structured answer. allowSkip lets the learner decline without answering.",
    promptSnippet: "Ask a structured single-choice learning question",
    executionMode: "sequential",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const interaction: SingleChoiceInteraction = {
        id: createId(),
        type: "single_choice",
        question: params.question,
        options: params.options,
        allowSkip: params.allowSkip ?? false,
        createdAt: now(),
        ...(params.title === undefined ? {} : { title: params.title }),
        ...(params.conceptId === undefined
          ? {}
          : { conceptId: params.conceptId })
      };
      const resolved = await present(interaction, signal, ctx);
      const skipped = "skipped" in resolved;
      const details: SingleChoiceToolDetails = {
        interactionId: resolved.interactionId,
        type: "single_choice",
        ...(skipped
          ? { skipped: true }
          : { answer: resolved.answer }),
        responseTimeMs: resolved.responseTimeMs,
        ...(interaction.conceptId === undefined
          ? {}
          : { conceptId: interaction.conceptId })
      };

      return {
        content: [
          {
            type: "text",
            text: skipped
              ? `Learner skipped the question (interaction ${resolved.interactionId}).`
              : `Learner selected option ${resolved.answer.optionId} (interaction ${resolved.interactionId}).`
          }
        ],
        details
      };
    }
  });
}
