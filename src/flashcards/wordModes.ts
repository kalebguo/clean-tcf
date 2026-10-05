import { briefOf, normalizeWord, stripAccents, type DictEntry } from "../data/dict";
import { LEVELS } from "../data/types";
import type { FlashCard } from "../db/schema";

/*
 * Ways to study a word card. All of them rate the same FSRS card: the mode only changes
 * what the front asks. Self-rated modes flip and the learner rates; typed modes check the
 * answer first (giving up rates "again"); the choice mode judges the pick (a wrong pick rates "again").
 */

export type WordMode = "recognize" | "choice" | "listen" | "recall" | "cloze" | "spell" | "dictation";

/** Easiest first: a new card takes the first mode without typing that the learner chose. */
export const WORD_MODES: { mode: WordMode; label: string; sub: string; typed: boolean; seconds: number }[] = [
  { mode: "recognize", label: "看法语想中文", sub: "正面是法语单词和发音", typed: false, seconds: 7 },
  { mode: "choice", label: "四选一", sub: "看法语，从四个中文意思里选；选错记「重来」", typed: false, seconds: 5 },
  { mode: "listen", label: "听发音想中文", sub: "正面只有发音，不显示单词", typed: false, seconds: 8 },
  { mode: "recall", label: "看中文想法语", sub: "正面是中文释义和词性", typed: false, seconds: 9 },
  { mode: "cloze", label: "例句填空", sub: "题库例句里挖掉这个词，写出句子里的形式", typed: true, seconds: 18 },
  { mode: "spell", label: "看中文拼写", sub: "写出法语原形", typed: true, seconds: 14 },
  { mode: "dictation", label: "听音写词", sub: "听发音，写出法语原形", typed: true, seconds: 14 },
];

export const MODE_OF = Object.fromEntries(WORD_MODES.map((m) => [m.mode, m])) as Record<WordMode, (typeof WORD_MODES)[number]>;
export const DEFAULT_MODES: WordMode[] = ["recognize", "cloze"];

export interface Cloze {
  qid: string;
  before: string;
  /** the word as it is written in the sentence ("annonces", "Annonce") */
  answer: string;
  after: string;
  zh?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A bank sentence with the word blanked out. Sentences rotate with the number of reviews,
 * so each review shows another context when there is one. null when no sentence contains
 * one of the word's forms (OCR noise, a form the list does not know).
 */
export function clozeOf(e: DictEntry, reps = 0): Cloze | null {
  const forms = [...new Set([e.lemma, ...e.forms].map((f) => f.replace(/’/g, "'")))].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!forms.length || !e.examples.length) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "iu");
  const n = e.examples.length;
  for (let k = 0; k < n; k++) {
    const x = e.examples[(reps + k) % n];
    // same length, so indexes found in the straightened text hold in the original
    const m = re.exec(x.fr.replace(/’/g, "'"));
    if (!m) continue;
    return { qid: x.qid, before: x.fr.slice(0, m.index), answer: x.fr.slice(m.index, m.index + m[0].length), after: x.fr.slice(m.index + m[0].length), zh: x.zh };
  }
  return null;
}

export interface Choice {
  /** four short Chinese meanings */
  options: string[];
  /** index of the right one */
  answer: number;
}

/** Small seeded generator, so a card shows the same options until it is rated. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Four meanings for the choice mode. Wrong options come from other words of the same part of
 * speech, nearest level first, so they look plausible. A word whose short meaning shares an item
 * with the right one, or that is listed as a synonym either way, is never used: it could be right too.
 * null when the word has no meaning or fewer than three other words qualify.
 */
export function choicesOf(e: DictEntry, entries: DictEntry[], seed: number): Choice | null {
  const right = briefOf(e)?.text;
  if (!right) return null;
  const mine = new Set(e.brief ?? [right]);
  const lv = LEVELS.indexOf(e.level);
  const rand = rng(seed);
  const tier = (d: DictEntry) => (d.pos !== e.pos ? 3 : Math.min(2, Math.abs(LEVELS.indexOf(d.level) - lv)));
  const pool = entries
    .filter(
      (d) =>
        d.lemma !== e.lemma && d.verified !== false && d.brief?.length && !d.brief.some((b) => mine.has(b)) &&
        !e.synonyms?.includes(d.lemma) && !d.synonyms?.includes(e.lemma),
    )
    .map((d) => ({ text: d.brief!.join("，"), key: tier(d) + rand() }))
    .sort((a, b) => a.key - b.key);
  const wrong: string[] = [];
  for (const d of pool) {
    if (d.text !== right && !wrong.includes(d.text)) wrong.push(d.text);
    if (wrong.length === 3) break;
  }
  if (wrong.length < 3) return null;
  const answer = Math.floor(rand() * 4);
  wrong.splice(answer, 0, right);
  return { options: wrong, answer };
}

export type Check = "ok" | "accent" | "form" | "wrong" | "empty";

const norm = (s: string) => normalizeWord(s).replace(/\s+/g, " ");

/** Compare what was typed with the expected word; another form of the same word is told apart from a miss. */
export function checkTyped(typed: string, answer: string, e: Pick<DictEntry, "lemma" | "forms">): Check {
  const a = norm(typed);
  if (!a) return "empty";
  const want = norm(answer);
  if (a === want) return "ok";
  if (stripAccents(a) === stripAccents(want)) return "accent";
  if ([e.lemma, ...e.forms].some((f) => norm(f) === a)) return "form";
  return "wrong";
}

export const CHECK_TEXT: Record<Exclude<Check, "ok" | "empty">, { cloze: string; base: string }> = {
  accent: { cloze: "重音不对，再试一次", base: "重音不对，再试一次" },
  form: { cloze: "是这个词，但句子里要用别的形式", base: "是这个词的变形，请写原形" },
  wrong: { cloze: "不对，再试一次", base: "不对，再试一次" },
};

export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The mode for this showing of a card. Modes the word cannot support are dropped (no meaning:
 * no recall/spell; no sentence with the word: no cloze; nothing to play: no listening).
 * A new card starts with the easiest self-rated mode chosen; later reviews rotate.
 */
export function pickMode(c: Pick<FlashCard, "id" | "reps" | "state">, e: DictEntry | undefined, chosen: WordMode[], canSpeak: boolean): WordMode {
  if (!e) return "recognize";
  const ok = (m: WordMode) => {
    if (m === "recall" || m === "spell") return !!briefOf(e);
    // Chinese short meaning, so the right option does not stand out among the others
    if (m === "choice") return !!e.brief?.length;
    if (m === "cloze") return !!clozeOf(e, c.reps);
    if (m === "listen" || m === "dictation") return !!e.audio || canSpeak;
    return true;
  };
  const usable = WORD_MODES.map((m) => m.mode).filter((m) => chosen.includes(m) && ok(m));
  if (!usable.length) return "recognize";
  if (c.state === 0) return usable.find((m) => !MODE_OF[m].typed) ?? usable[0];
  return usable[(hash(c.id) + c.reps) % usable.length];
}
