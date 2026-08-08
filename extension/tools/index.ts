import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { InteractionBroker } from "../server/interaction-broker.js";
import { createAskCodeTool } from "./ask-code.js";
import { createAskFreeResponseTool } from "./ask-free-response.js";
import { createAskSingleChoiceTool } from "./ask-single-choice.js";
import { createBrokerBackedTuiPresenter } from "./tui-presenter.js";

export interface LearningToolRegistrationDependencies {
  broker: InteractionBroker;
}

export function registerLearningTools(
  pi: ExtensionAPI,
  dependencies: LearningToolRegistrationDependencies
): void {
  const presenter = createBrokerBackedTuiPresenter(dependencies.broker);
  pi.registerTool(
    createAskSingleChoiceTool({ present: presenter.presentSingleChoice })
  );
  pi.registerTool(
    createAskFreeResponseTool({ present: presenter.presentFreeResponse })
  );
  pi.registerTool(createAskCodeTool({ present: presenter.presentCode }));
}
