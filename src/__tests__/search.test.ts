import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Banks } from "../data/bank";
import type { Bank, Question } from "../data/types";
import { SearchEngine, makeSnippet } from "../search/engine";
import { fold } from "../search/fold";
import { matchId, parseQuery } from "../search/parseQuery";

describe("parseQuery", () => {
  it("parses question-number syntax", () => {
    expect(parseQuery("5-8")).toEqual({ kind: "id", section: undefined, ref: "5", num: 8 });
    expect(parseQuery("155-8")).toMatchObject({ kind: "id", ref: "155", num: 8 });
    expect(parseQuery("CO-5-8")).toMatchObject({ kind: "id", section: "CO", ref: "5", num: 8 });
    expect(parseQuery("听力 5-8")).toMatchObject({ kind: "id", section: "CO", ref: "5", num: 8 });
    expect(parseQuery("阅读 12")).toMatchObject({ kind: "id", section: "CE", ref: "12" });
    expect(parseQuery("gr01-3")).toMatchObject({ kind: "id", ref: "GR01", num: 3 });
  });
  it("parses text with phrases", () => {
    expect(parseQuery(`"à cause de" pluie`)).toEqual({ kind: "text", section: undefined, terms: "à cause de pluie", phrases: ["à cause de"] });
    expect(parseQuery("  ")).toEqual({ kind: "empty" });
  });
  it("matches set and series, GR01 = GR1", () => {
    const q = { section: "CO", appearances: [{ set: "GR01", num: 3 }, { set: "5", num: 8, series: "155" }] } as unknown as Question;
    expect(matchId(q, { kind: "id", ref: "GR1", num: 3 })).toBe(true);
    expect(matchId(q, { kind: "id", ref: "155", num: 8 })).toBe(true);
    expect(matchId(q, { kind: "id", ref: "155", num: 9 })).toBe(false);
    expect(matchId(q, { kind: "id", section: "CE", ref: "5" })).toBe(false);
  });
});

describe("fold & snippet", () => {
  it("keeps a 1:1 mapping", () => {
    const s = "Élève à l'école, cœur";
    expect(fold(s)).toBe("eleve a l'ecole, cœur");
    expect(fold(s).length).toBe(s.length);
  });
  it("cuts around the match with original accents", () => {
    const sn = makeSnippet("Le père d'Hamza calcule combien ça lui coûtera.", ["coutera"], 10)!;
    expect(sn.match).toBe("coûtera");
  });
});

// needs the real bank (`npm run data`); skipped without it, and with the demo bank (`npm run demo`)
const REAL_BANK = existsSync("public/data/listening.json") && !existsSync("public/data/.demo");

describe.runIf(REAL_BANK)("search engine on the real bank", () => {
  if (!REAL_BANK) return; // vitest still runs the body of a skipped describe
  const load = (f: string): Bank => {
    const raw = JSON.parse(readFileSync(`public/data/${f}`, "utf8"));
    return { ...raw, byId: new Map(raw.questions.map((q: Question) => [q.id, q])) };
  };
  const CO = load("listening.json");
  const CE = load("reading.json");
  const banks: Banks = { CO, CE, get: (id) => (id.startsWith("CO-") ? CO : CE).byId.get(id) };
  const lemmas = JSON.parse(readFileSync("public/data/search-lemmas.json", "utf8"));
  const t0 = performance.now();
  const engine = new SearchEngine(banks, lemmas);
  const buildMs = performance.now() - t0;

  it("builds the index in under a second", () => {
    expect(buildMs).toBeLessThan(1000);
  });
  it("is accent-insensitive", () => {
    const hits = engine.search("eleve");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /élève|élevé/i.test(JSON.stringify(h.q)))).toBe(true);
  });
  it("finds conjugated forms through the base form", () => {
    const hits = engine.search("aller");
    const texts = hits.map((h) => JSON.stringify(h.q).toLowerCase());
    expect(texts.some((t) => /\b(vais|vas|allons|allez|vont|irai|iras|ira)\b/.test(t))).toBe(true);
  });
  it("resolves question numbers", () => {
    const hits = engine.search("CO-5-8");
    expect(hits.map((h) => h.q.id)).toEqual(["CO-5-08"]);
    expect(engine.search("17-4").some((h) => h.q.id === "CO-5-08")).toBe(true); // merged duplicate
  });
  it("filters exact phrases", () => {
    const hits = engine.search(`"à cause de"`);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(fold(JSON.stringify(h.q))).toContain("a cause de");
  });
  it("answers a query in under 50 ms", () => {
    const t = performance.now();
    engine.search("logement étudiant");
    expect(performance.now() - t).toBeLessThan(50);
  });
});
