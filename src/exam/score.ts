import { isPictureItem } from "../data/bank";
import { LEVELS, type Letter, type Level, type Question, type Section } from "../data/types";

/** Questions per level in a TCF section: 39 questions, 699 points. */
export const EXAM_DIST: Record<Level, number> = { A1: 4, A2: 6, B1: 9, B2: 10, C1: 6, C2: 4 };
export const EXAM_MAX = 699;

/** Reading: 60 minutes, then the paper is submitted. Listening is paced by its recordings instead. */
export const READING_LIMIT_MS = 60 * 60 * 1000;
/** Listening in the real exam lasts 35 minutes (about 30 of recordings, the rest to answer). */
export const LISTENING_MINUTES = 35;
export const ANSWER_SECONDS = [5, 10, 15, 20, 30];

export type ExamSource = "all" | "main" | "extra";

/**
 * A mock paper: EXAM_DIST questions of each level, from the chosen source, easiest first
 * (picture items first inside a level, as in the exam). With onlyNew, questions never
 * answered are preferred; when a level has too few, answered ones fill the gap.
 */
export function pickExam(
  questions: Question[],
  opts: { source: ExamSource; onlyNew: boolean; isDone(qid: string): boolean },
  random: () => number = Math.random,
): { qids: string[]; refilled: Partial<Record<Level, number>> } {
  const qids: string[] = [];
  const refilled: Partial<Record<Level, number>> = {};
  for (const level of LEVELS) {
    const n = EXAM_DIST[level];
    const pool = questions.filter((q) => q.level === level && (opts.source === "all" || q.source === opts.source));
    const fresh = opts.onlyNew ? pool.filter((q) => !opts.isDone(q.id)) : pool;
    let picked = sample(fresh, n, random);
    if (picked.length < n) {
      const rest = pool.filter((q) => !picked.includes(q));
      const more = sample(rest, n - picked.length, random);
      if (opts.onlyNew && more.length) refilled[level] = more.length;
      picked = [...picked, ...more];
    }
    picked.sort((a, b) => Number(isPictureItem(b)) - Number(isPictureItem(a)));
    qids.push(...picked.map((q) => q.id));
  }
  return { qids, refilled };
}

function sample<T>(list: T[], n: number, random: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export interface ExamScore {
  score: number;
  max: number;
  total: number;
  answered: number;
  correct: number;
  byLevel: { level: Level; total: number; correct: number }[];
}

/** Points of the correct answers; an unanswered question scores nothing. */
export function scoreExam(
  qids: string[],
  choices: Record<string, { choice?: Letter } | undefined>,
  lookup: (qid: string) => Question | undefined,
): ExamScore {
  const r: ExamScore = { score: 0, max: 0, total: 0, answered: 0, correct: 0, byLevel: [] };
  const levels = new Map<Level, { level: Level; total: number; correct: number }>();
  for (const id of qids) {
    const q = lookup(id);
    if (!q) continue;
    const choice = choices[id]?.choice;
    const ok = choice === q.answer;
    r.total++;
    r.max += q.points;
    if (choice) r.answered++;
    if (ok) {
      r.correct++;
      r.score += q.points;
    }
    const l = levels.get(q.level) ?? { level: q.level, total: 0, correct: 0 };
    l.total++;
    if (ok) l.correct++;
    levels.set(q.level, l);
  }
  r.byLevel = LEVELS.flatMap((l) => levels.get(l) ?? []);
  return r;
}

/** Lowest score of NCLC 4 … 10 (IRCC table for TCF Canada). */
export const NCLC_FLOOR: Record<Section, number[]> = {
  CO: [331, 369, 398, 458, 503, 523, 549],
  CE: [342, 375, 406, 453, 499, 524, 549],
};

/** NCLC level of a score out of 699; null below NCLC 4. */
export function nclcOf(section: Section, score: number): number | null {
  const passed = NCLC_FLOOR[section].filter((f) => score >= f).length;
  return passed ? passed + 3 : null;
}

/** CEFR level of a score out of 699 (100–199 A1 … 600–699 C2). */
export function cefrOf(score: number): Level | null {
  if (score < 100) return null;
  return LEVELS[Math.min(5, Math.floor(score / 100) - 1)];
}

/** A score on another scale, brought to 699 (a set test with fewer questions). */
export function scaled(score: number, max: number): number {
  return max ? Math.round((score / max) * EXAM_MAX) : 0;
}
