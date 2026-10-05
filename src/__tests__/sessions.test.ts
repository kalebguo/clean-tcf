import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Question } from "../data/types";
import { db } from "../db/schema";
import { createSession, findOpenSession, saveDraft, submitSession } from "../db/sessions";

const q = (id: string, answer: Question["answer"]): Question => ({
  id, section: "CO", level: "A1", points: 3, source: "main", bankNo: 1, appearances: [{ set: "1", num: 1 }],
  options: ["a", "b", "c", "d"], answer,
});
const bank = new Map([["q1", q("q1", "A")], ["q2", q("q2", "B")], ["q3", q("q3", "C")]]);
const lookup = (id: string) => bank.get(id);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("sessions", () => {
  it("submits answered questions once and updates the wrong book", async () => {
    const s = await createSession({ mode: "dedupe", section: "CO", scopeKey: "k", qids: ["q1", "q2", "q3"] });
    await saveDraft(s.id, { entries: { q1: { choice: "A", peeked: false, revealed: false }, q2: { choice: "D", peeked: false, revealed: false } } });
    const r = await submitSession(s.id, lookup);
    expect(r).toMatchObject({ alreadySubmitted: false, answered: 2, correct: 1, newCount: 2, wrongQids: ["q2"] });
    expect(await db.attempts.count()).toBe(2);
    expect((await db.qstate.get("q2"))?.wrong).toBe("open");
    expect(await db.qstate.get("q3")).toBeUndefined(); // unanswered: not recorded

    const again = await submitSession(s.id, lookup); // double click / second tab
    expect(again.alreadySubmitted).toBe(true);
    expect(await db.attempts.count()).toBe(2);
  });

  it("a stale tab cannot write into a submitted round", async () => {
    const s = await createSession({ mode: "dedupe", section: "CO", scopeKey: "k", qids: ["q1"] });
    await saveDraft(s.id, { entries: { q1: { choice: "A", peeked: false, revealed: false } } });
    await submitSession(s.id, lookup);
    expect(await saveDraft(s.id, { entries: { q1: { choice: "B", peeked: false, revealed: false } } })).toBe(false);
    expect((await db.sessions.get(s.id))?.draft.q1.choice).toBe("A");
    expect(await findOpenSession("k")).toBeUndefined();
  });

  it("final patch is included in the submit; questions missing from the bank are skipped", async () => {
    const s = await createSession({ mode: "set", section: "CO", scopeKey: "k2", qids: ["q1", "gone"] });
    await saveDraft(s.id, { entries: { gone: { choice: "A", peeked: false, revealed: false } } });
    const r = await submitSession(s.id, lookup, { entries: { q1: { choice: "B", peeked: false, revealed: false } }, elapsedMs: 5000 });
    expect(r).toMatchObject({ answered: 1, correct: 0, elapsedMs: 5000 });
  });

  it("fixing a wrong item is reported, peeked correct is not", async () => {
    const s1 = await createSession({ mode: "dedupe", section: "CO", scopeKey: "a", qids: ["q1", "q2"] });
    await submitSession(s1.id, lookup, { entries: { q1: { choice: "D", peeked: false, revealed: false }, q2: { choice: "D", peeked: false, revealed: false } } });
    const s2 = await createSession({ mode: "wrong", section: "CO", scopeKey: "b", qids: ["q1", "q2"] });
    const r = await submitSession(s2.id, lookup, { entries: { q1: { choice: "A", peeked: false, revealed: false }, q2: { choice: "B", peeked: true, revealed: true } } });
    expect(r.fixedQids).toEqual(["q1"]);
    expect(r.redoCount).toBe(2);
    expect((await db.qstate.get("q2"))?.wrong).toBe("open");
  });
});
