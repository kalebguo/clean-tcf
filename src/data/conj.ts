import { useEffect, useState } from "react";
import { normalizeWord, stripAccents } from "./dict";

/** Simple tenses as written by scripts/p2/build_forms.py; "pc" (passé composé) is built here from aux + pp. */
export type TenseKey = "pres" | "impf" | "pc" | "fut" | "cond" | "subj" | "ps" | "imp";

export interface Conj {
  aux?: "avoir" | "être";
  /** past / present participle */
  pp?: string;
  ppr?: string;
  /** only the pronominal verb has a table ("se souvenir"): its forms carry the pronoun */
  refl?: boolean;
  /** six persons (je … ils), or three for the imperative (tu, nous, vous); null where the verb has no form */
  t: Partial<Record<Exclude<TenseKey, "pc">, (string | null)[]>>;
}

export type ConjTable = Record<string, Conj>;

export const TENSE_ORDER: TenseKey[] = ["pres", "pc", "impf", "fut", "cond", "subj", "ps", "imp"];
export const TENSE_LABEL: Record<TenseKey, string> = {
  pres: "现在时", impf: "未完成过去时", pc: "复合过去时", fut: "简单将来时",
  cond: "条件式现在时", subj: "虚拟式现在时", ps: "简单过去时", imp: "命令式",
};
export const PERSONS = ["je", "tu", "il / elle", "nous", "vous", "ils / elles"];
export const IMP_PERSONS = ["tu", "nous", "vous"];

const AUX_PRES = { avoir: ["ai", "as", "a", "avons", "avez", "ont"], être: ["suis", "es", "est", "sommes", "êtes", "sont"] };
const REFL_PRON = ["me", "te", "se", "nous", "vous", "se"];
const VOWEL = /^[aeéèêiîoôuhœ]/i;

/** Passé composé: auxiliary + past participle (with the agreement marks of être). */
export function passeCompose(c: Conj): (string | null)[] | undefined {
  if (!c.pp) return undefined;
  const aux = c.refl ? "être" : c.aux ?? "avoir";
  return AUX_PRES[aux].map((a, i) => {
    const pp = aux === "être" ? c.pp + (i < 3 ? "(e)" : "(e)s") : c.pp;
    const pron = c.refl ? (VOWEL.test(a) && i !== 3 && i !== 4 ? REFL_PRON[i][0] + "'" : REFL_PRON[i] + " ") : "";
    return `${pron}${a} ${pp}`;
  });
}

/** Rows of one tense, the passé composé included. */
export function tenseForms(c: Conj, key: TenseKey): (string | null)[] | undefined {
  return key === "pc" ? passeCompose(c) : c.t[key];
}

/** "me souviens" -> "souviens", "s'est" -> "est": the verb form a text would show on its own. */
function bare(form: string): string {
  return form.replace(/^(?:me|te|se|nous|vous)\s+|^[mts]'/i, "");
}

export interface FormHit {
  lemma: string;
  /** a tense, or the infinitive / participles */
  tense: Exclude<TenseKey, "pc"> | "inf" | "pp" | "ppr";
  /** index into PERSONS (IMP_PERSONS for the imperative); -1 for non-finite forms */
  person: number;
}

export type FormIndex = Map<string, FormHit[]>;

/** Inflected form (lowercase, also without accents) -> where it sits in the tables. */
export function buildFormIndex(table: ConjTable): FormIndex {
  const index: FormIndex = new Map();
  const add = (form: string | null | undefined, hit: FormHit) => {
    if (!form) return;
    const n = normalizeWord(bare(form));
    for (const k of new Set([n, stripAccents(n)])) {
      const list = index.get(k);
      if (!list) index.set(k, [hit]);
      else if (!list.some((h) => h.lemma === hit.lemma && h.tense === hit.tense && h.person === hit.person)) list.push(hit);
    }
  };
  for (const [lemma, c] of Object.entries(table)) {
    add(lemma, { lemma, tense: "inf", person: -1 });
    add(c.pp, { lemma, tense: "pp", person: -1 });
    add(c.ppr, { lemma, tense: "ppr", person: -1 });
    for (const [key, forms] of Object.entries(c.t)) {
      forms?.forEach((f, i) => add(f, { lemma, tense: key as FormHit["tense"], person: i }));
    }
  }
  return index;
}

/** The places a word of the text occupies in one verb's table, e.g. "allons" -> 现在时 nous, 命令式 nous. */
export function formsOf(index: FormIndex, lemma: string, word: string): FormHit[] {
  const n = normalizeWord(word).replace(/^(?:[mts]|qu|j|l|n|d)'/, "");
  const hits = index.get(n) ?? index.get(stripAccents(n)) ?? [];
  return hits.filter((h) => h.lemma === lemma);
}

/** "现在时 nous" / "过去分词" */
export function formLabel(h: FormHit): string {
  if (h.tense === "inf") return "不定式";
  if (h.tense === "pp") return "过去分词";
  if (h.tense === "ppr") return "现在分词";
  const who = h.tense === "imp" ? IMP_PERSONS[h.person] : PERSONS[h.person];
  return `${TENSE_LABEL[h.tense]} ${who}`;
}

export interface Conjugations {
  table: ConjTable;
  index: FormIndex;
}

let conjPromise: Promise<Conjugations | null> | null = null;

/** The conjugation tables (about 1 MB), loaded on first use; null when the P2 build has not been run. */
export function loadConj(): Promise<Conjugations | null> {
  conjPromise ??= fetch("/data/p2/conj.json")
    .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null))
    .then((table: ConjTable | null) => (table ? { table, index: buildFormIndex(table) } : null))
    .catch(() => null);
  return conjPromise;
}

/** undefined while loading, null when unavailable. Pass false to skip loading (e.g. not a verb). */
export function useConj(enabled = true): Conjugations | null | undefined {
  const [conj, setConj] = useState<Conjugations | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadConj().then((c) => active && setConj(c));
    return () => {
      active = false;
    };
  }, [enabled]);
  return conj;
}
