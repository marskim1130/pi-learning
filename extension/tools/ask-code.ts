import {
  defineTool,
  type ExtensionContext
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  CodeExerciseInteraction,
  CodeExerciseResolvedAnswer
} from "../server/protocol.js";
import { createInteractionId } from "../utils/ids.js";
import { presentCodeInTui } from "./tui-presenter.js";

const parameters = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1 })),
  instructions: Type.String({ minLength: 1 }),
  language: Type.String({ minLength: 1 }),
  starterCode: Type.Optional(Type.String()),
  readOnlyRanges: Type.Optional(
    Type.Array(
      Type.Object({
        start: Type.Integer({ minimum: 0 }),
        end: Type.Integer({ minimum: 1 })
      })
    )
  ),
  conceptId: Type.Optional(Type.String({ minLength: 1 }))
});

export interface CodeToolDetails extends CodeExerciseResolvedAnswer {
  conceptId?: string;
}

export type CodePresenter = (
  interaction: CodeExerciseInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext
) => Promise<CodeExerciseResolvedAnswer>;

export interface CodeToolDependencies {
  createId?: () => string;
  now?: () => number;
  present?: CodePresenter;
}

export function createAskCodeTool(dependencies: CodeToolDependencies = {}) {
  const createId = dependencies.createId ?? (() => createInteractionId("code"));
  const now = dependencies.now ?? Date.now;
  const present =
    dependencies.present ??
    ((interaction, signal, ctx) =>
      presentCodeInTui(interaction, signal, ctx, now));

  return defineTool<typeof parameters, CodeToolDetails>({
    name: "learning_ask_code",
    label: "Learning: Code Exercise",
    description:
      "Ask the learner to write code and wait for a structured code submission. This tool does not execute code.",
    promptSnippet: "Ask a structured coding exercise",
    executionMode: "sequential",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const interaction: CodeExerciseInteraction = {
        id: createId(),
        type: "code",
        instructions: params.instructions,
        language: params.language,
        starterCode: params.starterCode ?? "",
        ...(params.readOnlyRanges === undefined
          ? {}
          : { readOnlyRanges: params.readOnlyRanges }),
        createdAt: now(),
        ...(params.title === undefined ? {} : { title: params.title }),
        ...(params.conceptId === undefined
          ? {}
          : { conceptId: params.conceptId })
      };
      const resolved = await present(interaction, signal, ctx);
      const details: CodeToolDetails = {
        ...resolved,
        ...(interaction.conceptId === undefined
          ? {}
          : { conceptId: interaction.conceptId })
      };

      return {
        content: [
          {
            type: "text",
            text: `Learner submitted code in ${resolved.answer.language}.`
          }
        ],
        details
      };
    }
  });
}
