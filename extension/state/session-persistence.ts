import type {
  ExtensionAPI,
  SessionEntry
} from "@earendil-works/pi-coding-agent";

import type { LearningState } from "./types.js";
import type { LearningStateStore } from "./learning-state.js";

export const LEARNING_STATE_ENTRY_TYPE = "learning-state";
export const LEARNING_STATE_VERSION = 1;

export interface LearningStateEntryData {
  version: typeof LEARNING_STATE_VERSION;
  state: LearningState;
}

export function createLearningStateEntryData(
  state: LearningStateStore
): LearningStateEntryData {
  return {
    version: LEARNING_STATE_VERSION,
    state: state.snapshot()
  };
}

export function restoreLearningStateFromEntries(
  state: LearningStateStore,
  entries: readonly SessionEntry[]
): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.type !== "custom" ||
      entry.customType !== LEARNING_STATE_ENTRY_TYPE ||
      !isVersionOneEntry(entry.data)
    ) {
      continue;
    }

    if (state.restore(entry.data.state)) {
      return true;
    }
  }

  return false;
}

export function registerLearningStatePersistence(
  pi: ExtensionAPI,
  state: LearningStateStore
): void {
  pi.on("session_start", (_event, ctx) => {
    state.resetForSession();
    restoreLearningStateFromEntries(state, ctx.sessionManager.getBranch());
  });
}

function isVersionOneEntry(value: unknown): value is LearningStateEntryData {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === LEARNING_STATE_VERSION &&
    "state" in value
  );
}
