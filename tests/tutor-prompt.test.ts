import type { ExtensionAPI, ExtensionHandler } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerTutorPrompt } from "../extension/tutor-prompt.js";
import { LearningStateStore } from "../extension/state/learning-state.js";

describe("tutor prompt", () => {
  it("does not modify the system prompt when learning mode is disabled", async () => {
    let handler: ExtensionHandler<any, any> | undefined;
    const pi = {
      on: (_event: string, next: ExtensionHandler<any, any>) => {
        handler = next;
      }
    } as unknown as ExtensionAPI;
    registerTutorPrompt(pi, { state: new LearningStateStore() });

    const result = await handler?.(
      {
        systemPrompt: "base",
        prompt: "hello"
      },
      {} as never
    );

    expect(result).toBeUndefined();
  });

  it("appends teaching policy and current state when learning is enabled", async () => {
    let handler: ExtensionHandler<any, any> | undefined;
    const pi = {
      on: (_event: string, next: ExtensionHandler<any, any>) => {
        handler = next;
      }
    } as unknown as ExtensionAPI;
    const state = new LearningStateStore();
    state.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });
    registerTutorPrompt(pi, { state });

    const result = await handler?.(
      {
        systemPrompt: "existing system prompt",
        prompt: "start"
      },
      {} as never
    );
    const systemPrompt = result?.systemPrompt as string;

    expect(systemPrompt).toContain("existing system prompt");
    expect(systemPrompt).toContain("You are operating in Learning Mode.");
    expect(systemPrompt).toContain("learning_ask_single_choice");
    expect(systemPrompt).toContain("learning_ask_multi_choice");
    expect(systemPrompt).toContain("learning_ask_free_response");
    expect(systemPrompt).toContain("learning_ask_code");
    expect(systemPrompt).toContain("self-contained");
    expect(systemPrompt).toContain("one primary learner interaction at a time");
    expect(systemPrompt).toContain("Current course: Rust");
    expect(systemPrompt).toContain("Current topic: Generics");
  });
});
