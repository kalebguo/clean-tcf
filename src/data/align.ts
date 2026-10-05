import { useTimedFile, type TimedWord } from "./timed";
import type { Question } from "./types";

/**
 * Listening timeline (SPEC §5.B), written by scripts/p2/build_p2.py from scripts/p2/align_audio.py:
 * when each transcript line and word is spoken. Offsets s / e are character positions in the line.
 */
export interface Align {
  hash: string;
  /** [start, end, score] per transcript line (seconds); null when the line is not in the recording */
  lines: ([number, number, number] | null)[];
  /** [line, s, e, start, end], in the order they are spoken */
  words: [number, number, number, number, number][];
}

/**
 * Below this score a line gets no play button and no follow highlight. Checked on a 20-recording
 * pilot by cutting each line out and transcribing it: lines above it were cut right ~97 % of the time.
 */
export const MIN_LINE_SCORE = 0.25;

/** The timeline of a listening question, or null (none yet, or made for an older transcript). */
export function useAlign(q: Question | undefined): Align | null {
  return useTimedFile<Align>("align", q, Boolean(q && q.section === "CO" && q.audio));
}

export function lineOk(a: Align, i: number): boolean {
  const l = a.lines[i];
  return Boolean(l && l[2] >= MIN_LINE_SCORE);
}

/** The words of the lines good enough to follow. */
export function alignWords(a: Align): TimedWord[] {
  return a.words.filter((w) => lineOk(a, w[0])).map((w) => ["transcript", w[0], w[1], w[2], w[3], w[4]]);
}

/** The line being spoken at time t (or the last one before it), -1 before the first. */
export function lineAt(a: Align, t: number): number {
  let cur = -1;
  a.lines.forEach((l, i) => {
    if (l && l[0] <= t + 0.05) cur = i;
  });
  return cur;
}
