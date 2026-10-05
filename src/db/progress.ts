import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type { Question, Section } from "../data/types";
import { db, markDeleted, type Favorite, type Highlight, type Note, type QState } from "./schema";

// ---------------------------------------------------------------- wrong book

export async function removeFromWrong(qid: string): Promise<void> {
  await db.qstate.update(qid, { wrong: "none", updatedAt: Date.now() });
}

export async function resetWrong(section: Section | "ALL", which: "open" | "fixed" | "all"): Promise<number> {
  const rows = await db.qstate
    .filter((s) => (section === "ALL" || s.section === section) && s.wrong !== "none" && (which === "all" || s.wrong === which))
    .toArray();
  const now = Date.now();
  await db.qstate.bulkPut(rows.map((r) => ({ ...r, wrong: "none" as const, updatedAt: now })));
  return rows.length;
}

// ---------------------------------------------------------------- favorites & notes

export async function toggleFavorite(q: Question): Promise<boolean> {
  return db.transaction("rw", db.favorites, db.tombstones, async () => {
    if (await db.favorites.get(q.id)) {
      await db.favorites.delete(q.id);
      await markDeleted("favorites", [q.id]);
      return false;
    }
    await db.favorites.put({ qid: q.id, section: q.section, level: q.level, createdAt: Date.now() });
    return true;
  });
}

/** Empty text deletes the note. */
export async function saveNote(q: Question, text: string): Promise<void> {
  await db.transaction("rw", db.notes, db.tombstones, async () => {
    if (!text.trim()) {
      await db.notes.delete(q.id);
      await markDeleted("notes", [q.id]);
      return;
    }
    const prev = await db.notes.get(q.id);
    const now = Date.now();
    await db.notes.put({ qid: q.id, section: q.section, level: q.level, text, createdAt: prev?.createdAt ?? now, updatedAt: now });
  });
}

// ---------------------------------------------------------------- live hooks

function toMap<T extends { qid: string }>(rows: T[] | undefined): Map<string, T> {
  return new Map((rows ?? []).map((r) => [r.qid, r]));
}

export function useQStates(): Map<string, QState> {
  const rows = useLiveQuery(() => db.qstate.toArray(), []);
  return useMemo(() => toMap(rows), [rows]);
}

export function useFavorites(): Map<string, Favorite> {
  const rows = useLiveQuery(() => db.favorites.toArray(), []);
  return useMemo(() => toMap(rows), [rows]);
}

export function useNotes(): Map<string, Note> {
  const rows = useLiveQuery(() => db.notes.toArray(), []);
  return useMemo(() => toMap(rows), [rows]);
}

/** qid → number of highlights */
export function useHighlightCounts(): Map<string, number> {
  const rows = useLiveQuery(() => db.highlights.toArray(), []);
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const h of rows ?? []) m.set(h.qid, (m.get(h.qid) ?? 0) + 1);
    return m;
  }, [rows]);
}

export function useAllHighlights(): Map<string, Highlight[]> {
  const rows = useLiveQuery(() => db.highlights.toArray(), []);
  return useMemo(() => {
    const m = new Map<string, Highlight[]>();
    for (const h of rows ?? []) m.set(h.qid, [...(m.get(h.qid) ?? []), h]);
    return m;
  }, [rows]);
}

/** Counts restricted to questions that exist in the current bank (avoids "200 / 199"). */
export function countDone(qids: string[], states: Map<string, QState>): number {
  let n = 0;
  for (const id of qids) if ((states.get(id)?.attempts ?? 0) > 0) n++;
  return n;
}

export function accuracy(qids: string[], states: Map<string, QState>): number | null {
  let a = 0;
  let c = 0;
  for (const id of qids) {
    const s = states.get(id);
    if (s) {
      a += s.attempts;
      c += s.correctCount;
    }
  }
  return a ? c / a : null;
}
