import {
  defineTool,
  type ExtensionContext
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  MultiChoiceAnswer,
  MultiChoiceInteraction,
  MultiChoiceResolvedAnswer
} from "../server/protocol.js";
import { createInteractionId } from "../utils/ids.js";
import { presentMultiChoiceInTui } from "./tui-presenter.js";

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

export interface MultiChoiceToolDetails extends MultiChoiceResolvedAnswer {
  interactionId: string;
  type: "multi_choice";
  answer: MultiChoiceAnswer;
  responseTimeMs: number;
  conceptId?: string;
}

export interface MultiChoiceToolDependencies {
  createId?: () => string;
  now?: () => number;
  present?: MultiChoicePresenter;
}

export type MultiChoicePresenter = (
  interaction: MultiChoiceInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext
) => Promise<MultiChoiceResolvedAnswer>;

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
      "Ask the learner a multi-choice question (one or more answers may be correct) and wait for their structured answer.",
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
      const details: MultiChoiceToolDetails = {
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
            text: `Learner selected options ${resolved.answer.optionIds.join(", ")} (interaction ${resolved.interactionId}).`
          }
        ],
        details
      };
    }
  });
}
