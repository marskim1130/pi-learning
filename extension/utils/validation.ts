import type {
  CodeExerciseAnswer,
  FreeResponseAnswer,
  LearningInteraction,
  SingleChoiceAnswer
} from "../server/protocol.js";

export type AnswerValidationResult =
  | { ok: true; type: "single_choice"; answer: SingleChoiceAnswer }
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
