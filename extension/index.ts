import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerLearningCommands } from "./commands.js";
import { InteractionBroker } from "./server/interaction-broker.js";
import { LearningServer } from "./server/learning-server.js";
import { LearningStateStore } from "./state/learning-state.js";
import {
  LEARNING_STATE_ENTRY_TYPE,
  LEARNING_STATE_VERSION,
  registerLearningStatePersistence
} from "./state/session-persistence.js";
import { registerLearningTools } from "./tools/index.js";
import { registerTranscriptSync } from "./transcript-sync.js";
import { registerTutorPrompt } from "./tutor-prompt.js";

export default function learningExtension(pi: ExtensionAPI): void {
  const broker = new InteractionBroker();
  // server 在 onChange 首次触发（/learn、record_attempt）前同步完成构造。
  let server: LearningServer;
  const state = new LearningStateStore({
    // 任何 state 变化（/learn、/learn-stop、learning_record_attempt）后广播。
    // server 可能未 start：broadcastSessionUpdated 在无 SSE 客户端时安全 no-op。
    onChange: (snapshot) => {
      server.broadcastSessionUpdated();
      pi.appendEntry(LEARNING_STATE_ENTRY_TYPE, {
        version: LEARNING_STATE_VERSION,
        state: snapshot
      });
    }
  });
  server = new LearningServer({ broker, state });

  // Spec 15: a presented question migrates explaining → checking.
  broker.subscribe({
    onPresented: () => state.questionPresented()
  });

  registerLearningTools(pi, { broker, state, server });
  registerLearningCommands(pi, { state, broker, server });
  registerTutorPrompt(pi, { state });
  registerTranscriptSync(pi, server);
  registerLearningStatePersistence(pi, state);

  pi.on("session_shutdown", async () => {
    broker.cancelAll("session_shutdown");
    await server.close();
  });
}
