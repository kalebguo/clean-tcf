import { useLiveQuery } from "dexie-react-hooks";
import type { Question } from "../data/types";
import { db, markDeleted, uid, type Highlight, type HighlightField } from "./schema";

export interface Range {
  start: number;
  end: number;
}

/**
 * Where a stored highlight sits in the current text of its block: at its saved
 * offsets if the text there is unchanged, otherwise at the first occurrence of
 * the saved text (the block may have been corrected); null if it is gone.
 */
export function locate(h: Pick<Highlight, "start" | "end" | "text">, blockText: string): Range | null {
  if (blockText.slice(h.start, h.end) === h.text) return { start: h.start, end: h.end };
  const i = blockText.indexOf(h.text);
  return i >= 0 && h.text ? { start: i, end: i + h.text.length } : null;
}

/** Merge a new range into existing highlights of one block; overlapping ones are absorbed. */
export function planMerge(
  existing: Highlight[],
  range: Range,
  blockText: string,
  note: string,
): { start: number; end: number; note: string; absorbed: Highlight[] } {
  let { start, end } = range;
  const absorbed: Highlight[] = [];
  for (const h of [...existing].sort((a, b) => a.start - b.start)) {
    const r = locate(h, blockText);
    if (r && r.start < end && r.end > start) {
      start = Math.min(start, r.start);
      end = Math.max(end, r.end);
      absorbed.push(h);
    }
  }
  const notes = [...absorbed.map((h) => h.note), note].filter((n) => n.trim());
  return { start, end, note: notes.join("\n"), absorbed };
}

export async function addHighlight(
  q: Question,
  field: HighlightField,
  index: number,
  range: Range,
  blockText: string,
  note = "",
): Promise<string> {
  return db.transaction("rw", db.highlights, db.tombstones, async () => {
    const same = await db.highlights.where("qid").equals(q.id).filter((h) => h.field === field && h.index === index).toArray();
    const m = planMerge(same, range, blockText, note);
    if (m.absorbed.length) {
      await db.highlights.bulkDelete(m.absorbed.map((h) => h.id));
      await markDeleted("highlights", m.absorbed.map((h) => h.id));
    }
    const now = Date.now();
    const h: Highlight = {
      id: uid(), qid: q.id, section: q.section, level: q.level, field, index,
      start: m.start, end: m.end, text: blockText.slice(m.start, m.end), note: m.note,
      createdAt: Math.min(now, ...m.absorbed.map((a) => a.createdAt)), updatedAt: now,
    };
    await db.highlights.add(h);
    return h.id;
  });
}

export async function updateHighlightNote(id: string, note: string): Promise<void> {
  await db.highlights.update(id, { note, updatedAt: Date.now() });
}

export async function deleteHighlight(id: string): Promise<void> {
  await db.transaction("rw", db.highlights, db.tombstones, async () => {
    await db.highlights.delete(id);
    await markDeleted("highlights", [id]);
  });
}

export function useHighlights(qid: string | undefined): Highlight[] {
  return useLiveQuery(() => (qid ? db.highlights.where("qid").equals(qid).toArray() : []), [qid]) ?? [];
}

/** Text of a highlightable block of a question, or undefined if it does not exist. */
export function blockText(q: Question, field: HighlightField, index: number): string | undefined {
  switch (field) {
    case "transcript":
      return q.transcript?.[index];
    case "passage":
      return q.passage?.[index];
    case "question":
      return index === 0 ? q.question : undefined;
    case "option":
      return q.options[index] || undefined;
  }
}
