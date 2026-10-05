import { useEffect, useState } from "react";
import { sourceHash } from "./p2";
import type { Question } from "./types";

/**
 * A word said in a recording: the text block it is in (the data-hl-field / data-hl-index of a
 * HighlightableText), its characters s..e there, and when it is said (seconds).
 * Listening timelines (SPEC §5.B) and reading aloud (SPEC §5.A) both come down to a list of these.
 */
export type TimedWord = [field: string, index: number, s: number, e: number, start: number, end: number];

/** Index of the word being said at time t, or -1. A word lasts until the next one starts (pauses of more than a second excepted). */
export function timedWordAt(w: TimedWord[], t: number): number {
  let lo = 0;
  let hi = w.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (w[mid][4] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  const next = w[found + 1];
  const until = next ? Math.min(next[4], Math.max(w[found][5], w[found][4] + 0.25) + 1) : w[found][5] + 0.5;
  return t < until ? found : -1;
}

/** Start time of the first word of each block (line or paragraph), in order: what [ / ] jump between. */
export function blockStarts(w: TimedWord[]): number[] {
  return w.filter((x, i) => i === 0 || x[0] !== w[i - 1][0] || x[1] !== w[i - 1][1]).map((x) => x[4]);
}

const cache = new Map<string, Promise<unknown>>();

/** /data/p2/<dir>/<qid>.json, or null when there is none (the dev server answers a missing file with the app's HTML). */
export function loadTimedFile<T>(dir: string, qid: string): Promise<T | null> {
  const url = `/data/p2/${dir}/${qid}.json`;
  let p = cache.get(url) as Promise<T | null> | undefined;
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? (r.json() as Promise<T>) : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** The file for this question when `wanted`, and only if it was made for the question's current text. */
export function useTimedFile<T extends { hash: string }>(dir: string, q: Question | undefined, wanted: boolean): T | null {
  const [state, setState] = useState<{ qid: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!q || !wanted) return;
    let active = true;
    void loadTimedFile<T>(dir, q.id).then((d) => active && setState({ qid: q.id, data: d && d.hash === sourceHash(q) ? d : null }));
    return () => {
      active = false;
    };
  }, [dir, q, wanted]);
  return q && wanted && state?.qid === q.id ? state.data : null;
}
