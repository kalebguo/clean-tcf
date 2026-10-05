import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type { Banks } from "../data/bank";
import type { Section } from "../data/types";
import { scoreExam, type ExamScore } from "../exam/score";
import { db, type Session } from "./schema";

/*
 * An exam is a sessions row with mode "exam" (SPEC §5.H): scope.kind is "mock" or "set",
 * scope.setId the set of a set test. Its score is worked out from the answers, so a
 * corrected answer key also corrects past scores.
 */

export type ExamKind = "mock" | "set";

export function examScopeKey(section: Section, kind: ExamKind, setId?: string): string {
  return kind === "mock" ? `exam:${section}:mock` : `exam:${section}:set:${setId}`;
}

export interface ExamRecord {
  id: string;
  kind: ExamKind;
  setId?: string;
  submittedAt: number;
  elapsedMs: number;
  result: ExamScore;
}

export function toRecord(s: Session, banks: Banks): ExamRecord {
  return {
    id: s.id,
    kind: s.scope.kind === "set" ? "set" : "mock",
    setId: s.scope.setId,
    submittedAt: s.submittedAt ?? s.updatedAt,
    elapsedMs: s.elapsedMs,
    result: scoreExam(s.qids, s.draft, banks.get),
  };
}

/** Submitted exams of a section, oldest first; undefined while loading. */
export function useExamHistory(banks: Banks | null, section: Section): ExamRecord[] | undefined {
  const rows = useLiveQuery(
    () => db.sessions.where("[mode+section+status]").equals(["exam", section, "submitted"]).toArray(),
    [section],
  );
  return useMemo(
    () => (rows && banks ? rows.map((s) => toRecord(s, banks)).sort((a, b) => a.submittedAt - b.submittedAt) : undefined),
    [rows, banks],
  );
}
