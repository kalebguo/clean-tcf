import { useTimedFile, type TimedWord } from "./timed";
import type { Question } from "./types";

/**
 * Reading aloud (SPEC §5.A), written by scripts/p2/build_p2.py from scripts/p2/tts.py: a macOS voice
 * reads the passage, then the question; words are [field, index, s, e, start, end] with field
 * 0 = passage (index = line), 1 = question.
 */
export interface Tts {
  hash: string;
  voice: string;
  dur: number;
  words: [0 | 1, number, number, number, number, number][];
}

/** The read-aloud of a reading question, or null (none yet, or made for an older text). */
export function useTts(q: Question | undefined, wanted = true): Tts | null {
  return useTimedFile<Tts>("tts", q, Boolean(wanted && q && q.section === "CE"));
}

export function ttsWords(t: Tts): TimedWord[] {
  return t.words.map(([f, i, s, e, start, end]) => [f ? "question" : "passage", i, s, e, start, end]);
}

export const ttsAudio = (qid: string) => `/media-tts/${qid}.m4a`;
