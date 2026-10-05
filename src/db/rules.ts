import type { Letter, Level, Section } from "../data/types";
import type { DraftEntry, QState } from "./schema";

export interface AttemptInput {
  qid: string;
  section: Section;
  level: Level;
  choice: Letter;
  correct: boolean;
  peeked: boolean;
  at: number;
}

/**
 * Wrong-book state machine (SPEC §5):
 *  - wrong answer            → open (from any state), wrongCount + 1
 *  - correct, not peeked     → open becomes fixed
 *  - correct after peeking   → unchanged
 */
export function applyAttempt(prev: QState | undefined, a: AttemptInput): QState {
  const base: QState = prev ?? {
    qid: a.qid,
    section: a.section,
    level: a.level,
    attempts: 0,
    correctCount: 0,
    lastChoice: a.choice,
    lastCorrect: false,
    lastAt: 0,
    wrong: "none",
    wrongCount: 0,
  };
  const next: QState = {
    ...base,
    section: a.section,
    level: a.level,
    attempts: base.attempts + 1,
    correctCount: base.correctCount + (a.correct ? 1 : 0),
    lastChoice: a.choice,
    lastCorrect: a.correct,
    lastAt: a.at,
  };
  if (!a.correct) {
    next.wrong = "open";
    next.wrongCount = base.wrongCount + 1;
    next.wrongAt = a.at;
    delete next.fixedAt;
  } else if (!a.peeked && base.wrong === "open") {
    next.wrong = "fixed";
    next.fixedAt = a.at;
  }
  return next;
}

export function hasChoices(draft: Record<string, DraftEntry>): boolean {
  return Object.values(draft).some((d) => d.choice);
}

/** Merge per-question draft patches; later entries win field by field. */
export function mergeDraft(
  base: Record<string, DraftEntry>,
  patch: Record<string, DraftEntry>,
): Record<string, DraftEntry> {
  const out = { ...base };
  for (const [qid, entry] of Object.entries(patch)) out[qid] = { ...out[qid], ...entry };
  return out;
}
