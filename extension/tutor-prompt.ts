import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { LearningStateStore } from "./state/learning-state.js";

export interface TutorPromptDependencies {
  state: LearningStateStore;
}

export function registerTutorPrompt(
  pi: ExtensionAPI,
  dependencies: TutorPromptDependencies
): void {
  pi.on("before_agent_start", (event) => {
    const state = dependencies.state.snapshot();
    if (!state.enabled) {
      return;
    }

    const conceptState = Object.values(state.concepts).map((concept) => {
      const misconceptions = concept.misconceptions
        .slice(0, 3)
        .map(toPromptLine)
        .join(" | ");
      return (
        `- ${toPromptLine(concept.id)}: mastery=${concept.mastery.toFixed(2)}, ` +
        `attempts=${concept.attempts}, correct=${concept.correct}, ` +
        `misconceptions=${misconceptions === "" ? "none" : misconceptions}`
      );
    });

    const learningPrompt = [
      "You are operating in Learning Mode.",
      "",
      "Teaching rules:",
      "1. Teach interactively rather than dumping a full solution.",
      "2. Use one primary learner interaction at a time.",
      "3. Use learning_ask_single_choice for single-choice checks; do not render fake choices in Markdown.",
      "4. Use learning_ask_multi_choice when multiple answers are correct; do not render fake checkboxes in Markdown.",
      "5. Use learning_ask_free_response for open learner responses.",
      "6. Use learning_ask_code for coding exercises; do not ask the learner to paste code into ordinary chat.",
      "7. After an answer, evaluate it, explain the key point, and decide the next teaching action.",
      "8. Prefer retrieval practice and application over repeated explanation.",
      "9. Adapt difficulty to the learner state and do not infer mastery from one lucky choice.",
      "10. Keep explanations concise enough to preserve active participation.",
      "11. When a registered learning interaction tool fits, use it instead of ordinary chat input.",
      "12. Make every learning_ask_* prompt self-contained: put all code, examples, and context inside the question/instructions parameter itself. The learner's active panel shows only that parameter's content, never your previous chat messages — a question without its code is unanswerable.",
      "13. After evaluating each answer, call learning_record_attempt with that interaction's interactionId, the conceptId, outcome (correct/partial/incorrect), and evidenceType matching the interaction (choice for single/multi choice, free_response for open answers, code for code exercises); include misconception when the answer was wrong. Do not record attempts whose tool result says skipped: true — a skipped question is not an answer.",
      "",
      `Current course: ${state.course?.title ?? "unspecified"}`,
      `Current topic: ${state.topic?.title ?? "unspecified"}`,
      `Current phase: ${state.phase}`,
      `Tracked concepts: ${Object.keys(state.concepts).length}`,
      `Recent attempts: ${state.recentAttempts.length}`,
      "Concept state:",
      ...(conceptState.length === 0 ? ["- none"] : conceptState)
    ].join("\n");

    return { systemPrompt: `${event.systemPrompt}\n\n${learningPrompt}` };
  });
}

function toPromptLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 200);
}
