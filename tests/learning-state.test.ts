import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_MASTERY,
  LearningStateStore,
  updateMastery
} from "../extension/state/learning-state.js";
import type { ConceptState } from "../extension/state/types.js";

describe("LearningStateStore", () => {
  it("starts in an idle disabled state", () => {
    const store = new LearningStateStore();

    expect(store.snapshot()).toEqual({
      enabled: false,
      phase: "idle",
      concepts: {},
      recentAttempts: []
    });
  });

  it("starts learning for a course and topic in diagnosing phase", () => {
    const store = new LearningStateStore();

    store.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });

    expect(store.snapshot()).toEqual({
      enabled: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "diagnosing",
      concepts: {},
      recentAttempts: []
    });
  });

  it("stops learning without erasing the selected topic", () => {
    const store = new LearningStateStore();
    store.start({
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" }
    });

    store.stop();

    expect(store.snapshot()).toMatchObject({
      enabled: false,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "idle"
    });
  });

  it("restores a serialized learning state snapshot", () => {
    const store = new LearningStateStore();
    const snapshot = {
      enabled: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "generics", title: "Generics" },
      phase: "checking" as const,
      concepts: {},
      recentAttempts: []
    };

    expect(store.restore(snapshot)).toBe(true);
    expect(store.snapshot()).toEqual(snapshot);
  });
});

describe("updateMastery (spec 16.1)", () => {
  function concept(overrides: Partial<ConceptState> = {}): ConceptState {
    return {
      id: "c",
      title: "Concept",
      mastery: INITIAL_MASTERY,
      attempts: 0,
      correct: 0,
      misconceptions: [],
      ...overrides
    };
  }

  it("starts new concepts at 0.20", () => {
    expect(INITIAL_MASTERY).toBe(0.2);
  });

  it("gains 0.08 for a correct choice", () => {
    expect(updateMastery(concept(), { outcome: "correct", evidenceType: "choice" })).toBe(0.28);
  });

  it("gains 0.12 for a correct free response", () => {
    expect(updateMastery(concept(), { outcome: "correct", evidenceType: "free_response" })).toBe(0.32);
  });

  it("gains 0.15 for correct code (weights code above choice)", () => {
    expect(updateMastery(concept(), { outcome: "correct", evidenceType: "code" })).toBe(0.35);
  });

  it("penalizes incorrect by 0.08 and partial by 0.04", () => {
    expect(updateMastery(concept(), { outcome: "incorrect", evidenceType: "choice" })).toBe(0.12);
    expect(updateMastery(concept(), { outcome: "partial", evidenceType: "free_response" })).toBe(0.16);
  });

  it("clamps mastery to 0 after repeated incorrect answers", () => {
    let mastery = INITIAL_MASTERY;
    for (let i = 0; i < 3; i += 1) {
      mastery = updateMastery(
        { ...concept({ mastery }), recentOutcomes: [{ outcome: "incorrect", evidenceType: "choice" }] },
        { outcome: "incorrect", evidenceType: "choice" }
      );
    }
    expect(mastery).toBe(0);
  });

  it("clamps mastery to 1 with diverse correct evidence", () => {
    // choice x7 (clamped at 0.75) -> free_response (0.87) -> code (1.02 -> 1).
    let mastery = INITIAL_MASTERY;
    let recent: NonNullable<ConceptState["recentOutcomes"]> = [];
    const correct = (evidenceType: "choice" | "free_response" | "code") => {
      recent = [{ outcome: "correct" as const, evidenceType }, ...recent].slice(0, 10);
      mastery = updateMastery(concept({ mastery, recentOutcomes: recent }), {
        outcome: "correct",
        evidenceType
      });
    };
    for (let i = 0; i < 7; i += 1) correct("choice");
    correct("free_response");
    correct("code");
    expect(mastery).toBe(1);
  });

  it("keeps single-choice-only practice below the 0.75 ceiling", () => {
    let mastery = INITIAL_MASTERY;
    let recent: NonNullable<ConceptState["recentOutcomes"]> = [];
    for (let i = 0; i < 8; i += 1) {
      recent = [{ outcome: "correct" as const, evidenceType: "choice" as const }, ...recent].slice(0, 10);
      mastery = updateMastery(concept({ mastery, recentOutcomes: recent }), {
        outcome: "correct",
        evidenceType: "choice"
      });
    }
    expect(mastery).toBe(0.75);
  });

  it("allows exceeding 0.75 after two consecutive correct forms", () => {
    // 7 choice-corrects clamp at 0.75; a free_response correct then unlocks.
    let mastery = INITIAL_MASTERY;
    let recent: NonNullable<ConceptState["recentOutcomes"]> = [];
    const correct = (evidenceType: "choice" | "free_response") => {
      recent = [{ outcome: "correct" as const, evidenceType }, ...recent].slice(0, 10);
      mastery = updateMastery(concept({ mastery, recentOutcomes: recent }), {
        outcome: "correct",
        evidenceType
      });
    };
    for (let i = 0; i < 7; i += 1) correct("choice");
    correct("free_response");
    expect(mastery).toBe(0.87);
  });

  it("re-locks the ceiling after a non-correct answer breaks the streak", () => {
    // choice x7 -> 0.75; free_response -> 0.87; wrong choice -> 0.79; then a
    // choice correct would reach 0.87 but the streak is [choice] only -> 0.75.
    let mastery = INITIAL_MASTERY;
    let recent: NonNullable<ConceptState["recentOutcomes"]> = [];
    const record = (outcome: "correct" | "incorrect", evidenceType: "choice" | "free_response") => {
      recent = [{ outcome, evidenceType }, ...recent].slice(0, 10);
      mastery = updateMastery(concept({ mastery, recentOutcomes: recent }), {
        outcome,
        evidenceType
      });
    };
    for (let i = 0; i < 7; i += 1) record("correct", "choice");
    record("correct", "free_response");
    record("incorrect", "choice");
    expect(mastery).toBe(0.79);
    record("correct", "choice");
    expect(mastery).toBe(0.75);
  });

  it("a partial answer also breaks the correct streak (only correct counts)", () => {
    let mastery = INITIAL_MASTERY;
    let recent: NonNullable<ConceptState["recentOutcomes"]> = [];
    const record = (outcome: "correct" | "partial", evidenceType: "choice" | "free_response") => {
      recent = [{ outcome, evidenceType }, ...recent].slice(0, 10);
      mastery = updateMastery(concept({ mastery, recentOutcomes: recent }), {
        outcome,
        evidenceType
      });
    };
    for (let i = 0; i < 7; i += 1) record("correct", "choice");
    record("correct", "free_response"); // 0.87, streak unlocked
    record("partial", "choice"); // 0.83, streak now [partial]
    record("correct", "choice"); // 0.91 would-be -> streak [choice] only -> 0.75
    expect(mastery).toBe(0.75);
  });
});

describe("LearningStateStore.recordAttempt", () => {
  it("creates a concept at 0.20 and returns the recorded summary", () => {
    const store = new LearningStateStore();

    const summary = store.recordAttempt({
      interactionId: "q_1",
      conceptId: "generics",
      outcome: "correct",
      evidenceType: "choice"
    });

    expect(summary).toEqual({
      interactionId: "q_1",
      conceptId: "generics",
      outcome: "correct",
      evidenceType: "choice",
      recordedAt: expect.any(Number)
    });
    expect(store.snapshot().concepts.generics).toMatchObject({
      id: "generics",
      title: "generics",
      mastery: 0.28,
      attempts: 1,
      correct: 1,
      lastPracticedAt: expect.any(Number),
      misconceptions: [],
      recentOutcomes: [{ outcome: "correct", evidenceType: "choice" }]
    });
    expect(store.snapshot().recentAttempts).toHaveLength(1);
  });

  it("increments attempts and correct only on correct outcomes", () => {
    const store = new LearningStateStore();
    store.recordAttempt({ interactionId: "q_1", conceptId: "c", outcome: "incorrect", evidenceType: "choice" });
    store.recordAttempt({ interactionId: "q_2", conceptId: "c", outcome: "partial", evidenceType: "choice" });
    store.recordAttempt({ interactionId: "q_3", conceptId: "c", outcome: "correct", evidenceType: "choice" });

    const concept = store.snapshot().concepts.c;
    expect(concept?.attempts).toBe(3);
    expect(concept?.correct).toBe(1);
    expect(concept?.mastery).toBe(0.16); // 0.2 - 0.08 - 0.04 + 0.08
  });

  it("appends misconceptions on incorrect answers, deduped and capped at 10", () => {
    const store = new LearningStateStore();
    store.recordAttempt({ interactionId: "q_1", conceptId: "c", outcome: "incorrect", evidenceType: "choice", misconception: "Confuses A with B" });
    store.recordAttempt({ interactionId: "q_2", conceptId: "c", outcome: "incorrect", evidenceType: "choice", misconception: "Confuses A with B" });
    store.recordAttempt({ interactionId: "q_3", conceptId: "c", outcome: "incorrect", evidenceType: "choice", misconception: "Thinks C is D" });

    expect(store.snapshot().concepts.c?.misconceptions).toEqual(["Thinks C is D", "Confuses A with B"]);

    for (let i = 0; i < 15; i += 1) {
      store.recordAttempt({
        interactionId: `q_extra_${i}`,
        conceptId: "c",
        outcome: "incorrect",
        evidenceType: "choice",
        misconception: `Mistake #${i}`
      });
    }
    expect(store.snapshot().concepts.c?.misconceptions).toHaveLength(10);
    expect(store.snapshot().concepts.c?.misconceptions[0]).toBe("Mistake #14");
  });

  it("caps recentAttempts at 20 and recentOutcomes at 10", () => {
    const store = new LearningStateStore();
    for (let i = 0; i < 25; i += 1) {
      store.recordAttempt({ interactionId: `q_${i}`, conceptId: "c", outcome: "correct", evidenceType: "choice" });
    }

    expect(store.snapshot().recentAttempts).toHaveLength(20);
    expect(store.snapshot().recentAttempts[0]?.interactionId).toBe("q_24");
    expect(store.snapshot().concepts.c?.recentOutcomes).toHaveLength(10);
    expect(store.snapshot().concepts.c?.attempts).toBe(25);
  });

  it("rejects a duplicate interaction id after recent history rolls over", () => {
    const store = new LearningStateStore();
    for (let i = 0; i < 21; i += 1) {
      store.recordAttempt({
        interactionId: `unique_${i}`,
        conceptId: "c",
        outcome: "correct",
        evidenceType: "choice"
      });
    }
    const before = store.snapshot();

    expect(() =>
      store.recordAttempt({
        interactionId: "unique_0",
        conceptId: "c",
        outcome: "correct",
        evidenceType: "choice"
      })
    ).toThrow(/already been recorded/u);
    expect(store.snapshot()).toEqual(before);
  });

  it("does not include misconception in the summary when absent", () => {
    const store = new LearningStateStore();
    const summary = store.recordAttempt({ interactionId: "q_1", conceptId: "c", outcome: "correct", evidenceType: "code" });
    expect("misconception" in summary).toBe(false);
  });

  it("keeps recentOutcomes optional so old snapshots still restore", () => {
    const store = new LearningStateStore();
    const oldSnapshot = {
      enabled: false,
      phase: "idle" as const,
      concepts: {
        generics: {
          id: "generics",
          title: "Generics",
          mastery: 0.6,
          attempts: 5,
          correct: 4,
          misconceptions: []
        }
      },
      recentAttempts: []
    };

    expect(store.restore(oldSnapshot)).toBe(true);
    expect(store.snapshot().concepts.generics?.recentOutcomes).toBeUndefined();
  });

  it("recordAttempt after restoring an old snapshot (no recentOutcomes) keeps state valid", () => {
    const store = new LearningStateStore();
    store.restore({
      enabled: false,
      phase: "idle" as const,
      concepts: {
        c: {
          id: "c",
          title: "C",
          mastery: 0.6,
          attempts: 5,
          correct: 4,
          misconceptions: []
        }
      },
      recentAttempts: []
    });

    const summary = store.recordAttempt({
      interactionId: "q_1",
      conceptId: "c",
      outcome: "correct",
      evidenceType: "choice"
    });

    const snapshot = store.snapshot();
    expect(summary).toBeDefined();
    expect(snapshot.concepts.c).toMatchObject({
      mastery: 0.68,
      attempts: 6,
      correct: 5,
      recentOutcomes: [{ outcome: "correct", evidenceType: "choice" }]
    });
    expect(snapshot.recentAttempts[0]?.interactionId).toBe("q_1");
  });

  it("restores snapshots with recentOutcomes and rejects invalid ones", () => {
    const store = new LearningStateStore();
    const good = {
      enabled: false,
      phase: "idle" as const,
      concepts: {
        c: {
          id: "c",
          title: "C",
          mastery: 0.75,
          attempts: 1,
          correct: 1,
          misconceptions: [],
          recentOutcomes: [{ outcome: "correct" as const, evidenceType: "code" as const }]
        }
      },
      recentAttempts: []
    };
    expect(store.restore(good)).toBe(true);

    const bad = {
      ...good,
      concepts: {
        c: { ...good.concepts.c, recentOutcomes: [{ outcome: "wrong", evidenceType: "code" }] }
      }
    };
    expect(store.restore(bad)).toBe(false);
  });

  it("notifies onChange after each mutation with the post-change snapshot", () => {
    const onChange = vi.fn();
    const store = new LearningStateStore({ onChange });

    store.start({ course: { id: "rust", title: "Rust" }, topic: { id: "g", title: "Generics" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ enabled: true, phase: "diagnosing" });

    store.recordAttempt({ interactionId: "q_1", conceptId: "c", outcome: "correct", evidenceType: "choice" });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1]?.[0].concepts.c).toMatchObject({ attempts: 1, mastery: 0.28 });

    store.stop();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls[2]?.[0]).toMatchObject({ enabled: false, phase: "idle" });
  });

  it("does not notify onChange when restore is rejected", () => {
    const onChange = vi.fn();
    const store = new LearningStateStore({ onChange });
    store.restore({ nonsense: true });
    expect(onChange).not.toHaveBeenCalled();
  });
});
