import type {
  ExtensionAPI,
  ExtensionCommandContext
} from "@earendil-works/pi-coding-agent";

import type { InteractionBroker } from "./server/interaction-broker.js";
import type { LearningServer } from "./server/learning-server.js";
import type { LearningStateStore } from "./state/learning-state.js";
import type { StartLearningInput } from "./state/learning-state.js";
import { openWorkspace as defaultOpenWorkspace } from "./utils/browser.js";

export interface LearningCommandDependencies {
  state: LearningStateStore;
  broker: InteractionBroker;
  server: LearningServer;
  /** Injectable for tests; defaults to the system browser opener. */
  openWorkspace?: (url: string) => Promise<void>;
}

export function registerLearningCommands(
  pi: ExtensionAPI,
  dependencies: LearningCommandDependencies
): void {
  const { state, server } = dependencies;
  const openWorkspace = dependencies.openWorkspace ?? defaultOpenWorkspace;

  pi.registerCommand("learn", {
    description: "Start a structured learning session: /learn <course> <topic>",
    handler: async (args, ctx) => {
      const target = parseLearningTarget(args);
      if (target === undefined) {
        ctx.ui.notify("Usage: /learn <course> <topic>", "warning");
        return;
      }

      state.start(target);
      const snapshot = state.snapshot();
      pi.setSessionName(
        `Learn: ${target.course.title} - ${target.topic.title}`
      );
      pi.appendEntry("learning-state", { version: 1, state: snapshot });
      const workspaceUrl = await ensureServerStarted(server, ctx);
      const workspaceLine =
        workspaceUrl === undefined ? "" : `\nWorkspace: ${workspaceUrl}`;
      ctx.ui.notify(
        `Learning Mode enabled: ${target.course.title} / ${target.topic.title}${workspaceLine}`,
        "info"
      );

      const kickoff = [
        `Begin a structured learning session for ${target.course.title} / ${target.topic.title}.`,
        "Start with a concise diagnostic and teach interactively.",
        "Use the registered learning_* tools whenever the learner must respond."
      ].join(" ");
      if (ctx.isIdle()) {
        pi.sendUserMessage(kickoff);
      } else {
        pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
      }
    }
  });

  pi.registerCommand("learn-open", {
    description: "Open the learning workspace in a browser",
    handler: async (_args, ctx) => {
      const url = await ensureServerStarted(server, ctx);
      if (url === undefined) {
        return;
      }
      await openWorkspace(url);
      ctx.ui.notify(`Learning workspace: ${url}`, "info");
    }
  });

  pi.registerCommand("learn-status", {
    description: "Show the current learning session status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatLearningStatus(state, dependencies.broker), "info");
    }
  });

  pi.registerCommand("learn-stop", {
    description: "Stop the current learning session",
    handler: async (_args, ctx) => {
      state.stop();
      dependencies.broker.cancelAll("learning_stopped");
      pi.appendEntry("learning-state", { version: 1, state: state.snapshot() });
      ctx.ui.notify("Learning Mode disabled.", "info");
    }
  });
}

export function formatLearningStatus(
  state: LearningStateStore,
  broker: InteractionBroker
): string {
  const snapshot = state.snapshot();
  const course = snapshot.course?.title ?? "none";
  const topic = snapshot.topic?.title ?? "none";
  const pending = broker.getPending();
  return [
    `Learning Mode: ${snapshot.enabled ? "ON" : "OFF"}`,
    `Course: ${course}`,
    `Topic: ${topic}`,
    `Phase: ${snapshot.phase}`,
    `Pending interaction: ${pending[0]?.id ?? "none"}`,
    `Concepts: ${Object.keys(snapshot.concepts).length}`
  ].join("\n");
}

export function parseLearningTarget(args: string): StartLearningInput | undefined {
  const parts = args.trim().split(/\s+/u).filter(Boolean);
  const courseName = parts[0];
  const topicParts = parts.slice(1);
  if (courseName === undefined || topicParts.length === 0) {
    return undefined;
  }

  const topicName = topicParts.join(" ");
  return {
    course: { id: toId(courseName), title: toTitle(courseName) },
    topic: { id: toId(topicName), title: toTitle(topicName) }
  };
}

function toId(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, "-");
}

/** Start the workspace server (lazy) and return its URL, or undefined on failure. */
async function ensureServerStarted(
  server: LearningServer,
  ctx: ExtensionCommandContext
): Promise<string | undefined> {
  try {
    await server.start();
    return server.url();
  } catch (error) {
    ctx.ui.notify(
      `Learning workspace server failed to start: ${String(error)}`,
      "warning"
    );
    return undefined;
  }
}

function toTitle(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}
