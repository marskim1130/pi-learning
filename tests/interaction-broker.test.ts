import { afterEach, describe, expect, it, vi } from "vitest";

import { InteractionBroker } from "../extension/server/interaction-broker.js";

describe("InteractionBroker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes an interaction as pending after present", () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_1",
      type: "single_choice" as const,
      question: "Which Rust syntax declares a generic parameter?",
      options: [
        { id: "A", label: "fn id<T>(value: T)" },
        { id: "B", label: "fn id(value: generic)" }
      ],
      allowSkip: false,
      createdAt: 1_786_212_345_678
    };

    void broker.present(interaction);

    expect(broker.getPending()).toEqual([interaction]);
  });

  it("resolves the matching interaction with a structured answer", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_500);
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_2",
      type: "single_choice" as const,
      question: "Which option is generic?",
      options: [{ id: "A", label: "fn id<T>(value: T)" }],
      allowSkip: false,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    const submitResult = broker.submit({
      interactionId: "q_2",
      answer: { optionId: "A" },
      clientTimestamp: 1_450
    });

    await expect(answerPromise).resolves.toEqual({
      interactionId: "q_2",
      type: "single_choice",
      answer: { optionId: "A" },
      responseTimeMs: 500
    });
    expect(submitResult.ok).toBe(true);
  });

  it("resolves a multi_choice submission with the structured answer and clears pending", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_500);
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_multi",
      type: "multi_choice" as const,
      question: "Which are generic?",
      options: [
        { id: "A", label: "fn id<T>(value: T)" },
        { id: "B", label: "struct Container<T>" },
        { id: "C", label: "fn id(value)" }
      ],
      allowSkip: false,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    const submitResult = broker.submit({
      interactionId: "q_multi",
      answer: { optionIds: ["A", "B"] },
      clientTimestamp: 1_450
    });

    await expect(answerPromise).resolves.toEqual({
      interactionId: "q_multi",
      type: "multi_choice",
      answer: { optionIds: ["A", "B"] },
      responseTimeMs: 500
    });
    expect(submitResult.ok).toBe(true);
    expect(broker.getPending()).toEqual([]);
  });

  it("rejects a multi_choice answer with unknown options", () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_multi_invalid",
      type: "multi_choice" as const,
      question: "Pick all",
      options: [{ id: "A", label: "Answer" }, { id: "B", label: "Other" }],
      allowSkip: false,
      createdAt: 1_000
    };
    void broker.present(interaction);

    expect(
      broker.submit({
        interactionId: interaction.id,
        answer: { optionIds: ["A", "Z"] },
        clientTimestamp: 1_100
      })
    ).toEqual({
      ok: false,
      reason: "invalid_answer",
      message: "Option Z does not belong to interaction q_multi_invalid."
    });
    expect(broker.getPending()).toEqual([interaction]);
  });

  it("rejects an unknown interaction id without changing pending work", () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_pending",
      type: "single_choice" as const,
      question: "Pending question",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    void broker.present(interaction);

    expect(
      broker.submit({
        interactionId: "q_missing",
        answer: { optionId: "A" },
        clientTimestamp: 1_100
      })
    ).toEqual({
      ok: false,
      reason: "not_found",
      message: "No pending interaction with id q_missing."
    });
    expect(broker.getPending()).toEqual([interaction]);
  });

  it("rejects a duplicate submission as already resolved", () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_duplicate",
      type: "single_choice" as const,
      question: "Submit once",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    void broker.present(interaction);
    const submission = {
      interactionId: interaction.id,
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    };

    broker.submit(submission);

    expect(broker.submit(submission)).toEqual({
      ok: false,
      reason: "already_resolved",
      message: "Interaction q_duplicate has already been resolved."
    });
  });

  it("rejects and clears a pending interaction when aborted", async () => {
    const broker = new InteractionBroker();
    const controller = new AbortController();
    const answerPromise = broker.present(
      {
        id: "q_abort",
        type: "single_choice",
        question: "Wait for an answer",
        options: [{ id: "A", label: "Answer" }],
        allowSkip: false,
        createdAt: 1_000
      },
      controller.signal
    );

    controller.abort();
    const outcome = await Promise.race([
      answerPromise.catch((error: unknown) => error),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("still pending"), 0);
      })
    ]);

    expect(outcome).toMatchObject({
      name: "InteractionCancelledError",
      message: "Interaction q_abort was cancelled: aborted."
    });
    expect(broker.getPending()).toEqual([]);
  });

  it("cancels one pending interaction without affecting another", async () => {
    const broker = new InteractionBroker();
    const firstPromise = broker.present({
      id: "q_first",
      type: "single_choice",
      question: "First",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    });
    const second = {
      id: "q_second",
      type: "single_choice" as const,
      question: "Second",
      options: [{ id: "B", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_100
    };
    void broker.present(second);

    broker.cancel("q_first", "topic changed");

    await expect(firstPromise).rejects.toMatchObject({
      name: "InteractionCancelledError",
      message: "Interaction q_first was cancelled: topic changed."
    });
    expect(broker.getPending()).toEqual([second]);
  });

  it("cancels all pending interactions during shutdown", async () => {
    const broker = new InteractionBroker();
    const firstPromise = broker.present({
      id: "q_shutdown_1",
      type: "single_choice",
      question: "First",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    });
    const secondPromise = broker.present({
      id: "q_shutdown_2",
      type: "single_choice",
      question: "Second",
      options: [{ id: "B", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_100
    });

    broker.cancelAll("session_shutdown");

    await expect(firstPromise).rejects.toMatchObject({
      name: "InteractionCancelledError"
    });
    await expect(secondPromise).rejects.toMatchObject({
      name: "InteractionCancelledError"
    });
    expect(broker.getPending()).toEqual([]);
  });

  it("rejects a single-choice option that is not part of the interaction", () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_validate",
      type: "single_choice" as const,
      question: "Choose A",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    void broker.present(interaction);

    expect(
      broker.submit({
        interactionId: interaction.id,
        answer: { optionId: "B" },
        clientTimestamp: 1_100
      })
    ).toEqual({
      ok: false,
      reason: "invalid_answer",
      message: "Option B does not belong to interaction q_validate."
    });
    expect(broker.getPending()).toEqual([interaction]);
  });

  it("rejects a duplicate pending interaction id without replacing the first", async () => {
    const broker = new InteractionBroker();
    const first = {
      id: "q_collision",
      type: "single_choice" as const,
      question: "First",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    void broker.present(first);

    const duplicatePromise = broker.present({
      ...first,
      question: "Duplicate"
    });
    const outcome = await Promise.race([
      duplicatePromise.catch((error: unknown) => error),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("still pending"), 0);
      })
    ]);

    expect(outcome).toMatchObject({
      name: "InteractionConflictError",
      message: "Interaction q_collision is already pending."
    });
    expect(broker.getPending()).toEqual([first]);
  });

  it("rejects presenting an interaction id that was already resolved", async () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_reuse_resolved",
      type: "single_choice" as const,
      question: "Submit once",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    void broker.present(interaction);
    broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    });

    const duplicatePromise = broker.present(interaction);

    await expect(duplicatePromise).rejects.toMatchObject({
      name: "InteractionConflictError",
      message: "Interaction q_reuse_resolved has already been resolved."
    });
  });

  it("notifies listeners when an interaction is presented and resolved", async () => {
    const onPresented = vi.fn();
    const onResolved = vi.fn();
    const broker = new InteractionBroker({ onPresented, onResolved });
    const interaction = {
      id: "q_listener",
      type: "single_choice" as const,
      question: "Listener question",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    expect(onPresented).toHaveBeenCalledWith(interaction);
    expect(onResolved).not.toHaveBeenCalled();

    const result = broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    });

    expect(result.ok).toBe(true);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved.mock.calls[0]?.[0]).toMatchObject({
      interactionId: "q_listener",
      type: "single_choice",
      answer: { optionId: "A" }
    });
    await expect(answerPromise).resolves.toMatchObject({
      interactionId: "q_listener"
    });
  });

  it("keeps a throwing listener from breaking the broker", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broker = new InteractionBroker({
      onPresented: () => {
        throw new Error("listener boom");
      }
    });
    const interaction = {
      id: "q_listener_boom",
      type: "single_choice" as const,
      question: "Boom",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    expect(broker.getPending()).toEqual([interaction]);
    const result = broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    });
    expect(result.ok).toBe(true);
    await expect(answerPromise).resolves.toMatchObject({
      interactionId: "q_listener_boom"
    });
  });

  it("composes same-key listeners across subscribe calls (SSE + phase hook coexist)", async () => {
    const broker = new InteractionBroker();
    // LearningServer (constructor subscribe) then index.ts wiring (subscribe):
    // both onPresented handlers must fire, not replace each other.
    const serverOnPresented = vi.fn();
    const stateOnPresented = vi.fn();
    broker.subscribe({ onPresented: serverOnPresented });
    broker.subscribe({ onPresented: stateOnPresented });
    const interaction = {
      id: "q_two_subscribers",
      type: "single_choice" as const,
      question: "Two subscribers",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    expect(serverOnPresented).toHaveBeenCalledWith(interaction);
    expect(stateOnPresented).toHaveBeenCalledWith(interaction);
    expect(broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    }).ok).toBe(true);
    await expect(answerPromise).resolves.toMatchObject({
      interactionId: "q_two_subscribers"
    });
  });

  it("composes resolved listeners so both the SSE broadcast and bookkeeping fire", async () => {
    const broker = new InteractionBroker();
    const first = vi.fn();
    const second = vi.fn();
    broker.subscribe({ onResolved: first });
    broker.subscribe({ onResolved: second });
    const interaction = {
      id: "q_resolved_twice",
      type: "single_choice" as const,
      question: "Resolved twice",
      options: [{ id: "A", label: "Answer" }],
      allowSkip: false,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);
    broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await expect(answerPromise).resolves.toMatchObject({
      interactionId: "q_resolved_twice"
    });
  });

  it("resolves a pending choice as a structured skip when allowSkip is set", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_500);
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_skip_ok",
      type: "single_choice" as const,
      question: "Skip me?",
      options: [{ id: "A", label: "No" }],
      allowSkip: true,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    const result = broker.skip(interaction.id);

    expect(result).toEqual({
      ok: true,
      answer: {
        interactionId: "q_skip_ok",
        type: "single_choice",
        skipped: true,
        responseTimeMs: 500
      }
    });
    await expect(answerPromise).resolves.toMatchObject({ skipped: true });
    expect(broker.getPending()).toEqual([]);
    expect(broker.hasResolved(interaction.id)).toBe(true);
  });

  it("skips a multi_choice with the matching type", async () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_skip_multi",
      type: "multi_choice" as const,
      question: "Pick none.",
      options: [{ id: "A", label: "A" }],
      allowSkip: true,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    const result = broker.skip(interaction.id);

    expect(result).toEqual({
      ok: true,
      answer: expect.objectContaining({
        type: "multi_choice",
        skipped: true
      })
    });
    await expect(answerPromise).resolves.toMatchObject({ type: "multi_choice" });
  });

  it("rejects a skip when the interaction does not allow skipping", async () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_skip_denied",
      type: "single_choice" as const,
      question: "Must answer.",
      options: [{ id: "A", label: "A" }],
      allowSkip: false,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);

    expect(broker.skip(interaction.id)).toEqual({
      ok: false,
      reason: "skip_not_allowed",
      message: `Interaction ${interaction.id} does not allow skipping.`
    });
    // The interaction stays pending: the learner can still answer it.
    expect(broker.getPending()).toEqual([interaction]);
    expect(broker.submit({
      interactionId: interaction.id,
      answer: { optionId: "A" },
      clientTimestamp: 1_100
    }).ok).toBe(true);
    await expect(answerPromise).resolves.toMatchObject({ answer: { optionId: "A" } });
  });

  it("rejects a skip for an unknown or already-resolved interaction", async () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_skip_twice",
      type: "single_choice" as const,
      question: "Skip?",
      options: [{ id: "A", label: "A" }],
      allowSkip: true,
      createdAt: 1_000
    };
    void broker.present(interaction);

    expect(broker.skip("q_unknown")).toEqual({
      ok: false,
      reason: "not_found",
      message: "No pending interaction with id q_unknown."
    });
    expect(broker.skip(interaction.id).ok).toBe(true);
    expect(broker.skip(interaction.id)).toEqual({
      ok: false,
      reason: "already_resolved",
      message: `Interaction ${interaction.id} has already been resolved.`
    });
  });

  it("rejects answering an interaction that was skipped", async () => {
    const broker = new InteractionBroker();
    const interaction = {
      id: "q_skip_then_submit",
      type: "single_choice" as const,
      question: "Skip?",
      options: [{ id: "A", label: "A" }],
      allowSkip: true,
      createdAt: 1_000
    };
    const answerPromise = broker.present(interaction);
    expect(broker.skip(interaction.id).ok).toBe(true);

    expect(
      broker.submit({
        interactionId: interaction.id,
        answer: { optionId: "A" },
        clientTimestamp: 1_100
      })
    ).toEqual({
      ok: false,
      reason: "already_resolved",
      message: `Interaction ${interaction.id} has already been resolved.`
    });
    await expect(answerPromise).resolves.toMatchObject({ skipped: true });
  });
});
