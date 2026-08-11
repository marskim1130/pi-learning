import {
  defineTool,
  type ExtensionContext
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  MultiChoiceAnswer,
  MultiChoiceInteraction
} from "../server/protocol.js";
import { createInteractionId } from "../utils/ids.js";
import { presentMultiChoiceInTui } from "./tui-presenter.js";
import type { MultiChoiceResolvedAnswerOrSkip } from "./tui-presenter.js";

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
 * `skipped: true` and no answer.
 */
export type MultiChoiceToolDetails = (
  | { interactionId: string; type: "multi_choice"; answer: MultiChoiceAnswer; responseTimeMs: number }
  | { interactionId: string; type: "multi_choice"; skipped: true; responseTimeMs: number }
) & { conceptId?: string };

export interface MultiChoiceToolDependencies {
  createId?: () => string;
  now?: () => number;
  present?: MultiChoicePresenter;
}

export type MultiChoicePresenter = (
  interaction: MultiChoiceInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext
) => Promise<MultiChoiceResolvedAnswerOrSkip>;

export function createAskMultiChoiceTool(
  dependencies: MultiChoiceToolDependencies = {}
) {
  const createId =
    dependencies.createId ?? (() => createInteractionId("multi"));
  const now = dependencies.now ?? Date.now;
  const present =
    dependencies.present ??
    ((interaction, signal, ctx) =>
      presentMultiChoiceInTui(interaction, signal, ctx, now));

  return defineTool<typeof parameters, MultiChoiceToolDetails>({
    name: "learning_ask_multi_choice",
    label: "Learning: Multi Choice",
    description:
      "Ask the learner a multi-choice question (one or more answers may be correct) and wait for their structured answer. allowSkip lets the learner decline without answering.",
    promptSnippet: "Ask a structured multi-choice learning question",
    executionMode: "sequential",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const interaction: MultiChoiceInteraction = {
        id: createId(),
        type: "multi_choice",
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
      const details: MultiChoiceToolDetails = {
        interactionId: resolved.interactionId,
        type: "multi_choice",
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
              : `Learner selected options ${resolved.answer.optionIds.join(", ")} (interaction ${resolved.interactionId}).`
          }
        ],
        details
      };
    }
  });
}
