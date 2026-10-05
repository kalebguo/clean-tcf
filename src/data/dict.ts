import { useEffect, useState } from "react";
import type { Level } from "./types";

export type Band = "function" | "high" | "mid" | "low" | "rare";

/** One word of the vocabulary book: dictionary data (SPEC-P2 §7.2) plus its statistics in the question bank. */
export interface DictEntry {
  lemma: string;
  pos: string;
  posLabel: string;
  /** short meaning line, like 「是，在，存在」 (scripts/p2/dict_brief.py) */
  brief?: string[];
  /** the Chinese Wiktionary confirms none of the brief items: local machine translation only */
  briefMt?: boolean;
  ipa?: string;
  gender?: "m" | "f" | "m/f";
  zh: string[];
  en?: string[];
  /** French definitions (monolingual) */
  fr?: string[];
  /** mt: the Chinese is local machine translation only */
  phrases?: { fr: string; zh?: string; mt?: boolean }[];
  synonyms?: string[];
  audio?: string;
  examples: { qid: string; fr: string; zh?: string }[];
  level: Level;
  band: Band;
  /** times it occurs in the bank */
  tf: number;
  /** questions it occurs in */
  df: number;
  rank: number;
  forms: string[];
  function?: boolean;
  verified?: boolean;
}

export interface Dict {
  entries: DictEntry[];
  byLemma: Map<string, DictEntry>;
  /** normalized surface form -> entries, most frequent first */
  byForm: Map<string, DictEntry[]>;
}

const ELISION = /^(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)['’]/i;

/** Lowercase, straight apostrophes, no surrounding punctuation. */
export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function stripAccents(w: string): string {
  return w.normalize("NFD").replace(/\p{M}/gu, "");
}

export function buildDict(entries: DictEntry[]): Dict {
  const byLemma = new Map(entries.map((e) => [e.lemma, e]));
  const byForm = new Map<string, DictEntry[]>();
  const add = (k: string, e: DictEntry) => {
    const list = byForm.get(k);
    if (!list) byForm.set(k, [e]);
    else if (!list.includes(e)) list.push(e);
  };
  for (const e of entries) {
    for (const f of [e.lemma, ...e.forms]) {
      const n = normalizeWord(f);
      add(n, e);
      add(stripAccents(n), e);
    }
  }
  for (const list of byForm.values()) list.sort((a, b) => a.rank - b.rank);
  return { entries, byLemma, byForm };
}

/**
 * Entries a word of the text may belong to (SPEC-P2 §7.4): by its inflected
 * forms, then without an elided article / pronoun, then ignoring accents.
 */
export function lookup(dict: Dict, word: string): DictEntry[] {
  const w = normalizeWord(word);
  if (!w) return [];
  const bare = w.replace(ELISION, "");
  for (const k of [w, bare, stripAccents(w), stripAccents(bare)]) {
    const hit = dict.byForm.get(k);
    if (hit?.length) return hit;
  }
  return [];
}

const DETERMINERS = new Set("le la les l' un une des du de d' au aux ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs quel quelle quels quelles chaque plusieurs aucun aucune".split(" "));
const SUBJECTS = new Set("je j' tu il elle on nous vous ils elles ne n' se s' me m' te t' qui".split(" "));

/**
 * Order the candidates of an ambiguous form by the word before it:
 * "une annonce" is the noun, "il annonce" the verb; otherwise an exact lemma comes first.
 */
export function byContext(hits: DictEntry[], word: string, prev?: string): DictEntry[] {
  if (hits.length < 2) return hits;
  const p = prev ? normalizeWord(prev.replace(/['’]$/, "'")) + (/['’]$/.test(prev) ? "'" : "") : "";
  const score = (e: DictEntry) => {
    if (DETERMINERS.has(p)) return e.pos === "NOUN" || e.pos === "ADJ" ? 0 : 1;
    if (SUBJECTS.has(p)) return e.pos === "VERB" ? 0 : 1;
    return e.lemma === normalizeWord(word) ? 0 : 1;
  };
  return [...hits].sort((a, b) => score(a) - score(b) || a.rank - b.rank);
}

/** Lookup of a word of the text, ordered by context; an elided article glued to it ("l'annonce") counts as the word before. */
export function lookupInContext(dict: Dict, word: string, prev?: string): DictEntry[] {
  const w = normalizeWord(word);
  const elided = w.match(ELISION)?.[0];
  return byContext(lookup(dict, word), elided ? w.slice(elided.length) : w, elided ?? prev);
}

/** First content word of a selection that the dictionary knows, for the "查词" button. */
export function lookupSelection(dict: Dict, text: string): DictEntry[] {
  const words = text.split(/[\s,.;:!?«»()"“”]+/).filter(Boolean);
  let fallback: DictEntry[] = [];
  for (const w of words) {
    const hit = lookup(dict, w);
    if (!hit.length) continue;
    if (!hit[0].function) return hit;
    if (!fallback.length) fallback = hit;
  }
  return fallback;
}

let dictPromise: Promise<Dict | null> | null = null;

/** The dictionary (about 8 MB), loaded on first use; null when the P2 build has not been run. */
export function loadDict(): Promise<Dict | null> {
  dictPromise ??= fetch("/data/p2/dict.json")
    .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null))
    .then((entries: DictEntry[] | null) => (entries ? buildDict(entries) : null))
    .catch(() => null);
  return dictPromise;
}

/** undefined while loading, null when unavailable. */
export function useDict(): Dict | null | undefined {
  const [dict, setDict] = useState<Dict | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadDict().then((d) => active && setDict(d));
    return () => {
      active = false;
    };
  }, []);
  return dict;
}

/** The short meaning of a word: the brief line, else the first Chinese, else English meanings. */
export function briefOf(e: DictEntry): { text: string; source: "brief" | "mt" | "zh" | "en" } | null {
  if (e.brief?.length) return { text: e.brief.join("，"), source: e.briefMt ? "mt" : "brief" };
  if (e.zh.length) return { text: e.zh.slice(0, 2).join("；"), source: "zh" };
  if (e.en?.length) return { text: e.en.slice(0, 2).join("; "), source: "en" };
  return null;
}

export const BAND_LABEL: Record<Band, string> = { high: "高频", mid: "中频", low: "低频", rare: "罕见", function: "功能词" };

export function playWord(e: Pick<DictEntry, "audio">): void {
  if (e.audio) void new Audio(e.audio).play().catch(() => undefined);
}

export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

/** The browser's French voice; used when a word has no recording or it cannot load (offline). */
function speak(text: string): void {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

/** Flashcards: the Wiktionary recording, else the system voice. */
export function sayWord(e: Pick<DictEntry, "audio" | "lemma">): void {
  if (e.audio) void new Audio(e.audio).play().catch(() => speak(e.lemma));
  else speak(e.lemma);
}
