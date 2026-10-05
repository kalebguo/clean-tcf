import { describe, expect, it } from "vitest";
import { applyAttempt, mergeDraft } from "../db/rules";

const base = { qid: "CO-1-01", section: "CO" as const, level: "A1" as const, choice: "A" as const };

describe("wrong-book state machine", () => {
  it("wrong answer opens, correct answer fixes", () => {
    const s1 = applyAttempt(undefined, { ...base, correct: false, peeked: false, at: 1 });
    expect(s1).toMatchObject({ wrong: "open", wrongCount: 1, attempts: 1, correctCount: 0, wrongAt: 1 });
    const s2 = applyAttempt(s1, { ...base, correct: true, peeked: false, at: 2 });
    expect(s2).toMatchObject({ wrong: "fixed", fixedAt: 2, attempts: 2, correctCount: 1 });
  });
  it("correct after peeking does not fix", () => {
    const s1 = applyAttempt(undefined, { ...base, correct: false, peeked: false, at: 1 });
    expect(applyAttempt(s1, { ...base, correct: true, peeked: true, at: 2 }).wrong).toBe("open");
  });
  it("wrong again sends fixed back to open", () => {
    let s = applyAttempt(undefined, { ...base, correct: false, peeked: false, at: 1 });
    s = applyAttempt(s, { ...base, correct: true, peeked: false, at: 2 });
    s = applyAttempt(s, { ...base, correct: false, peeked: false, at: 3 });
    expect(s).toMatchObject({ wrong: "open", wrongCount: 2 });
    expect(s.fixedAt).toBeUndefined();
  });
  it("correct first time never enters the wrong book", () => {
    expect(applyAttempt(undefined, { ...base, correct: true, peeked: false, at: 1 }).wrong).toBe("none");
  });
  it("removed item stays removed after a correct answer", () => {
    const s = { ...applyAttempt(undefined, { ...base, correct: false, peeked: false, at: 1 }), wrong: "none" as const };
    expect(applyAttempt(s, { ...base, correct: true, peeked: false, at: 2 }).wrong).toBe("none");
  });
});

describe("draft merge", () => {
  it("merges per question so two tabs keep each other's answers", () => {
    const a = mergeDraft({}, { q1: { choice: "A", peeked: false, revealed: false } });
    const b = mergeDraft(a, { q2: { choice: "C", peeked: false, revealed: false } });
    expect(Object.keys(b)).toEqual(["q1", "q2"]);
    expect(mergeDraft(b, { q1: { choice: undefined, peeked: false, revealed: true } }).q1).toEqual({ choice: undefined, peeked: false, revealed: true });
  });
});
