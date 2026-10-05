import { describe, expect, it } from "vitest";
import { alignWords, lineAt, lineOk, type Align } from "../data/align";
import { blockStarts, timedWordAt } from "../data/timed";
import { ttsWords, type Tts } from "../data/tts";

const a: Align = {
  hash: "x",
  lines: [[0.3, 1.5, 0.9], null, [3, 4.2, 0.1], [5, 6, 0.8]],
  words: [
    [0, 0, 5, 0.3, 0.7], [0, 6, 10, 0.8, 0.8], [0, 11, 15, 1.1, 1.5],
    [2, 0, 4, 3, 3.5], [2, 5, 9, 3.6, 4.2],
    [3, 0, 3, 5, 5.4], [3, 4, 8, 5.5, 6],
  ],
};

const words = alignWords(a);
const wordAt = (t: number) => {
  const k = timedWordAt(words, t);
  return k < 0 ? -1 : a.words.findIndex((w) => w[0] === words[k][1] && w[1] === words[k][2]);
};

describe("listening timeline", () => {
  it("finds the word being spoken; a zero-length word lasts until the next one", () => {
    expect(wordAt(0.1)).toBe(-1);
    expect(wordAt(0.5)).toBe(0);
    expect(wordAt(0.9)).toBe(1);
    expect(wordAt(1.4)).toBe(2);
    expect(wordAt(2.8)).toBe(-1); // a pause of more than a second
    expect(wordAt(5.6)).toBe(6);
    expect(wordAt(7)).toBe(-1);
  });

  it("does not follow lines with a low score or not in the recording", () => {
    expect(lineOk(a, 0)).toBe(true);
    expect(lineOk(a, 1)).toBe(false);
    expect(lineOk(a, 2)).toBe(false);
    expect(wordAt(3.2)).toBe(-1);
    expect(lineAt(a, 5.2)).toBe(3);
    expect(lineAt(a, 0)).toBe(-1);
    expect(words.map((w) => w[1])).toEqual([0, 0, 0, 3, 3]);
    expect(blockStarts(words)).toEqual([0.3, 5]);
  });
});

describe("reading aloud", () => {
  it("reads the passage lines, then the question", () => {
    const t: Tts = {
      hash: "x", voice: "v", dur: 9,
      words: [[0, 0, 0, 4, 0, 0.4], [0, 0, 5, 9, 0.4, 0.9], [0, 1, 0, 3, 1.5, 2], [1, 0, 0, 3, 4, 4.5]],
    };
    const w = ttsWords(t);
    expect(w[2]).toEqual(["passage", 1, 0, 3, 1.5, 2]);
    expect(w[3][0]).toBe("question");
    expect(blockStarts(w)).toEqual([0, 1.5, 4]);
    expect(timedWordAt(w, 1.2)).toBe(1); // a short pause between lines keeps the last word
    expect(timedWordAt(w, 3.2)).toBe(-1); // the 2 s before the question
    expect(timedWordAt(w, 4.1)).toBe(3);
  });
});
