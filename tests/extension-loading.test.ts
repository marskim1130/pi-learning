import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import learningExtension from "../extension/index.js";

describe("Pi extension loading", () => {
  it("persists mastery changes produced by the record-attempt tool", async () => {
    const tools = new Map<string, ToolDefinition>();
    const appendEntry = vi.fn();
    const pi = {
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
      appendEntry
    } as unknown as ExtensionAPI;
    learningExtension(pi);

    const ctx = {
      hasUI: true,
      ui: { select: vi.fn().mockResolvedValue("1. Move transfers ownership") }
    } as unknown as ExtensionContext;
    const askTool = tools.get("learning_ask_single_choice");
    const answer = await askTool?.execute(
      "tool_call_question",
      {
        question: "What does move do?",
        options: [
          { id: "A", label: "Move transfers ownership" },
          { id: "B", label: "Move copies every value" }
        ]
      },
      undefined,
      undefined,
      ctx
    );
    const interactionId = (answer?.details as { interactionId: string })
      .interactionId;
    const tool = tools.get("learning_record_attempt");
    await tool?.execute(
      "tool_call_1",
      {
        interactionId,
        conceptId: "ownership",
        outcome: "correct",
        evidenceType: "choice"
      },
      undefined,
      undefined,
      ctx
    );

    expect(appendEntry).toHaveBeenCalledWith(
      "learning-state",
      expect.objectContaining({
        version: 1,
        state: expect.objectContaining({
          concepts: expect.objectContaining({
            ownership: expect.objectContaining({ mastery: 0.28, attempts: 1 })
          })
        })
      })
    );
  });

  it("loads the learning extension and registers its public surface", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-learning-agent-"));
    try {
      const extensionPath = resolve("extension/index.ts");
      const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir,
        additionalExtensionPaths: [extensionPath],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true
      });

      await loader.reload();
      const loaded = loader.getExtensions();
      const extension = loaded.extensions.find(
        (candidate) => candidate.resolvedPath === extensionPath
      );

      expect(loaded.errors).toEqual([]);
      expect([...extension!.tools.keys()].sort()).toEqual([
        "learning_ask_code",
        "learning_ask_free_response",
        "learning_ask_multi_choice",
        "learning_ask_single_choice",
        "learning_record_attempt"
      ]);
      expect([...extension!.commands.keys()].sort()).toEqual([
        "learn",
        "learn-open",
        "learn-reset",
        "learn-status",
        "learn-stop"
      ]);
      expect(extension!.handlers.has("session_start")).toBe(true);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
