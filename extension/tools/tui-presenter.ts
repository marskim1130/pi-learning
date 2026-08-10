import {
  CustomEditor,
  getSelectListTheme,
  type ExtensionContext
} from "@earendil-works/pi-coding-agent";

import type { InteractionBroker } from "../server/interaction-broker.js";
import type {
  CodeExerciseInteraction,
  CodeExerciseResolvedAnswer,
  FreeResponseInteraction,
  FreeResponseResolvedAnswer,
  LearningInteraction,
  ResolvedAnswer,
  SingleChoiceInteraction,
  SingleChoiceResolvedAnswer
} from "../server/protocol.js";

export interface TuiLearningPresenter {
  presentSingleChoice(
    interaction: SingleChoiceInteraction,
    signal: AbortSignal | undefined,
    ctx: ExtensionContext
  ): Promise<SingleChoiceResolvedAnswer>;
  presentFreeResponse(
    interaction: FreeResponseInteraction,
    signal: AbortSignal | undefined,
    ctx: ExtensionContext
  ): Promise<FreeResponseResolvedAnswer>;
  presentCode(
    interaction: CodeExerciseInteraction,
    signal: AbortSignal | undefined,
    ctx: ExtensionContext
  ): Promise<CodeExerciseResolvedAnswer>;
}

export function createTuiPresenter(now: () => number = Date.now): TuiLearningPresenter {
  return {
    presentSingleChoice: (interaction, signal, ctx) =>
      presentSingleChoiceInTui(interaction, signal, ctx, now),
    presentFreeResponse: (interaction, signal, ctx) =>
      presentFreeResponseInTui(interaction, signal, ctx, now),
    presentCode: (interaction, signal, ctx) =>
      presentCodeInTui(interaction, signal, ctx, now)
  };
}

export function createBrokerBackedTuiPresenter(
  broker: InteractionBroker,
  now: () => number = Date.now
): TuiLearningPresenter {
  const tui = createTuiPresenter(now);
  return {
    presentSingleChoice: (interaction, signal, ctx) =>
      presentThroughBroker(broker, interaction, signal, (combinedSignal) =>
        tui.presentSingleChoice(interaction, combinedSignal, ctx)
      ),
    presentFreeResponse: (interaction, signal, ctx) =>
      presentThroughBroker(broker, interaction, signal, (combinedSignal) =>
        tui.presentFreeResponse(interaction, combinedSignal, ctx)
      ),
    presentCode: (interaction, signal, ctx) =>
      presentThroughBroker(broker, interaction, signal, (combinedSignal) =>
        tui.presentCode(interaction, combinedSignal, ctx)
      )
  };
}

/**
 * uiMode auto (spec 28): with a web client the interaction is presented to
 * the broker only and waits for the browser to submit via the server; the
 * TUI is not touched. Without a web client, fully reuses
 * createBrokerBackedTuiPresenter (broker + TUI race).
 */
export function createModeAwarePresenter(
  broker: InteractionBroker,
  hasWebClient: () => boolean,
  now: () => number = Date.now
): TuiLearningPresenter {
  const fallback = createBrokerBackedTuiPresenter(broker, now);
  return {
    presentSingleChoice: (interaction, signal, ctx) =>
      hasWebClient()
        ? presentViaBroker(broker, interaction, signal)
        : fallback.presentSingleChoice(interaction, signal, ctx),
    presentFreeResponse: (interaction, signal, ctx) =>
      hasWebClient()
        ? presentViaBroker(broker, interaction, signal)
        : fallback.presentFreeResponse(interaction, signal, ctx),
    presentCode: (interaction, signal, ctx) =>
      hasWebClient()
        ? presentViaBroker(broker, interaction, signal)
        : fallback.presentCode(interaction, signal, ctx)
  };
}

function presentViaBroker(
  broker: InteractionBroker,
  interaction: SingleChoiceInteraction,
  signal: AbortSignal | undefined
): Promise<SingleChoiceResolvedAnswer>;
function presentViaBroker(
  broker: InteractionBroker,
  interaction: FreeResponseInteraction,
  signal: AbortSignal | undefined
): Promise<FreeResponseResolvedAnswer>;
function presentViaBroker(
  broker: InteractionBroker,
  interaction: CodeExerciseInteraction,
  signal: AbortSignal | undefined
): Promise<CodeExerciseResolvedAnswer>;
function presentViaBroker(
  broker: InteractionBroker,
  interaction: LearningInteraction,
  signal: AbortSignal | undefined
): Promise<ResolvedAnswer> {
  // Web-only path: the browser submits through the server; broker.present
  // rejects on tool abort, so the tool surfaces the cancellation normally.
  return broker.present(interaction, signal);
}

export async function presentSingleChoiceInTui(
  interaction: SingleChoiceInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  now: () => number
): Promise<SingleChoiceResolvedAnswer> {
  requireUi(ctx, "Single-choice learning");
  throwIfAborted(interaction.id, signal);

  const choices = interaction.options.map(
    (option, index) => `${index + 1}. ${option.label}`
  );
  const selected = await ctx.ui.select(
    interaction.title === undefined
      ? interaction.question
      : `${interaction.title}\n${interaction.question}`,
    choices,
    signal === undefined ? undefined : { signal }
  );
  throwIfAborted(interaction.id, signal);
  if (selected === undefined) {
    throw new Error(`Learner cancelled interaction ${interaction.id}.`);
  }

  const option = interaction.options[choices.indexOf(selected)];
  if (option === undefined) {
    throw new Error(`TUI returned an unknown choice for ${interaction.id}.`);
  }

  return {
    interactionId: interaction.id,
    type: interaction.type,
    answer: { optionId: option.id },
    responseTimeMs: elapsedSince(interaction.createdAt, now)
  };
}

export async function presentFreeResponseInTui(
  interaction: FreeResponseInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  now: () => number
): Promise<FreeResponseResolvedAnswer> {
  requireUi(ctx, "Free-response learning");
  throwIfAborted(interaction.id, signal);

  const text = interaction.multiline
    ? await presentMultilineEditor(ctx, interaction.question, "", signal)
    : await ctx.ui.input(
        interaction.question,
        interaction.placeholder,
        signal === undefined ? undefined : { signal }
      );
  throwIfAborted(interaction.id, signal);
  if (text === undefined) {
    throw new Error(`Learner cancelled interaction ${interaction.id}.`);
  }

  return {
    interactionId: interaction.id,
    type: interaction.type,
    answer: { text },
    responseTimeMs: elapsedSince(interaction.createdAt, now)
  };
}

export async function presentCodeInTui(
  interaction: CodeExerciseInteraction,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  now: () => number
): Promise<CodeExerciseResolvedAnswer> {
  requireUi(ctx, "Code learning");
  throwIfAborted(interaction.id, signal);

  const code = await presentMultilineEditor(
    ctx,
    interaction.title === undefined
      ? interaction.instructions
      : `${interaction.title}\n${interaction.instructions}`,
    interaction.starterCode,
    signal
  );
  throwIfAborted(interaction.id, signal);
  if (code === undefined) {
    throw new Error(`Learner cancelled interaction ${interaction.id}.`);
  }

  return {
    interactionId: interaction.id,
    type: interaction.type,
    answer: { language: interaction.language, code },
    responseTimeMs: elapsedSince(interaction.createdAt, now)
  };
}

function presentThroughBroker(
  broker: InteractionBroker,
  interaction: SingleChoiceInteraction,
  signal: AbortSignal | undefined,
  collect: (signal: AbortSignal) => Promise<SingleChoiceResolvedAnswer>
): Promise<SingleChoiceResolvedAnswer>;
function presentThroughBroker(
  broker: InteractionBroker,
  interaction: FreeResponseInteraction,
  signal: AbortSignal | undefined,
  collect: (signal: AbortSignal) => Promise<FreeResponseResolvedAnswer>
): Promise<FreeResponseResolvedAnswer>;
function presentThroughBroker(
  broker: InteractionBroker,
  interaction: CodeExerciseInteraction,
  signal: AbortSignal | undefined,
  collect: (signal: AbortSignal) => Promise<CodeExerciseResolvedAnswer>
): Promise<CodeExerciseResolvedAnswer>;
async function presentThroughBroker(
  broker: InteractionBroker,
  interaction: LearningInteraction,
  signal: AbortSignal | undefined,
  collect: (signal: AbortSignal) => Promise<ResolvedAnswer>
): Promise<ResolvedAnswer> {
  const localAbort = new AbortController();
  const onToolAbort = () => localAbort.abort();
  if (signal?.aborted) {
    localAbort.abort();
  } else {
    signal?.addEventListener("abort", onToolAbort, { once: true });
  }

  const pending = broker.present(interaction, localAbort.signal);
  void pending.catch(() => {
    localAbort.abort();
  });

  try {
    const outcome = await Promise.race([
      collect(localAbort.signal).then((answer) => ({
        source: "tui" as const,
        answer
      })),
      pending.then((answer) => ({ source: "broker" as const, answer }))
    ]);
    if (outcome.source === "broker") {
      localAbort.abort();
      return outcome.answer;
    }

    const submission = broker.submit({
      interactionId: interaction.id,
      answer: outcome.answer.answer,
      clientTimestamp: Date.now()
    });
    if (!submission.ok) {
      throw new Error(submission.message);
    }

    return await pending;
  } catch (error) {
    broker.cancel(interaction.id, "tui_interaction_failed");
    await pending.catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onToolAbort);
  }
}

function requireUi(ctx: ExtensionContext, activity: string): void {
  if (!ctx.hasUI) {
    throw new Error(`${activity} requires an interactive Pi UI.`);
  }
}

async function presentMultilineEditor(
  ctx: ExtensionContext,
  title: string,
  prefill: string,
  signal: AbortSignal | undefined
): Promise<string | undefined> {
  if (ctx.mode !== "tui") {
    return ctx.ui.editor(title, prefill);
  }

  ctx.ui.notify(title, "info");
  return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    const editor = new CustomEditor(
      tui,
      {
        borderColor: (text) => theme.fg("accent", text),
        selectList: getSelectListTheme()
      },
      keybindings,
      { paddingX: 1 }
    ) as CustomEditor & { dispose?: () => void };
    editor.setText(prefill);

    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      done(value);
    };
    const onAbort = () => finish(undefined);

    editor.onSubmit = (text) => finish(text);
    editor.onEscape = () => finish(undefined);
    editor.dispose = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      queueMicrotask(onAbort);
    }

    return editor;
  });
}

function throwIfAborted(
  interactionId: string,
  signal: AbortSignal | undefined
): void {
  if (signal?.aborted) {
    throw new Error(`Learning interaction ${interactionId} was aborted.`);
  }
}

function elapsedSince(createdAt: number, now: () => number): number {
  return Math.max(0, now() - createdAt);
}
