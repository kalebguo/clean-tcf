import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitToQuestion, sentenceRanges, sourceHash, translatedBlocks, type P2Question } from "../data/p2";
import type { Question } from "../data/types";
import { cutPieces } from "../practice/pieces";

/** The rendered text of pieces is the original text, so DOM offsets stay data offsets. */
function expectContiguous(pieces: { s: number; e: number }[], len: number) {
  let pos = 0;
  for (const p of pieces) {
    expect(p.s).toBe(pos);
    expect(p.e).toBeGreaterThan(p.s);
    pos = p.e;
  }
  expect(pos).toBe(len);
}

describe("cutPieces", () => {
  const text = "Elle nous racontera la fête dans tout leur ancien bar rénové, car notre cœur chantait.";
  const len = text.length;

  it("covers the text exactly once with no marks", () => {
    expect(cutPieces(len, [])).toEqual([{ s: 0, e: len }]);
    expect(cutPieces(0, [])).toEqual([]);
  });

  it("keeps offsets contiguous when every kind of mark overlaps", () => {
    const pieces = cutPieces(
      len,
      [
        { id: "h1", r: { start: 5, end: 30 } },
        { id: "h2", r: { start: 20, end: 40 } }, // overlaps h1: skipped, as in P1
        { id: "h3", r: { start: 60, end: 200 } }, // past the end: clamped
      ],
      [{ s: 0, e: 40, sid: 0 }, { s: 41, e: len, sid: 1 }],
      [
        { s: 0, e: len, label: "D", answer: true },
        { s: 43, e: len - 1, label: "A", answer: false },
      ],
    );
    expectContiguous(pieces, len);
    expect(pieces.some((p) => p.hl === "h2")).toBe(false);
    expect(pieces.filter((p) => p.hl === "h1").map((p) => [p.s, p.e])).toEqual([[5, 30]]);
    expect(pieces.at(-1)).toMatchObject({ e: len, hl: "h3", sid: 1, ev: "answer", evEnd: "D", evEndAnswer: true });
    // the trap quote inside the answer sentence keeps its own style, and its badge sits at its end
    const trapEnd = pieces.find((p) => p.e === len - 1)!;
    expect(trapEnd).toMatchObject({ ev: "trap", evEnd: "A", evEndAnswer: false });
    // whitespace between sentences belongs to no sentence
    expect(pieces.find((p) => p.s === 40)).toMatchObject({ e: 41 });
    expect(pieces.find((p) => p.s === 40)!.sid).toBeUndefined();
  });

  it("joins labels of quotes ending at the same place", () => {
    const pieces = cutPieces(10, [], [], [
      { s: 0, e: 10, label: "C", answer: true },
      { s: 5, e: 10, label: "A", answer: false },
    ]);
    expectContiguous(pieces, 10);
    expect(pieces.at(-1)).toMatchObject({ evEnd: "A·C", evEndAnswer: true, ev: "trap" });
  });
});

const q = (patch: Partial<Question> = {}): Question => ({
  id: "CE-1-11", section: "CE", level: "A1", points: 3, source: "main", bankNo: 1, appearances: [],
  options: ["a", "b", "c", "d"], answer: "D", question: "Que propose cette annonce ?",
  passage: ["Vous voulez faire connaître votre entreprise ?", "Nous vous proposons. Envoyez-nous votre texte."],
  ...patch,
});

const p2 = (question: Question): P2Question => ({
  id: question.id,
  hash: sourceHash(question),
  segments: [
    { field: "question", zh: "问", en: "Q", spans: [{ index: 0, s: 0, e: 27 }] },
    { field: "passage", zh: "一", en: "One", spans: [{ index: 0, s: 0, e: 46 }] },
    { field: "passage", zh: "二", en: "Two", spans: [{ index: 1, s: 0, e: 20 }] },
    { field: "passage", zh: "三", en: "Three", spans: [{ index: 1, s: 21, e: 47 }] },
  ],
  analysis: {
    summary: "s",
    options: { A: { correct: false, why: "" }, B: { correct: false, why: "" }, C: { correct: false, why: "" }, D: { correct: true, why: "" } },
  },
  evidence: [{ letter: "D", field: "passage", index: 1, s: 0, e: 20 }],
  check: { agree: true, note: "" },
});

describe("P2 content", () => {
  it("hashes the same way as build_p2.py", () => {
    // value printed by scripts/p2/build_p2.py for the bank's CE-1-11
    const bankFile = "public/data/reading.json";
    if (!existsSync(bankFile) || !existsSync("public/data/p2/q/CE-1-11.json")) return;
    const bankQ = (JSON.parse(readFileSync(bankFile, "utf8")).questions as Question[]).find((x) => x.id === "CE-1-11")!;
    const built = JSON.parse(readFileSync("public/data/p2/q/CE-1-11.json", "utf8")) as P2Question;
    expect(sourceHash(bankQ)).toBe(built.hash);
  });

  it("is kept as built while the text is unchanged", () => {
    const question = q();
    const content = p2(question);
    expect(fitToQuestion(content, question)).toBe(content);
  });

  it("becomes stale when the text changed: no positions, analysis kept", () => {
    const content = p2(q());
    const fitted = fitToQuestion(content, q({ passage: ["Vous voulez faire connaître votre entreprise ?", "Nous proposons."] }));
    expect(fitted.stale).toBe(true);
    expect(fitted.evidence).toBeUndefined();
    expect(fitted.segments!.every((s) => s.spans.length === 0)).toBe(true);
    expect(fitted.analysis).toBeDefined();
  });

  it("drops the analysis when the official answer changed", () => {
    const fitted = fitToQuestion(p2(q()), q({ answer: "B" }));
    expect(fitted.analysis).toBeUndefined();
    expect(fitted.check).toBeUndefined();
  });

  it("lays translations out by the source's paragraphs", () => {
    const content = p2(q());
    expect(translatedBlocks(content, "passage", "zh", 2)).toEqual(["一", "二三"]);
    expect(translatedBlocks(content, "passage", "en", 2)).toEqual(["One", "Two Three"]);
    expect(translatedBlocks(fitToQuestion(content, q({ answer: "A" })), "passage", "zh", 2)).toEqual(["一", "二", "三"]);
    expect(sentenceRanges(content).get("passage:1")).toEqual([{ s: 0, e: 20, sid: 2 }, { s: 21, e: 47, sid: 3 }]);
  });
});
