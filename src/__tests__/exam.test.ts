import { describe, expect, it } from "vitest";
import { LEVELS, type Level, type Question } from "../data/types";
import { cefrOf, EXAM_DIST, EXAM_MAX, nclcOf, pickExam, scaled, scoreExam } from "../exam/score";

const POINTS: Record<Level, number> = { A1: 3, A2: 9, B1: 15, B2: 21, C1: 26, C2: 33 };

function makeBank(perLevel: number, opts: { picture?: (i: number) => boolean } = {}): Question[] {
  return LEVELS.flatMap((level) =>
    Array.from({ length: perLevel }, (_, i): Question => ({
      id: `CO-${level}-${i}`, section: "CO", level, points: POINTS[level], source: i % 5 === 0 ? "extra" : "main",
      bankNo: i + 1, appearances: [{ set: "1", num: i + 1 }],
      options: opts.picture?.(i) && level === "A1" ? ["", "", "", ""] : ["a", "b", "c", "d"], answer: "A",
    })),
  );
}

describe("mock exam paper", () => {
  it("takes 4/6/9/10/6/4 questions, easiest first, worth 699 points", () => {
    const bank = makeBank(20);
    const { qids } = pickExam(bank, { source: "all", onlyNew: false, isDone: () => false });
    expect(qids).toHaveLength(39);
    expect(new Set(qids).size).toBe(39);
    const byId = new Map(bank.map((q) => [q.id, q]));
    const levels = qids.map((id) => byId.get(id)!.level);
    expect(levels).toEqual(LEVELS.flatMap((l) => Array(EXAM_DIST[l]).fill(l)));
    expect(qids.reduce((s, id) => s + byId.get(id)!.points, 0)).toBe(EXAM_MAX);
  });

  it("puts picture items first and keeps to the chosen source", () => {
    const bank = makeBank(20, { picture: (i) => i >= 15 });
    const { qids } = pickExam(bank, { source: "main", onlyNew: false, isDone: () => false });
    const byId = new Map(bank.map((q) => [q.id, q]));
    expect(qids.every((id) => byId.get(id)!.source === "main")).toBe(true);
    const a1 = qids.slice(0, 4).map((id) => byId.get(id)!.options[0] === "");
    expect([...a1].sort((x, y) => Number(y) - Number(x))).toEqual(a1);
  });

  it("prefers new questions and fills a short level with answered ones", () => {
    const bank = makeBank(12);
    const done = new Set(bank.filter((q) => q.level === "B2" && q.bankNo > 3).map((q) => q.id)); // 3 new B2 left
    const { qids, refilled } = pickExam(bank, { source: "all", onlyNew: true, isDone: (id) => done.has(id) });
    expect(qids).toHaveLength(39);
    expect(refilled).toEqual({ B2: 7 });
    expect(qids.filter((id) => !done.has(id) && id.startsWith("CO-B2")).length).toBe(3);
  });
});

describe("exam score", () => {
  const bank = makeBank(20);
  const byId = new Map(bank.map((q) => [q.id, q]));
  const qids = pickExam(bank, { source: "all", onlyNew: false, isDone: () => false }).qids;

  it("adds the points of correct answers; unanswered scores nothing", () => {
    const choices = Object.fromEntries(qids.map((id, i) => [id, i < 10 ? { choice: "A" as const } : i < 20 ? { choice: "B" as const } : {}]));
    const r = scoreExam(qids, choices, (id) => byId.get(id));
    expect(r).toMatchObject({ total: 39, answered: 20, correct: 10, max: 699 });
    expect(r.score).toBe(4 * 3 + 6 * 9); // the 10 easiest
    expect(r.byLevel.map((l) => [l.level, l.correct, l.total])).toEqual([
      ["A1", 4, 4], ["A2", 6, 6], ["B1", 0, 9], ["B2", 0, 10], ["C1", 0, 6], ["C2", 0, 4],
    ]);
  });

  it("maps scores to NCLC and CEFR levels", () => {
    expect(nclcOf("CO", 330)).toBeNull();
    expect(nclcOf("CO", 331)).toBe(4);
    expect(nclcOf("CO", 458)).toBe(7);
    expect(nclcOf("CE", 458)).toBe(7);
    expect(nclcOf("CE", 452)).toBe(6);
    expect(nclcOf("CO", 549)).toBe(10);
    expect(nclcOf("CE", 699)).toBe(10);
    expect(cefrOf(99)).toBeNull();
    expect(cefrOf(399)).toBe("B1");
    expect(cefrOf(699)).toBe("C2");
    expect(scaled(300, 600)).toBe(350);
  });
});
