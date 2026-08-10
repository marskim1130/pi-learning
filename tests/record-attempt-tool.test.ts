import { describe, expect, it } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAskRecordAttemptTool } from "../extension/tools/ask-record-attempt.js";
import { LearningStateStore } from "../extension/state/learning-state.js";

const ctx = { hasUI: false, ui: {} } as unknown as ExtensionContext;

describe("learning_record_attempt tool", () => {
  it("records an attempt, creates the concept and reports mastery change", async () => {
    const state = new LearningStateStore();
    const tool = createAskRecordAttemptTool({ state });

    const result = await tool.execute(
      "tool_call_1",
      {
        interactionId: "q_1",
        conceptId: "trait-bounds",
        outcome: "correct",
        evidenceType: "choice"
      },
      undefined,
      undefined,
      ctx
    );

    expect(result.content[0]).toEqual({
      type: "text",
      text: "Recorded attempt for concept trait-bounds: correct (0.20 → 0.28)."
    });
    expect(result.details).toEqual({
      interactionId: "q_1",
      conceptId: "trait-bounds",
      outcome: "correct",
      evidenceType: "choice",
      previousMastery: 0.2,
      newMastery: 0.28
    });
    expect(state.snapshot().concepts["trait-bounds"]).toMatchObject({
      mastery: 0.28,
      attempts: 1,
      correct: 1
    });
  });

  it("reports previous mastery of an existing concept", async () => {
    const state = new LearningStateStore();
    state.recordAttempt({
      interactionId: "q_1",
      conceptId: "generics",
      outcome: "incorrect",
      evidenceType: "choice"
    });
    const tool = createAskRecordAttemptTool({ state });

    const result = await tool.execute(
      "tool_call_2",
      {
        interactionId: "q_2",
        conceptId: "generics",
        outcome: "incorrect",
        evidenceType: "choice",
        misconception: "Confuses A with B"
      },
      undefined,
      undefined,
      ctx
    );

    expect(result.details).toMatchObject({
      previousMastery: 0.12,
      newMastery: 0.04
    });
    expect(state.snapshot().concepts.generics?.misconceptions).toEqual([
      "Confuses A with B"
    ]);
  });

  it("records attempts while learning mode is off", async () => {
    const state = new LearningStateStore(); // enabled: false, no course/topic
    const tool = createAskRecordAttemptTool({ state });

    const result = await tool.execute(
      "tool_call_3",
      {
        interactionId: "q_3",
        conceptId: "rust-ownership",
        outcome: "partial",
        evidenceType: "free_response"
      },
      undefined,
      undefined,
      ctx
    );

    expect(result.details).toMatchObject({ newMastery: 0.16 });
    expect(state.snapshot().concepts["rust-ownership"]?.attempts).toBe(1);
  });

  it("pi runtime rejects invalid outcome/evidenceType enums via the parameters schema", async () => {
    // agent-loop validates tool calls with pi-ai validateToolArguments before
    // execute() — the same path the LLM's calls go through. execute() itself
    // does not validate, so this is the real guard.
    const { validateToolArguments } = await import("@earendil-works/pi-ai");
    const state = new LearningStateStore();
    const tool = createAskRecordAttemptTool({ state });
    const runtimeTool = {
      name: "learning_record_attempt",
      description: tool.description,
      parameters: tool.parameters
    } as Parameters<typeof validateToolArguments>[0];
    const call = (arguments_: unknown): Parameters<typeof validateToolArguments>[1] => ({
      type: "toolCall" as const,
      id: "call_1",
      name: "learning_record_attempt",
      arguments: arguments_ as Record<string, unknown>
    });

    expect(
      validateToolArguments(runtimeTool, call({ interactionId: "q", conceptId: "c", outcome: "correct", evidenceType: "choice" }))
    ).toEqual({ interactionId: "q", conceptId: "c", outcome: "correct", evidenceType: "choice" });

    for (const bad of [
      { interactionId: "q", conceptId: "c", outcome: "banana", evidenceType: "choice" },
      { interactionId: "q", conceptId: "c", outcome: "correct", evidenceType: "drag_drop" },
      { interactionId: "q", conceptId: "c", outcome: "correct", evidenceType: "code", misconception: "" },
      { interactionId: "", conceptId: "c", outcome: "correct", evidenceType: "choice" }
    ]) {
      expect(() => validateToolArguments(runtimeTool, call(bad))).toThrow();
    }
  });
});
