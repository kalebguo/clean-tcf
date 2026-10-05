import { describe, expect, it } from "vitest";
import type { DictEntry } from "../data/dict";
import { checkTyped, choicesOf, clozeOf, pickMode } from "../flashcards/wordModes";

const entry = (over: Partial<DictEntry> = {}): DictEntry => ({
  lemma: "annonce", pos: "NOUN", posLabel: "n.", zh: ["公告"], brief: ["公告", "广告"], examples: [], level: "A1", band: "high",
  tf: 1, df: 1, rank: 1, forms: ["annonce", "annonces"], audio: "x.mp3", ...over,
});

describe("cloze", () => {
  it("blanks the form used in the sentence, after an elision and at the start", () => {
    const e = entry({
      examples: [
        { qid: "CE-1-08", fr: "Vous pouvez publier l’annonce en ligne." },
        { qid: "CO-7-08", fr: "Annonces : trois offres d'emploi." },
      ],
    });
    expect(clozeOf(e, 0)).toMatchObject({ qid: "CE-1-08", before: "Vous pouvez publier l’", answer: "annonce", after: " en ligne." });
    expect(clozeOf(e, 1)).toMatchObject({ qid: "CO-7-08", before: "", answer: "Annonces" });
  });

  it("does not match inside another word, and skips sentences without the word", () => {
    const e = entry({ examples: [{ qid: "a", fr: "Les annonceurs paient." }, { qid: "b", fr: "Une annonce." }] });
    expect(clozeOf(e, 0)?.qid).toBe("b");
    expect(clozeOf(entry({ examples: [{ qid: "a", fr: "Les annonceurs paient." }] }))).toBeNull();
  });
});

describe("typed answers", () => {
  const e = entry();
  it("tells a wrong accent and another form apart from a miss", () => {
    expect(checkTyped(" Annonces ", "annonces", e)).toBe("ok");
    expect(checkTyped("annoncés", "annonces", e)).toBe("accent");
    expect(checkTyped("annonce", "annonces", e)).toBe("form");
    expect(checkTyped("avis", "annonces", e)).toBe("wrong");
    expect(checkTyped("  ", "annonces", e)).toBe("empty");
  });
});

describe("mode choice", () => {
  const withSentence = entry({ examples: [{ qid: "a", fr: "Une annonce." }] });
  it("starts a new card with the easiest self-rated mode chosen", () => {
    expect(pickMode({ id: "w:annonce", reps: 0, state: 0 }, withSentence, ["cloze", "recall", "listen"], true)).toBe("listen");
    expect(pickMode({ id: "w:annonce", reps: 0, state: 0 }, withSentence, ["cloze", "spell"], true)).toBe("cloze");
  });

  it("rotates the chosen modes on reviews and drops the ones the word cannot use", () => {
    const seen = new Set([1, 2, 3, 4].map((reps) => pickMode({ id: "w:annonce", reps, state: 2 }, withSentence, ["recognize", "cloze"], true)));
    expect(seen).toEqual(new Set(["recognize", "cloze"]));
    expect(pickMode({ id: "w:annonce", reps: 3, state: 2 }, entry(), ["cloze"], true)).toBe("recognize");
    expect(pickMode({ id: "w:annonce", reps: 3, state: 2 }, entry({ audio: undefined }), ["dictation"], false)).toBe("recognize");
    expect(pickMode({ id: "w:x", reps: 3, state: 2 }, entry({ brief: undefined, zh: [], en: undefined }), ["spell"], true)).toBe("recognize");
  });
});

describe("four-option choice", () => {
  const w = (lemma: string, brief: string[], over: Partial<DictEntry> = {}) => entry({ lemma, brief, forms: [lemma], ...over });
  const list = [
    entry(),
    w("avis", ["通知", "公告"]), // shares 公告: could be right too
    w("message", ["消息"]), // a synonym of annonce
    w("loyer", ["房租"]),
    w("maison", ["房子"]),
    w("voiture", ["汽车"], { level: "B2" }),
    w("courir", ["跑"], { pos: "VERB", posLabel: "v." }),
    w("bruit", ["噪音"], { verified: false }),
  ];
  const annonce = { ...list[0], synonyms: ["message"] };

  it("puts the right meaning among three wrong ones of the same part of speech", () => {
    const c = choicesOf(annonce, list, 7)!;
    expect(c.options).toHaveLength(4);
    expect(c.options[c.answer]).toBe("公告，广告");
    const wrong = c.options.filter((_, i) => i !== c.answer);
    expect(new Set(wrong)).toEqual(new Set(["房租", "房子", "汽车"]));
  });

  it("is stable for one seed and needs three usable wrong options", () => {
    expect(choicesOf(annonce, list, 7)).toEqual(choicesOf(annonce, list, 7));
    expect(choicesOf(annonce, list.slice(0, 4), 7)).toBeNull();
  });

  it("is only picked for words with a Chinese short meaning", () => {
    expect(pickMode({ id: "w:annonce", reps: 0, state: 0 }, entry(), ["choice", "cloze"], true)).toBe("choice");
    expect(pickMode({ id: "w:annonce", reps: 0, state: 0 }, entry({ brief: undefined }), ["choice"], true)).toBe("recognize");
  });
});
