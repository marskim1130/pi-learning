import type {
  CodeExerciseAnswer,
  FreeResponseAnswer,
  LearningInteraction,
  MultiChoiceAnswer,
  SingleChoiceAnswer
} from "../server/protocol.js";

export type AnswerValidationResult =
  | { ok: true; type: "single_choice"; answer: SingleChoiceAnswer }
  | { ok: true; type: "multi_choice"; answer: MultiChoiceAnswer }
  | { ok: true; type: "free_response"; answer: FreeResponseAnswer }
  | { ok: true; type: "code"; answer: CodeExerciseAnswer }
  | { ok: false; message: string };

export function validateInteractionAnswer(
  interaction: LearningInteraction,
  answer: unknown
): AnswerValidationResult {
  if (interaction.type === "code") {
    if (
      typeof answer !== "object" ||
      answer === null ||
      !("language" in answer) ||
      typeof answer.language !== "string" ||
      !("code" in answer) ||
      typeof answer.code !== "string"
    ) {
      return {
        ok: false,
        message: `Interaction ${interaction.id} requires language and code strings.`
      };
    }
    if (answer.language !== interaction.language) {
      return {
        ok: false,
        message: `Language ${answer.language} does not match interaction ${interaction.id}.`
      };
    }

    return {
      ok: true,
      type: interaction.type,
      answer: { language: answer.language, code: answer.code }
    };
  }

  if (interaction.type === "free_response") {
    if (
      typeof answer !== "object" ||
      answer === null ||
      !("text" in answer) ||
      typeof answer.text !== "string"
    ) {
      return {
        ok: false,
        message: `Interaction ${interaction.id} requires a text string.`
      };
    }

    return { ok: true, type: interaction.type, answer: { text: answer.text } };
  }

  if (interaction.type === "multi_choice") {
    if (
      typeof answer !== "object" ||
      answer === null ||
      !("optionIds" in answer) ||
      !Array.isArray(answer.optionIds)
    ) {
      return {
        ok: false,
        message: `Interaction ${interaction.id} requires an optionIds array.`
      };
    }

    if (answer.optionIds.length === 0) {
      return {
        ok: false,
        message: `Interaction ${interaction.id} requires at least one selected option.`
      };
    }

    if (!answer.optionIds.every((optionId) => typeof optionId === "string")) {
      return {
        ok: false,
        message: `Interaction ${interaction.id} requires optionIds to be strings.`
      };
    }

    const validIds = new Set(interaction.options.map((option) => option.id));
    const unknown = answer.optionIds.find((optionId) => !validIds.has(optionId));
    if (unknown !== undefined) {
      return {
        ok: false,
        message: `Option ${unknown} does not belong to interaction ${interaction.id}.`
      };
    }

    if (new Set(answer.optionIds).size !== answer.optionIds.length) {
      return {
        ok: false,
        message: `Interaction ${interaction.id} contains duplicate options.`
      };
    }

    return {
      ok: true,
      type: interaction.type,
      answer: { optionIds: answer.optionIds }
    };
  }

  if (
    typeof answer !== "object" ||
    answer === null ||
    !("optionId" in answer) ||
    typeof answer.optionId !== "string"
  ) {
    return {
      ok: false,
      message: `Interaction ${interaction.id} requires an optionId string.`
    };
  }

  if (!interaction.options.some((option) => option.id === answer.optionId)) {
    return {
      ok: false,
      message: `Option ${answer.optionId} does not belong to interaction ${interaction.id}.`
    };
  }

  return {
    ok: true,
    type: interaction.type,
    answer: { optionId: answer.optionId }
  };
}
