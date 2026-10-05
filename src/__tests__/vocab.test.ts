import { describe, expect, it } from "vitest";
import { briefOf, buildDict, byContext, lookup, lookupInContext, lookupSelection, type DictEntry } from "../data/dict";
import { buildFormIndex, formLabel, formsOf, passeCompose, type ConjTable } from "../data/conj";
import { searchDict } from "../data/dictSearch";
import { vocabCsv } from "../db/vocab";

const entry = (lemma: string, forms: string[], rank: number, extra: Partial<DictEntry> = {}): DictEntry => ({
  lemma, pos: "NOUN", posLabel: "n.", zh: [], examples: [], level: "A1", band: "high", tf: 1, df: 1, rank, forms, ...extra,
});

const dict = buildDict([
  entry("le", ["le", "la", "les", "l'"], 1, { function: true, pos: "DET" }),
  entry("être", ["est", "sont", "été"], 2, { pos: "VERB" }),
  entry("est", ["est"], 900),
  entry("annonce", ["annonce", "annonces"], 50, { zh: ["启事"], brief: ["公告", "广告"] }),
  entry("annoncer", ["annonce", "annoncé", "annoncer"], 40, { pos: "VERB" }),
  entry("élève", ["élève", "élèves"], 60),
]);

describe("dictionary lookup", () => {
  it("finds the lemma of an inflected form, most frequent first", () => {
    expect(lookup(dict, "annonces").map((e) => e.lemma)).toEqual(["annonce"]);
    expect(lookup(dict, "annonce").map((e) => e.lemma)).toEqual(["annoncer", "annonce"]);
    expect(lookup(dict, "est").map((e) => e.lemma)).toEqual(["être", "est"]);
  });
  it("ignores case, punctuation, elision and missing accents", () => {
    expect(lookupInContext(dict, "L’annonce,")[0].lemma).toBe("annonce");
    expect(lookupInContext(dict, "«Annonces»")[0].lemma).toBe("annonce");
    expect(lookup(dict, "eleves")[0].lemma).toBe("élève");
    expect(lookup(dict, "d'élèves")[0].lemma).toBe("élève");
  });
  it("uses the word before to choose between noun and verb", () => {
    const hits = lookup(dict, "annonce");
    expect(byContext(hits, "annonce", "une")[0].lemma).toBe("annonce");
    expect(byContext(hits, "annonce", "l'")[0].lemma).toBe("annonce");
    expect(byContext(hits, "annonce", "il")[0].lemma).toBe("annoncer");
    expect(byContext(hits, "annonce", "et")[0].lemma).toBe("annonce"); // exact lemma
    expect(byContext(lookup(dict, "est"), "est", "il")[0].lemma).toBe("être");
    expect(lookupInContext(dict, "annonce", "il")[0].lemma).toBe("annoncer");
  });
  it("returns nothing for unknown words", () => {
    expect(lookup(dict, "xyzzy")).toEqual([]);
    expect(lookup(dict, "…")).toEqual([]);
  });
  it("looks up the first content word of a selection", () => {
    expect(lookupSelection(dict, "les annonces du site")[0].lemma).toBe("annonce");
    expect(lookupSelection(dict, "les")[0].lemma).toBe("le");
  });
});

describe("vocabulary CSV", () => {
  it("quotes cells with commas, quotes and line breaks", () => {
    const csv = vocabCsv(
      [{ lemma: "annonce", addedAt: Date.UTC(2026, 9, 4), mastered: false, context: 'Il a dit "oui", puis\nnon', qid: "CE-1-11" }],
      dict.byLemma,
    );
    const [head, row] = csv.split("\n");
    expect(head).toBe("lemma,pos,gender,ipa,brief,zh,en,fr,note,context,qid,added,mastered");
    expect(csv).toContain('"Il a dit ""oui"", puis\nnon"');
    expect(row.startsWith("annonce,n.,,,公告，广告,启事,,,,")).toBe(true);
    expect(csv).toContain(",CE-1-11,2026-10-04,\n");
  });
});

const table: ConjTable = {
  aller: {
    aux: "être", pp: "allé", ppr: "allant",
    t: {
      pres: ["vais", "vas", "va", "allons", "allez", "vont"],
      impf: ["allais", "allais", "allait", "allions", "alliez", "allaient"],
      imp: ["va", "allons", "allez"],
    },
  },
  annoncer: { aux: "avoir", pp: "annoncé", t: { pres: ["annonce", "annonces", "annonce", "annonçons", "annoncez", "annoncent"] } },
  souvenir: { pp: "souvenu", refl: true, t: { pres: ["me souviens", "te souviens", "se souvient", "nous souvenons", "vous souvenez", "se souviennent"] } },
};
const index = buildFormIndex(table);

describe("conjugation", () => {
  it("tells the tense and person of a form, all of them when it is ambiguous", () => {
    expect(formsOf(index, "aller", "allons").map(formLabel)).toEqual(["现在时 nous", "命令式 nous"]);
    expect(formsOf(index, "aller", "allais").map(formLabel)).toEqual(["未完成过去时 je", "未完成过去时 tu"]);
    expect(formsOf(index, "aller", "Allé")[0].tense).toBe("pp");
    expect(formsOf(index, "annoncer", "annoncons").map(formLabel)).toEqual(["现在时 nous"]); // accent left out
    expect(formsOf(index, "annoncer", "allons")).toEqual([]);
  });
  it("finds pronominal forms without their pronoun", () => {
    expect(formsOf(index, "souvenir", "souvient").map(formLabel)).toEqual(["现在时 il / elle"]);
    expect(formsOf(index, "souvenir", "s'est")).toEqual([]);
  });
  it("builds the passé composé with the right auxiliary", () => {
    expect(passeCompose(table.annoncer)?.[0]).toBe("ai annoncé");
    expect(passeCompose(table.aller)?.slice(2, 4)).toEqual(["est allé(e)", "sommes allé(e)s"]);
    expect(passeCompose(table.souvenir)?.slice(0, 3)).toEqual(["me suis souvenu(e)", "t'es souvenu(e)", "s'est souvenu(e)"]);
  });
});

describe("brief meaning", () => {
  it("prefers the brief line, then Chinese, then English meanings", () => {
    expect(briefOf(entry("a", [], 1, { brief: ["是", "在"], zh: ["存在"] }))).toEqual({ text: "是，在", source: "brief" });
    expect(briefOf(entry("b", [], 1, { brief: ["步骤"], briefMt: true }))).toEqual({ text: "步骤", source: "mt" });
    expect(briefOf(entry("c", [], 1, { zh: ["宣告", "启事", "叫牌"] }))).toEqual({ text: "宣告；启事", source: "zh" });
    expect(briefOf(entry("d", [], 1, { en: ["gait", "walk", "step"] }))).toEqual({ text: "gait; walk", source: "en" });
    expect(briefOf(entry("e", [], 1))).toBeNull();
  });
});

describe("lookup box", () => {
  const d = buildDict([
    entry("aller", ["va", "allons"], 5, { pos: "VERB", zh: ["去，走"] }),
    entry("annonce", ["annonce"], 50, { zh: ["启事", "宣布，公告"], en: ["advertisement"] }),
    entry("annoncer", ["annonce"], 40, { pos: "VERB", zh: ["宣布"], en: ["to announce"] }),
    entry("annuel", ["annuel"], 70, { pos: "ADJ", zh: ["每年的"] }),
    entry("démarche", ["démarche"], 80, { brief: ["步骤", "步态"], briefMt: true, en: ["gait, walk"] }),
  ]);
  const conj = { table, index };
  it("finds a form the bank never uses through the conjugation tables", () => {
    expect(searchDict(d, conj, "allions")[0].lemma).toBe("aller");
    expect(searchDict(d, null, "allions")).toEqual([]);
  });
  it("lists words starting with the query after exact matches", () => {
    expect(searchDict(d, conj, "ann").map((e) => e.lemma)).toEqual(["annuel", "annonce", "annoncer"]);
  });
  it("looks up Chinese: exact meaning first", () => {
    expect(searchDict(d, conj, "宣布").map((e) => e.lemma)).toEqual(["annoncer", "annonce"]);
  });
  it("looks up Chinese in the brief meaning line too", () => {
    expect(searchDict(d, conj, "步骤").map((e) => e.lemma)).toEqual(["démarche"]);
  });
  it("falls back to English meanings", () => {
    expect(searchDict(d, conj, "announce").map((e) => e.lemma)).toEqual(["annoncer"]);
  });
});
