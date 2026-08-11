import {
  defineTool,
  type ExtensionContext
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  FreeResponseInteraction,
  FreeResponseResolvedAnswer
} from "../server/protocol.js";
import { createInteractionId } from "../utils/ids.js";
import { presentFreeResponseInTui } from "./tui-presenter.js";

const parameters = Type.Object({
  question: Type.String({ minLength: 1 }),
  placeholder: Type.Optional(Type.String()),
  multiline: Type.Optional(Type.Boolean()),
  conceptId: Type.Optional(Type.String({ minLength: 1 }))
});

export interface FreeResponseToolDetails extends FreeResponseResolvedAnswer {
  conceptId?: string;
}

export type FreeResponsePresenter = (
  interaction: FreeResponseInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext
) => Promise<FreeResponseResolvedAnswer>;

export interface FreeResponseToolDependencies {
  createId?: () => string;
  now?: () => number;
  present?: FreeResponsePresenter;
}

export function createAskFreeResponseTool(
  dependencies: FreeResponseToolDependencies = {}
) {
  const createId = dependencies.createId ?? (() => createInteractionId("free"));
  const now = dependencies.now ?? Date.now;
  const present =
    dependencies.present ??
    ((interaction, signal, ctx) =>
      presentFreeResponseInTui(interaction, signal, ctx, now));

  return defineTool<typeof parameters, FreeResponseToolDetails>({
    name: "learning_ask_free_response",
    label: "Learning: Free Response",
    description:
      "Ask the learner an open-ended question and wait for their structured response.",
    promptSnippet: "Ask a structured open-ended learning question",
    executionMode: "sequential",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const interaction: FreeResponseInteraction = {
        id: createId(),
        type: "free_response",
        question: params.question,
        multiline: params.multiline ?? true,
        createdAt: now(),
        ...(params.placeholder === undefined
          ? {}
          : { placeholder: params.placeholder }),
        ...(params.conceptId === undefined
          ? {}
          : { conceptId: params.conceptId })
      };
      const resolved = await present(interaction, signal, ctx);
      const details: FreeResponseToolDetails = {
        ...resolved,
        ...(interaction.conceptId === undefined
          ? {}
          : { conceptId: interaction.conceptId })
      };

      return {
        content: [
          {
            type: "text",
            text: `Learner submitted this free response:\n${resolved.answer.text}`
          }
        ],
        details
      };
    }
  });
}
