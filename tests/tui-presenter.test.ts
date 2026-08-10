import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAskCodeTool } from "../extension/tools/ask-code.js";
import { createAskFreeResponseTool } from "../extension/tools/ask-free-response.js";
import {
  createBrokerBackedTuiPresenter,
  createModeAwarePresenter,
  type TuiLearningPresenter
} from "../extension/tools/tui-presenter.js";
import { InteractionBroker } from "../extension/server/interaction-broker.js";

interface CustomFactory {
  (tui: unknown, theme: unknown, keybindings: unknown, done: (result: unknown) => void): unknown;
}

interface PendingCustom {
  factory: CustomFactory;
  done: (result: unknown) => void;
}

/**
 * Mocks `ctx.ui.custom` the way Pi's TUI resolves it: the factory is invoked
 * with (tui, theme, keybindings, done) and must return a component; the
 * promise resolves with whatever `done` receives.
 */
function createTuiModeCtx() {
  const pendings: PendingCustom[] = [];
  const custom = vi.fn((factory: CustomFactory) => {
    return new Promise((resolve) => {
      pendings.push({ factory, done: (result) => resolve(result) });
    });
  });
  const notify = vi.fn();
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: { custom, notify }
  } as unknown as ExtensionContext;

  const instantiate = (): {
    editor: any;
    done: (result: unknown) => void;
  } => {
    const pending = pendings.shift();
    if (pending === undefined) {
      throw new Error("ctx.ui.custom was never called");
    }
    const tui = { requestRender: () => {} };
    const theme = { fg: () => (text: string) => text };
    const editor = pending.factory(tui, theme, {}, pending.done);
    return { editor, done: pending.done };
  };

  return { ctx, custom, notify, instantiate };
}

describe("TUI custom editor presenter (ctx.mode === 'tui')", () => {
  it("submits code from the custom editor as a structured tool result", async () => {
    const { ctx, custom, instantiate } = createTuiModeCtx();
    const timestamps = [1_000, 1_900];
    const tool = createAskCodeTool({
      createId: () => "code_tui",
      now: () => timestamps.shift() ?? 1_900
    });

    const resultPromise = tool.execute(
      "tool_call_1",
      {
        instructions: "Implement a generic identity function.",
        language: "rust",
        starterCode: "fn identity<T>(value: T) -> T { todo!() }"
      },
      undefined,
      undefined,
      ctx
    );

    expect(custom).toHaveBeenCalledTimes(1);
    const { editor } = instantiate();
    expect(editor).toBeDefined();
    expect(editor.getText()).toBe("fn identity<T>(value: T) -> T { todo!() }");

    editor.onSubmit("fn identity<T>(value: T) -> T { value }");

    const result = await resultPromise;
    expect(result).toEqual({
      content: [{ type: "text", text: "Learner submitted code in rust." }],
      details: {
        interactionId: "code_tui",
        type: "code",
        answer: {
          language: "rust",
          code: "fn identity<T>(value: T) -> T { value }"
        },
        responseTimeMs: 900
      }
    });
  });

  it("submits a multiline free response from the custom editor", async () => {
    const { ctx, instantiate } = createTuiModeCtx();
    const timestamps = [2_000, 2_050];
    const tool = createAskFreeResponseTool({
      createId: () => "free_tui",
      now: () => timestamps.shift() ?? 2_050
    });

    const resultPromise = tool.execute(
      "tool_call_2",
      {
        question: "Explain trait bounds in your own words.",
        multiline: true
      },
      undefined,
      undefined,
      ctx
    );

    const { editor } = instantiate();
    editor.onSubmit("A trait bound restricts which types T may be.");

    const result = await resultPromise;
    expect(result.details).toMatchObject({
      interactionId: "free_tui",
      type: "free_response",
      answer: { text: "A trait bound restricts which types T may be." }
    });
  });

  it("treats Escape in the custom editor as a cancelled interaction", async () => {
    const { ctx, instantiate } = createTuiModeCtx();
    const timestamps = [3_000, 3_100];
    const tool = createAskCodeTool({
      createId: () => "code_escape",
      now: () => timestamps.shift() ?? 3_100
    });

    const resultPromise = tool.execute(
      "tool_call_3",
      {
        instructions: "Write any code.",
        language: "python",
        starterCode: ""
      },
      undefined,
      undefined,
      ctx
    );

    const { editor } = instantiate();
    editor.onEscape();

    await expect(resultPromise).rejects.toThrow(
      "Learner cancelled interaction code_escape."
    );
  });

  it("rejects when the broker cancels while the custom editor is open", async () => {
    const { ctx, instantiate } = createTuiModeCtx();
    const broker = new InteractionBroker();
    const presenter: TuiLearningPresenter =
      createBrokerBackedTuiPresenter(broker);
    const interaction = {
      id: "code_broker_cancel",
      type: "code" as const,
      instructions: "Write a function.",
      language: "go",
      starterCode: "package main\n",
      createdAt: 4_000
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const answerPromise = presenter.presentCode(interaction, undefined, ctx);
      expect(broker.getPending()).toEqual([interaction]);

      instantiate();
      broker.cancelAll("session_shutdown");

      await expect(answerPromise).rejects.toMatchObject({
        name: "InteractionCancelledError",
        message:
          "Interaction code_broker_cancel was cancelled: session_shutdown."
      });
      await Promise.resolve();
      expect(broker.getPending()).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
});

describe("createModeAwarePresenter (uiMode auto)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function singleChoice(id: string) {
    return {
      id,
      type: "single_choice" as const,
      question: `Question ${id}`,
      options: [
        { id: "A", label: "First" },
        { id: "B", label: "Second" }
      ],
      allowSkip: true,
      createdAt: 5_000
    };
  }

  it("presents to the broker only and never touches the TUI when a web client is connected", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_100);
    const broker = new InteractionBroker();
    const select = vi.fn();
    const ctx = { hasUI: false, ui: { select } } as unknown as ExtensionContext;
    const presenter = createModeAwarePresenter(broker, () => true);
    const interaction = singleChoice("web_presented");

    const answerPromise = presenter.presentSingleChoice(
      interaction,
      undefined,
      ctx
    );

    expect(select).not.toHaveBeenCalled();
    expect(broker.getPending()).toEqual([interaction]);

    const submitted = broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "B" },
      clientTimestamp: 5_100
    });
    expect(submitted.ok).toBe(true);

    const answer = await answerPromise;
    expect(answer).toEqual({
      interactionId: interaction.id,
      type: "single_choice",
      answer: { optionId: "B" },
      responseTimeMs: 100
    });
    expect(broker.getPending()).toEqual([]);
  });

  it("web branch passes the tool abort signal through: pre-aborted signal rejects immediately", async () => {
    const broker = new InteractionBroker();
    const presenter = createModeAwarePresenter(broker, () => true);
    const signal = AbortSignal.abort();

    await expect(
      presenter.presentSingleChoice(singleChoice("web_aborted"), signal, {
        hasUI: true,
        ui: { select: vi.fn() }
      } as unknown as ExtensionContext)
    ).rejects.toThrow(/aborted/iu);
    expect(broker.getPending()).toEqual([]);
  });

  it("web branch covers free response broker-only (ctx.ui untouched, submit resolves)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_100);
    const broker = new InteractionBroker();
    const input = vi.fn();
    const ctx = { hasUI: true, ui: { input } } as unknown as ExtensionContext;
    const presenter = createModeAwarePresenter(broker, () => true);
    const interaction = {
      id: "web_free_response",
      type: "free_response" as const,
      question: "Explain generics.",
      multiline: true,
      createdAt: 5_000
    };

    const answerPromise = presenter.presentFreeResponse(interaction, undefined, ctx);
    expect(input).not.toHaveBeenCalled();
    expect(broker.getPending()).toEqual([interaction]);

    const submitted = broker.submit({
      interactionId: interaction.id,
      answer: { text: "Type params." },
      clientTimestamp: 5_100
    });
    expect(submitted.ok).toBe(true);

    const answer = await answerPromise;
    expect(answer.answer).toEqual({ text: "Type params." });
    expect(broker.getPending()).toEqual([]);
  });

  it("falls back to the TUI select when no web client is connected", async () => {
    const broker = new InteractionBroker();
    const select = vi.fn().mockResolvedValue("2. Second");
    const ctx = { hasUI: true, ui: { select } } as unknown as ExtensionContext;
    const presenter = createModeAwarePresenter(broker, () => false);
    const interaction = singleChoice("tui_fallback");

    const answer = await presenter.presentSingleChoice(
      interaction,
      undefined,
      ctx
    );

    expect(select).toHaveBeenCalledWith(
      "Question tui_fallback",
      ["1. First", "2. Second"],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(answer.answer).toEqual({ optionId: "B" });
    expect(broker.getPending()).toEqual([]);
  });

  it("routes per call: web first, then TUI once the client disconnects", async () => {
    const broker = new InteractionBroker();
    let webConnected = true;
    const select = vi.fn().mockResolvedValue("1. First");
    const ctx = { hasUI: true, ui: { select } } as unknown as ExtensionContext;
    const presenter = createModeAwarePresenter(broker, () => webConnected);

    const first = presenter.presentSingleChoice(
      singleChoice("web_then_tui_a"),
      undefined,
      ctx
    );
    expect(select).not.toHaveBeenCalled();
    broker.submit({
      interactionId: "web_then_tui_a",
      answer: { optionId: "A" },
      clientTimestamp: 5_200
    });
    await expect(first).resolves.toMatchObject({ answer: { optionId: "A" } });

    webConnected = false;
    const second = await presenter.presentSingleChoice(
      singleChoice("web_then_tui_b"),
      undefined,
      ctx
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(second.answer).toEqual({ optionId: "A" });
  });
});
