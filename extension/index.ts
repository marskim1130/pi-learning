import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerLearningCommands } from "./commands.js";
import { InteractionBroker } from "./server/interaction-broker.js";
import { LearningStateStore } from "./state/learning-state.js";
import { registerLearningStatePersistence } from "./state/session-persistence.js";
import { registerLearningTools } from "./tools/index.js";
import { registerTutorPrompt } from "./tutor-prompt.js";

export default function learningExtension(pi: ExtensionAPI): void {
  const state = new LearningStateStore();
  const broker = new InteractionBroker();

  registerLearningTools(pi, { broker });
  registerLearningCommands(pi, { state, broker });
  registerTutorPrompt(pi, { state });
  registerLearningStatePersistence(pi, state);

  pi.on("session_shutdown", () => {
    broker.cancelAll("session_shutdown");
  });
}
