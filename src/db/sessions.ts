import type { Mode, Question, Section } from "../data/types";
import { applyAttempt, mergeDraft } from "./rules";
import { db, uid, type DraftEntry, type Session } from "./schema";

export async function findOpenSession(scopeKey: string): Promise<Session | undefined> {
  const open = await db.sessions.where("scopeKey").equals(scopeKey).filter((s) => s.status === "open").toArray();
  return open.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function createSession(init: {
  mode: Mode;
  section: Section | "ALL";
  scopeKey: string;
  scope?: Session["scope"];
  qids: string[];
  currentIndex?: number;
}): Promise<Session> {
  const now = Date.now();
  const s: Session = {
    id: uid(),
    mode: init.mode,
    section: init.section,
    scopeKey: init.scopeKey,
    scope: init.scope ?? {},
    qids: init.qids,
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    currentIndex: init.currentIndex ?? 0,
    draft: {},
    status: "open",
  };
  await db.sessions.add(s);
  return s;
}

export interface DraftPatch {
  entries?: Record<string, DraftEntry>;
  currentIndex?: number;
  elapsedMs?: number;
  qids?: string[];
}

/**
 * Write draft changes. Entries are merged per question, so two tabs on the same
 * session do not erase each other's answers. Returns false (and writes nothing)
 * when the session is no longer open — a stale tab must not revive or alter a
 * submitted / discarded round.
 */
export async function saveDraft(id: string, patch: DraftPatch): Promise<boolean> {
  return db.transaction("rw", db.sessions, async () => {
    const s = await db.sessions.get(id);
    if (!s || s.status !== "open") return false;
    const next: Session = { ...s, updatedAt: Date.now() };
    if (patch.entries) next.draft = mergeDraft(s.draft, patch.entries);
    if (patch.currentIndex !== undefined) next.currentIndex = patch.currentIndex;
    if (patch.elapsedMs !== undefined) next.elapsedMs = Math.max(s.elapsedMs, patch.elapsedMs);
    if (patch.qids) next.qids = patch.qids;
    await db.sessions.put(next);
    return true;
  });
}

export async function discardSession(id: string): Promise<void> {
  await db.sessions.update(id, { status: "discarded", updatedAt: Date.now() });
}

export interface SubmitResult {
  sessionId: string;
  alreadySubmitted: boolean;
  answered: number;
  correct: number;
  newCount: number;
  redoCount: number;
  wrongQids: string[];
  fixedQids: string[];
  elapsedMs: number;
}

/**
 * Commit a round: one attempt per answered question, qstate updated by the
 * wrong-book rules, session marked submitted — all in one transaction, so a
 * double click or a second tab can only ever commit once.
 */
export async function submitSession(
  id: string,
  lookup: (qid: string) => Question | undefined,
  finalPatch?: DraftPatch,
): Promise<SubmitResult> {
  return db.transaction("rw", db.sessions, db.attempts, db.qstate, async () => {
    const s = await db.sessions.get(id);
    const empty: SubmitResult = {
      sessionId: id, alreadySubmitted: true, answered: 0, correct: 0, newCount: 0,
      redoCount: 0, wrongQids: [], fixedQids: [], elapsedMs: s?.elapsedMs ?? 0,
    };
    if (!s || s.status !== "open") return empty;
    const draft = finalPatch?.entries ? mergeDraft(s.draft, finalPatch.entries) : s.draft;
    const elapsedMs = Math.max(s.elapsedMs, finalPatch?.elapsedMs ?? 0);
    const now = Date.now();
    const res: SubmitResult = { ...empty, alreadySubmitted: false, elapsedMs };
    for (const qid of s.qids) {
      const d = draft[qid];
      const q = lookup(qid);
      if (!d?.choice || !q) continue; // unanswered, or no longer in the bank
      const prev = await db.qstate.get(qid);
      const correct = d.choice === q.answer;
      await db.attempts.add({
        qid, section: q.section, level: q.level, choice: d.choice, correct,
        peeked: d.peeked, mode: s.mode, sessionId: s.id, answeredAt: now,
      });
      const next = applyAttempt(prev, {
        qid, section: q.section, level: q.level, choice: d.choice, correct, peeked: d.peeked, at: now,
      });
      await db.qstate.put({ ...next, updatedAt: now });
      res.answered++;
      if (correct) res.correct++;
      else res.wrongQids.push(qid);
      if (prev?.wrong === "open" && next.wrong === "fixed") res.fixedQids.push(qid);
      if (!prev || prev.attempts === 0) res.newCount++;
      else res.redoCount++;
    }
    await db.sessions.put({ ...s, draft, elapsedMs, status: "submitted", submittedAt: now, updatedAt: now });
    return res;
  });
}
