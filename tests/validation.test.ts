import { describe, expect, it } from "vitest";

import type { MultiChoiceInteraction } from "../extension/server/protocol.js";
import { validateInteractionAnswer } from "../extension/utils/validation.js";

function multiChoiceInteraction(
  id = "q_multi",
  options = [
    { id: "A", label: "First" },
    { id: "B", label: "Second" },
    { id: "C", label: "Third" }
  ]
): MultiChoiceInteraction {
  return {
    id,
    type: "multi_choice",
    question: "Pick all that apply",
    options,
    allowSkip: false,
    createdAt: 1_000
  };
}

describe("multi_choice answer validation", () => {
  it("accepts one or more known option ids", () => {
    const interaction = multiChoiceInteraction();
    expect(
      validateInteractionAnswer(interaction, { optionIds: ["B"] })
    ).toEqual({
      ok: true,
      type: "multi_choice",
      answer: { optionIds: ["B"] }
    });
    expect(
      validateInteractionAnswer(interaction, { optionIds: ["A", "C"] })
    ).toEqual({
      ok: true,
      type: "multi_choice",
      answer: { optionIds: ["A", "C"] }
    });
  });

  it("keeps the submission order as-is (order is not semantic)", () => {
    const interaction = multiChoiceInteraction();
    expect(
      validateInteractionAnswer(interaction, { optionIds: ["C", "A"] })
    ).toEqual({
      ok: true,
      type: "multi_choice",
      answer: { optionIds: ["C", "A"] }
    });
  });

  it("rejects a non-object answer", () => {
    const result = validateInteractionAnswer(
      multiChoiceInteraction(),
      "A"
    );
    expect(result).toEqual({
      ok: false,
      message: "Interaction q_multi requires an optionIds array."
    });
  });

  it("rejects an answer without optionIds", () => {
    const result = validateInteractionAnswer(multiChoiceInteraction(), {});
    expect(result).toEqual({
      ok: false,
      message: "Interaction q_multi requires an optionIds array."
    });
  });

  it("rejects an empty optionIds array", () => {
    const result = validateInteractionAnswer(multiChoiceInteraction(), {
      optionIds: []
    });
    expect(result).toEqual({
      ok: false,
      message:
        "Interaction q_multi requires at least one selected option."
    });
  });

  it("rejects non-string entries in optionIds", () => {
    const result = validateInteractionAnswer(multiChoiceInteraction(), {
      optionIds: ["A", 42]
    });
    expect(result).toEqual({
      ok: false,
      message: "Interaction q_multi requires optionIds to be strings."
    });
  });

  it("rejects an option id that is not part of the interaction", () => {
    const result = validateInteractionAnswer(multiChoiceInteraction(), {
      optionIds: ["A", "Z"]
    });
    expect(result).toEqual({
      ok: false,
      message: "Option Z does not belong to interaction q_multi."
    });
  });

  it("rejects duplicate option ids", () => {
    const result = validateInteractionAnswer(multiChoiceInteraction(), {
      optionIds: ["A", "A"]
    });
    expect(result).toEqual({
      ok: false,
      message: "Interaction q_multi contains duplicate options."
    });
  });

  it("still validates single-choice interactions after the multi_choice branch", () => {
    const interaction = {
      id: "q_single",
      type: "single_choice" as const,
      question: "Pick one",
      options: [{ id: "A", label: "Only" }],
      allowSkip: false,
      createdAt: 1_000
    };
    expect(validateInteractionAnswer(interaction, { optionId: "A" })).toEqual({
      ok: true,
      type: "single_choice",
      answer: { optionId: "A" }
    });
  });
});
