import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

describe("Pi extension loading", () => {
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
        "learning_ask_single_choice"
      ]);
      expect([...extension!.commands.keys()].sort()).toEqual([
        "learn",
        "learn-open",
        "learn-status",
        "learn-stop"
      ]);
      expect(extension!.handlers.has("session_start")).toBe(true);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
