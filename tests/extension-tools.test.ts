import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { createAskSingleChoiceTool } from "../extension/tools/ask-single-choice.js";
import { createAskMultiChoiceTool } from "../extension/tools/ask-multi-choice.js";
import { createAskFreeResponseTool } from "../extension/tools/ask-free-response.js";
import { createAskCodeTool } from "../extension/tools/ask-code.js";
import { createBrokerBackedTuiPresenter } from "../extension/tools/tui-presenter.js";
import { InteractionBroker } from "../extension/server/interaction-broker.js";

describe("learning tools", () => {
  it("returns a TUI single-choice selection as a structured tool result", async () => {
    const select = vi.fn().mockResolvedValue("2. impl<T> Container<T>");
    const ctx = {
      hasUI: true,
      ui: { select }
    } as unknown as ExtensionContext;
    const timestamps = [1_000, 1_500];
    const tool = createAskSingleChoiceTool({
      createId: () => "q_test",
      now: () => timestamps.shift() ?? 1_500
    });

    const result = await tool.execute(
      "tool_call_1",
      {
        question: "Which declaration is generic?",
        options: [
          { id: "A", label: "struct Container" },
          { id: "B", label: "impl<T> Container<T>" }
        ],
        conceptId: "rust-generics"
      },
      undefined,
      undefined,
      ctx
    );

    expect(select).toHaveBeenCalledWith(
      "Which declaration is generic?",
      ["1. struct Container", "2. impl<T> Container<T>"],
      undefined
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "Learner selected option B (interaction q_test)." }],
      details: {
        interactionId: "q_test",
        type: "single_choice",
        answer: { optionId: "B" },
        responseTimeMs: 500,
        conceptId: "rust-generics"
      }
    });
  });

  it("normalizes a single-choice request before presenting it", async () => {
    const present = vi.fn().mockResolvedValue({
      interactionId: "q_presented",
      type: "single_choice",
      answer: { optionId: "A" },
      responseTimeMs: 250
    });
    const ctx = { hasUI: false, ui: {} } as unknown as ExtensionContext;
    const tool = createAskSingleChoiceTool({
      createId: () => "q_presented",
      now: () => 1_000,
      present
    });

    const result = await tool.execute(
      "tool_call_2",
      {
        question: "Pick one",
        options: [
          { id: "A", label: "First" },
          { id: "B", label: "Second" }
        ]
      },
      undefined,
      undefined,
      ctx
    );

    expect(present).toHaveBeenCalledWith(
      {
        id: "q_presented",
        type: "single_choice",
        question: "Pick one",
        options: [
          { id: "A", label: "First" },
          { id: "B", label: "Second" }
        ],
        allowSkip: false,
        createdAt: 1_000
      },
      undefined,
      ctx
    );
    expect(result.details.responseTimeMs).toBe(250);
  });

  it("returns a TUI multi-choice selection as a structured tool result", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("1. impl<T> Container<T>")
      .mockResolvedValueOnce("2. fn id<T>(value: T)")
      .mockResolvedValueOnce("3. fn id(value)")
      .mockResolvedValueOnce("3. fn id(value)")
      .mockResolvedValueOnce("✔ 完成");
    const ctx = {
      hasUI: true,
      ui: { select, notify: vi.fn() }
    } as unknown as ExtensionContext;
    const timestamps = [1_000, 1_500];
    const tool = createAskMultiChoiceTool({
      createId: () => "q_multi_test",
      now: () => timestamps.shift() ?? 1_500
    });

    const result = await tool.execute(
      "tool_call_multi",
      {
        question: "Which declarations are generic?",
        options: [
          { id: "A", label: "impl<T> Container<T>" },
          { id: "B", label: "fn id<T>(value: T)" },
          { id: "C", label: "fn id(value)" }
        ],
        conceptId: "rust-generics"
      },
      undefined,
      undefined,
      ctx
    );

    // 选 A、B，把 C 加上又取消（toggle），最后完成：期望 [A, B]。
    expect(select).toHaveBeenCalledTimes(5);
    expect(select.mock.calls[0]?.[1]).toEqual([
      "1. impl<T> Container<T>",
      "2. fn id<T>(value: T)",
      "3. fn id(value)",
      "✔ 完成"
    ]);
    expect(result).toEqual({
      content: [{ type: "text", text: "Learner selected options A, B (interaction q_multi_test)." }],
      details: {
        interactionId: "q_multi_test",
        type: "multi_choice",
        answer: { optionIds: ["A", "B"] },
        responseTimeMs: 500,
        conceptId: "rust-generics"
      }
    });
  });

  it("normalizes a multi-choice request before presenting it", async () => {
    const present = vi.fn().mockResolvedValue({
      interactionId: "q_multi_presented",
      type: "multi_choice",
      answer: { optionIds: ["A", "B"] },
      responseTimeMs: 250
    });
    const ctx = { hasUI: false, ui: {} } as unknown as ExtensionContext;
    const tool = createAskMultiChoiceTool({
      createId: () => "q_multi_presented",
      now: () => 1_000,
      present
    });

    const result = await tool.execute(
      "tool_call_multi_2",
      {
        title: "Generics",
        question: "Pick all that apply",
        options: [
          { id: "A", label: "First" },
          { id: "B", label: "Second" },
          { id: "C", label: "Third" }
        ]
      },
      undefined,
      undefined,
      ctx
    );

    expect(present).toHaveBeenCalledWith(
      {
        id: "q_multi_presented",
        type: "multi_choice",
        title: "Generics",
        question: "Pick all that apply",
        options: [
          { id: "A", label: "First" },
          { id: "B", label: "Second" },
          { id: "C", label: "Third" }
        ],
        allowSkip: false,
        createdAt: 1_000
      },
      undefined,
      ctx
    );
    expect(result.details.responseTimeMs).toBe(250);
  });

  it("does not submit an empty multi-choice when done is picked with nothing selected", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("✔ 完成")
      .mockResolvedValueOnce("1. First")
      .mockResolvedValueOnce("✔ 完成");
    const notify = vi.fn();
    const ctx = {
      hasUI: true,
      ui: { select, notify }
    } as unknown as ExtensionContext;
    const timestamps = [3_000, 3_400];
    const tool = createAskMultiChoiceTool({
      createId: () => "q_multi_empty_done",
      now: () => timestamps.shift() ?? 3_400
    });

    const result = await tool.execute(
      "tool_call_multi_4",
      {
        question: "Pick all",
        options: [
          { id: "A", label: "First" },
          { id: "B", label: "Second" }
        ]
      },
      undefined,
      undefined,
      ctx
    );

    // 第一次选“完成”时零选：警告并重开循环，最终只提交了实际选中的项。
    expect(notify).toHaveBeenCalledWith("至少选择一个选项后再完成。", "warning");
    expect(select).toHaveBeenCalledTimes(3);
    expect(result.details).toMatchObject({
      interactionId: "q_multi_empty_done",
      type: "multi_choice",
      answer: { optionIds: ["A"] },
      responseTimeMs: 400
    });
  });

  it("treats Escape in the multi-choice loop as a cancelled interaction", async () => {
    const select = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      hasUI: true,
      ui: { select, notify: vi.fn() }
    } as unknown as ExtensionContext;
    const timestamps = [2_000, 2_100];
    const tool = createAskMultiChoiceTool({
      createId: () => "q_multi_cancel",
      now: () => timestamps.shift() ?? 2_100
    });

    await expect(
      tool.execute(
        "tool_call_multi_3",
        {
          question: "Pick all",
          options: [
            { id: "A", label: "First" },
            { id: "B", label: "Second" }
          ]
        },
        undefined,
        undefined,
        ctx
      )
    ).rejects.toThrow("Learner cancelled interaction q_multi_cancel.");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("returns a single-line free response from the TUI input", async () => {
    const input = vi.fn().mockResolvedValue("A trait bound constrains T.");
    const ctx = {
      hasUI: true,
      ui: { input }
    } as unknown as ExtensionContext;
    const timestamps = [2_000, 2_125];
    const tool = createAskFreeResponseTool({
      createId: () => "free_test",
      now: () => timestamps.shift() ?? 2_125
    });

    const result = await tool.execute(
      "tool_call_free",
      {
        question: "What does a trait bound constrain?",
        placeholder: "Answer in one sentence",
        multiline: false,
        conceptId: "trait-bounds"
      },
      undefined,
      undefined,
      ctx
    );

    expect(input).toHaveBeenCalledWith(
      "What does a trait bound constrain?",
      "Answer in one sentence",
      undefined
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Learner submitted this free response:\nA trait bound constrains T.\n(interaction free_test)"
        }
      ],
      details: {
        interactionId: "free_test",
        type: "free_response",
        answer: { text: "A trait bound constrains T." },
        responseTimeMs: 125,
        conceptId: "trait-bounds"
      }
    });
  });

  it("returns code from the TUI editor without running it", async () => {
    const editor = vi
      .fn()
      .mockResolvedValue("fn identity<T>(value: T) -> T { value }");
    const ctx = {
      hasUI: true,
      ui: { editor }
    } as unknown as ExtensionContext;
    const timestamps = [3_000, 3_400];
    const tool = createAskCodeTool({
      createId: () => "code_test",
      now: () => timestamps.shift() ?? 3_400
    });

    const result = await tool.execute(
      "tool_call_code",
      {
        instructions: "Implement a generic identity function.",
        language: "rust",
        starterCode: "fn identity<T>(value: T) -> T {\n    todo!()\n}",
        conceptId: "generic-functions"
      },
      undefined,
      undefined,
      ctx
    );

    expect(editor).toHaveBeenCalledWith(
      "Implement a generic identity function.",
      "fn identity<T>(value: T) -> T {\n    todo!()\n}"
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Learner submitted code in rust:\nfn identity<T>(value: T) -> T { value }\n(interaction code_test)"
        }
      ],
      details: {
        interactionId: "code_test",
        type: "code",
        answer: {
          language: "rust",
          code: "fn identity<T>(value: T) -> T { value }"
        },
        responseTimeMs: 400,
        conceptId: "generic-functions"
      }
    });
  });

  it("normalizes a code request with read-only ranges before presenting it", async () => {
    const present = vi.fn().mockResolvedValue({
      interactionId: "q_code_ro",
      type: "code",
      answer: { language: "python", code: "x = 1" },
      responseTimeMs: 250
    });
    const ctx = { hasUI: false, ui: {} } as unknown as ExtensionContext;
    const tool = createAskCodeTool({
      createId: () => "q_code_ro",
      now: () => 1_000,
      present
    });

    await tool.execute(
      "tool_call_code_ro",
      {
        instructions: "Fill in the function body.",
        language: "python",
        starterCode: "def f():\n    pass",
        readOnlyRanges: [{ start: 0, end: 9 }]
      },
      undefined,
      undefined,
      ctx
    );

    expect(present).toHaveBeenCalledWith(
      {
        id: "q_code_ro",
        type: "code",
        instructions: "Fill in the function body.",
        language: "python",
        starterCode: "def f():\n    pass",
        readOnlyRanges: [{ start: 0, end: 9 }],
        createdAt: 1_000
      },
      undefined,
      ctx
    );
  });

  it("omits readOnlyRanges from the interaction when not provided", async () => {
    const present = vi.fn().mockResolvedValue({
      interactionId: "q_code_plain",
      type: "code",
      answer: { language: "python", code: "x = 1" },
      responseTimeMs: 250
    });
    const ctx = { hasUI: false, ui: {} } as unknown as ExtensionContext;
    const tool = createAskCodeTool({
      createId: () => "q_code_plain",
      now: () => 2_000,
      present
    });

    await tool.execute(
      "tool_call_code_plain",
      { instructions: "Write a function.", language: "python" },
      undefined,
      undefined,
      ctx
    );

    const interaction = present.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(interaction).toEqual({
      id: "q_code_plain",
      type: "code",
      instructions: "Write a function.",
      language: "python",
      starterCode: "",
      createdAt: 2_000
    });
    // exactOptionalPropertyTypes：缺省时键不出现，而不是值为 undefined。
    expect(Object.prototype.hasOwnProperty.call(interaction, "readOnlyRanges")).toBe(
      false
    );
  });

  it("routes a TUI single-choice answer through the interaction broker", async () => {
    let resolveSelection: ((value: string) => void) | undefined;
    const select = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSelection = resolve;
        })
    );
    const ctx = {
      hasUI: true,
      ui: { select }
    } as unknown as ExtensionContext;
    const interaction = {
      id: "q_broker_tui",
      type: "single_choice" as const,
      question: "Choose A",
      options: [{ id: "A", label: "Answer" }, { id: "B", label: "Other" }],
      allowSkip: false,
      createdAt: Date.now()
    };
    const broker = new InteractionBroker();
    const presenter = createBrokerBackedTuiPresenter(broker);
    const answerPromise = presenter.presentSingleChoice(
      interaction,
      undefined,
      ctx
    );

    expect(broker.getPending()).toEqual([interaction]);
    resolveSelection?.("1. Answer");

    await expect(answerPromise).resolves.toMatchObject({
      interactionId: "q_broker_tui",
      type: "single_choice",
      answer: { optionId: "A" }
    });
    expect(broker.getPending()).toEqual([]);
  });

  it("returns an externally submitted answer while the TUI is still open", async () => {
    let resolveSelection: ((value: string) => void) | undefined;
    const select = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSelection = resolve;
        })
    );
    const ctx = {
      hasUI: true,
      ui: { select }
    } as unknown as ExtensionContext;
    const interaction = {
      id: "q_external_submit",
      type: "single_choice" as const,
      question: "Choose an answer",
      options: [
        { id: "A", label: "First" },
        { id: "B", label: "Second" }
      ],
      allowSkip: false,
      createdAt: Date.now()
    };
    const broker = new InteractionBroker();
    const presenter = createBrokerBackedTuiPresenter(broker);
    const answerPromise = presenter.presentSingleChoice(
      interaction,
      undefined,
      ctx
    );

    expect(broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "B" },
      clientTimestamp: Date.now()
    })).toMatchObject({ ok: true });

    await expect(answerPromise).resolves.toMatchObject({
      interactionId: interaction.id,
      type: "single_choice",
      answer: { optionId: "B" }
    });
    expect(broker.getPending()).toEqual([]);
    resolveSelection?.("1. First");
  });

  it("rejects promptly when the broker cancels while the TUI is open", async () => {
    const select = vi.fn(
      (
        _title: string,
        _choices: string[],
        options: { signal?: AbortSignal } | undefined
      ) =>
        new Promise<undefined>((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () => resolve(undefined),
            { once: true }
          );
        })
    );
    const ctx = {
      hasUI: true,
      ui: { select }
    } as unknown as ExtensionContext;
    const interaction = {
      id: "q_cancel_open_tui",
      type: "single_choice" as const,
      question: "Choose an answer",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: Date.now()
    };
    const broker = new InteractionBroker();
    const presenter = createBrokerBackedTuiPresenter(broker);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const answerPromise = presenter.presentSingleChoice(
        interaction,
        undefined,
        ctx
      );
      broker.cancelAll("session_shutdown");

      await expect(answerPromise).rejects.toMatchObject({
        name: "InteractionCancelledError",
        message:
          "Interaction q_cancel_open_tui was cancelled: session_shutdown."
      });
      await Promise.resolve();
      expect(broker.getPending()).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
});
