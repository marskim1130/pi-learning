import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerLearningCommands } from "./commands.js";
import { InteractionBroker } from "./server/interaction-broker.js";
import { LearningServer } from "./server/learning-server.js";
import { LearningStateStore } from "./state/learning-state.js";
import { registerLearningStatePersistence } from "./state/session-persistence.js";
import { registerLearningTools } from "./tools/index.js";
import { registerTranscriptSync } from "./transcript-sync.js";
import { registerTutorPrompt } from "./tutor-prompt.js";

export default function learningExtension(pi: ExtensionAPI): void {
  const state = new LearningStateStore();
  const broker = new InteractionBroker();
  const server = new LearningServer({ broker, state });

  registerLearningTools(pi, { broker, server });
  registerLearningCommands(pi, { state, broker, server });
  registerTutorPrompt(pi, { state });
  registerTranscriptSync(pi, server);
  registerLearningStatePersistence(pi, state);

  pi.on("session_shutdown", async () => {
    broker.cancelAll("session_shutdown");
    await server.close();
  });
}
