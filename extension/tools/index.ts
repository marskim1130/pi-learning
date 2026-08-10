import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { InteractionBroker } from "../server/interaction-broker.js";
import type { LearningServer } from "../server/learning-server.js";
import { createAskCodeTool } from "./ask-code.js";
import { createAskFreeResponseTool } from "./ask-free-response.js";
import { createAskSingleChoiceTool } from "./ask-single-choice.js";
import { createModeAwarePresenter } from "./tui-presenter.js";

export interface LearningToolRegistrationDependencies {
  broker: InteractionBroker;
  /** Source of hasWebClient() for uiMode auto routing (spec 28). */
  server: LearningServer;
}

export function registerLearningTools(
  pi: ExtensionAPI,
  dependencies: LearningToolRegistrationDependencies
): void {
  const presenter = createModeAwarePresenter(
    dependencies.broker,
    () => dependencies.server.hasWebClient()
  );
  pi.registerTool(
    createAskSingleChoiceTool({ present: presenter.presentSingleChoice })
  );
  pi.registerTool(
    createAskFreeResponseTool({ present: presenter.presentFreeResponse })
  );
  pi.registerTool(createAskCodeTool({ present: presenter.presentCode }));
}
