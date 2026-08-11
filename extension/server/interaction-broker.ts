import type {
  InteractionSubmission,
  LearningInteraction,
  ResolvedAnswer,
  SubmitResult
} from "./protocol.js";
import { validateInteractionAnswer } from "../utils/validation.js";

/** Optional observability hooks; default is no-op so existing behavior is unchanged. */
export interface BrokerListeners {
  onPresented?: (interaction: LearningInteraction) => void;
  onResolved?: (answer: ResolvedAnswer) => void;
  onCancelled?: (interactionId: string, reason: string) => void;
}

interface PendingInteraction {
  interaction: LearningInteraction;
  resolve: (answer: ResolvedAnswer) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

const MAX_RESOLVED_IDS = 1_000;

export class InteractionCancelledError extends Error {
  constructor(interactionId: string, reason: string) {
    super(`Interaction ${interactionId} was cancelled: ${reason}.`);
    this.name = "InteractionCancelledError";
  }
}

export class InteractionConflictError extends Error {
  constructor(interactionId: string, state: "pending" | "resolved" = "pending") {
    super(
      state === "pending"
        ? `Interaction ${interactionId} is already pending.`
        : `Interaction ${interactionId} has already been resolved.`
    );
    this.name = "InteractionConflictError";
  }
}

export class InteractionBroker {
  private readonly pending = new Map<string, PendingInteraction>();
  private readonly resolvedIds = new Set<string>();
  private listeners: BrokerListeners;

  constructor(listeners: BrokerListeners = {}) {
    this.listeners = listeners;
  }

  /** Attach additional listeners (used by LearningServer after construction). */
  subscribe(listeners: BrokerListeners): void {
    this.listeners = { ...this.listeners, ...listeners };
  }

  present(
    interaction: LearningInteraction,
    signal?: AbortSignal
  ): Promise<ResolvedAnswer> {
    if (this.pending.has(interaction.id)) {
      return Promise.reject(new InteractionConflictError(interaction.id));
    }

    if (this.resolvedIds.has(interaction.id)) {
      return Promise.reject(
        new InteractionConflictError(interaction.id, "resolved")
      );
    }

    if (signal?.aborted) {
      return Promise.reject(
        new InteractionCancelledError(interaction.id, "aborted")
      );
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.rejectPending(
          interaction.id,
          new InteractionCancelledError(interaction.id, "aborted"),
          "aborted"
        );
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };

      this.pending.set(interaction.id, { interaction, resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      notifyListener(() => this.listeners.onPresented?.(interaction));
    });
  }

  submit(submission: InteractionSubmission): SubmitResult {
    const pending = this.pending.get(submission.interactionId);
    if (!pending) {
      if (this.resolvedIds.has(submission.interactionId)) {
        return {
          ok: false,
          reason: "already_resolved",
          message: `Interaction ${submission.interactionId} has already been resolved.`
        };
      }

      return {
        ok: false,
        reason: "not_found",
        message: `No pending interaction with id ${submission.interactionId}.`
      };
    }

    const validation = validateInteractionAnswer(
      pending.interaction,
      submission.answer
    );
    if (!validation.ok) {
      return {
        ok: false,
        reason: "invalid_answer",
        message: validation.message
      };
    }

    const responseTimeMs = Math.max(
      0,
      Date.now() - pending.interaction.createdAt
    );
    let answer: ResolvedAnswer;
    switch (validation.type) {
      case "single_choice":
        answer = {
          interactionId: pending.interaction.id,
          type: validation.type,
          answer: validation.answer,
          responseTimeMs
        };
        break;
      case "multi_choice":
        answer = {
          interactionId: pending.interaction.id,
          type: validation.type,
          answer: validation.answer,
          responseTimeMs
        };
        break;
      case "free_response":
        answer = {
          interactionId: pending.interaction.id,
          type: validation.type,
          answer: validation.answer,
          responseTimeMs
        };
        break;
      case "code":
        answer = {
          interactionId: pending.interaction.id,
          type: validation.type,
          answer: validation.answer,
          responseTimeMs
        };
        break;
    }

    this.pending.delete(submission.interactionId);
    pending.cleanup();
    this.rememberResolved(submission.interactionId);
    pending.resolve(answer);
    notifyListener(() => this.listeners.onResolved?.(answer));
    return { ok: true, answer };
  }

  cancel(interactionId: string, reason: string): void {
    this.rejectPending(
      interactionId,
      new InteractionCancelledError(interactionId, reason),
      reason
    );
  }

  cancelAll(reason: string): void {
    for (const interactionId of [...this.pending.keys()]) {
      this.cancel(interactionId, reason);
    }
  }

  getPending(): LearningInteraction[] {
    return [...this.pending.values()].map(({ interaction }) => interaction);
  }

  hasResolved(interactionId: string): boolean {
    return this.resolvedIds.has(interactionId);
  }

  private rememberResolved(interactionId: string): void {
    this.resolvedIds.add(interactionId);
    if (this.resolvedIds.size <= MAX_RESOLVED_IDS) {
      return;
    }

    const oldestId = this.resolvedIds.values().next().value;
    if (oldestId !== undefined) {
      this.resolvedIds.delete(oldestId);
    }
  }

  private rejectPending(
    interactionId: string,
    error: Error,
    cancellationReason?: string
  ): void {
    const pending = this.pending.get(interactionId);
    if (!pending) {
      return;
    }

    this.pending.delete(interactionId);
    pending.cleanup();
    pending.reject(error);
    if (cancellationReason !== undefined) {
      notifyListener(() =>
        this.listeners.onCancelled?.(interactionId, cancellationReason)
      );
    }
  }
}

/** Listeners are observability hooks: a throwing listener must not break the broker. */
function notifyListener(notify: () => void): void {
  try {
    notify();
  } catch (error) {
    console.error("InteractionBroker listener failed:", error);
  }
}
