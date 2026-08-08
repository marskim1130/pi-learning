import {
  defineTool,
  type ExtensionContext
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  SingleChoiceAnswer,
  SingleChoiceInteraction,
  SingleChoiceResolvedAnswer
} from "../server/protocol.js";
import { createInteractionId } from "../utils/ids.js";
import { presentSingleChoiceInTui } from "./tui-presenter.js";

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

export interface SingleChoiceToolDetails extends SingleChoiceResolvedAnswer {
  interactionId: string;
  type: "single_choice";
  answer: SingleChoiceAnswer;
  responseTimeMs: number;
  conceptId?: string;
}

export interface SingleChoiceToolDependencies {
  createId?: () => string;
  now?: () => number;
  present?: SingleChoicePresenter;
}

export type SingleChoicePresenter = (
  interaction: SingleChoiceInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext
) => Promise<SingleChoiceResolvedAnswer>;

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
      "Ask the learner one single-choice question and wait for their structured answer.",
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
      const details: SingleChoiceToolDetails = {
        interactionId: resolved.interactionId,
        type: resolved.type,
        answer: resolved.answer,
        responseTimeMs: resolved.responseTimeMs,
        ...(interaction.conceptId === undefined
          ? {}
          : { conceptId: interaction.conceptId })
      };

      return {
        content: [
          {
            type: "text",
            text: `Learner selected option ${resolved.answer.optionId}.`
          }
        ],
        details
      };
    }
  });
}
