import { useEffect, useState } from "react";
import { LETTERS, type Letter, type Question } from "./types";

/** Field of a question's source text that P2 content points into. */
export type P2Field = "transcript" | "question" | "passage";

export interface P2Span {
  index: number;
  s: number;
  e: number;
}

/** One question's generated content, as written by scripts/p2/build_p2.py (SPEC-P2 §8.1). */
export interface P2Question {
  id: string;
  hash: string;
  stale?: true;
  reviewed?: true;
  segments?: { field: P2Field; zh: string; en: string; spans: P2Span[] }[];
  options?: ({ zh: string; en: string } | null)[];
  analysis?: { summary: string; options: Record<Letter, { correct: boolean; why: string }> };
  evidence?: { letter: Letter; field: P2Field; index: number; s: number; e: number }[];
  check?: { agree: boolean; note: string };
}

export interface P2IndexEntry {
  gen: boolean;
  reviewed: boolean;
  stale: boolean;
}

/** Must match source_hash() in scripts/p2/build_p2.py. */
export function sourceHash(q: Question): string {
  const parts = [q.answer, ...q.options, "#t", ...(q.transcript ?? []), "#q", q.question ?? "", "#p", ...(q.passage ?? [])];
  const s = parts.join("\x1f");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Content as it may be shown for the question's current text. If the bank changed
 * after the build, positions can no longer be trusted: treat it as stale, and keep
 * the analysis only if it still marks the current official answer as correct.
 */
export function fitToQuestion(p2: P2Question, q: Question): P2Question {
  if (!p2.stale && p2.hash === sourceHash(q)) return p2;
  const out: P2Question = { ...p2, stale: true, evidence: undefined };
  out.segments = p2.segments?.map((s) => ({ ...s, spans: [] }));
  const an = p2.analysis;
  if (an && !LETTERS.every((L) => an.options[L]?.correct === (L === q.answer))) {
    out.analysis = undefined;
    out.check = undefined;
  }
  return out;
}

let indexPromise: Promise<Record<string, P2IndexEntry>> | null = null;

/** Which questions have P2 content; empty when the P2 build has not been run. */
export function loadP2Index(): Promise<Record<string, P2IndexEntry>> {
  indexPromise ??= fetch("/data/p2/index.json")
    .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : {}))
    .catch(() => ({}));
  return indexPromise;
}

const cache = new Map<string, Promise<P2Question | null>>();

/** A question's P2 file, or null when it has none. Never throws. */
export function loadP2(qid: string): Promise<P2Question | null> {
  let p = cache.get(qid);
  if (!p) {
    p = loadP2Index()
      .then((index) => (index[qid] ? fetch(`/data/p2/q/${qid}.json`).then((r) => (r.ok ? r.json() : null)) : null))
      .catch(() => null);
    cache.set(qid, p);
  }
  return p;
}

/** P2 content for the current question (fitted to its text), and prefetch of its neighbours. */
export function useP2(q: Question | undefined, neighbours: string[] = []): P2Question | null {
  const [state, setState] = useState<{ qid: string; p2: P2Question | null } | null>(null);
  useEffect(() => {
    if (!q) return;
    let active = true;
    void loadP2(q.id).then((p2) => active && setState({ qid: q.id, p2: p2 && fitToQuestion(p2, q) }));
    for (const id of neighbours) void loadP2(id);
    return () => {
      active = false;
    };
  }, [q, neighbours.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return q && state?.qid === q.id ? state.p2 : null;
}

export function useP2Index(): Record<string, P2IndexEntry> | null {
  const [index, setIndex] = useState<Record<string, P2IndexEntry> | null>(null);
  useEffect(() => {
    void loadP2Index().then(setIndex);
  }, []);
  return index;
}

// ------------------------------------------------------------ positions per text block

export interface SentenceRange {
  s: number;
  e: number;
  sid: number;
}

export interface EvidenceRange {
  s: number;
  e: number;
  /** letter as displayed (after option shuffling) */
  label: string;
  answer: boolean;
}

/** Sentence pieces that fall in one block, keyed by "field:index". sid is the segment's index. */
export function sentenceRanges(p2: P2Question | null): Map<string, SentenceRange[]> {
  const out = new Map<string, SentenceRange[]>();
  p2?.segments?.forEach((seg, sid) => {
    for (const sp of seg.spans) {
      const k = `${seg.field}:${sp.index}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push({ s: sp.s, e: sp.e, sid });
    }
  });
  return out;
}

export function evidenceRanges(p2: P2Question | null, answer: Letter, label: (l: Letter) => string): Map<string, EvidenceRange[]> {
  const out = new Map<string, EvidenceRange[]>();
  for (const ev of p2?.evidence ?? []) {
    const k = `${ev.field}:${ev.index}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ s: ev.s, e: ev.e, label: label(ev.letter), answer: ev.letter === answer });
  }
  return out;
}

/**
 * Translations laid out by the source's lines / paragraphs: each block gets the
 * translations of the sentences that start in it (a sentence running over several
 * lines sits on its first line). Stale content has no positions, so each sentence
 * becomes its own block.
 */
export function translatedBlocks(p2: P2Question, field: P2Field, lang: "zh" | "en", blockCount: number): string[] {
  const segs = (p2.segments ?? []).filter((s) => s.field === field);
  if (p2.stale) return segs.map((s) => s[lang]);
  const blocks: string[][] = Array.from({ length: blockCount }, () => []);
  for (const s of segs) {
    const first = s.spans[0];
    if (first && first.index < blockCount) blocks[first.index].push(s[lang]);
  }
  return blocks.map((parts) => parts.join(lang === "zh" ? "" : " ")).filter(Boolean);
}
