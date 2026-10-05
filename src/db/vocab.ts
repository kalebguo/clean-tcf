import { useLiveQuery } from "dexie-react-hooks";
import type { DictEntry } from "../data/dict";
import { db, markDeleted, type VocabEntry } from "./schema";

export async function addWord(lemma: string, from?: { qid?: string; context?: string }): Promise<void> {
  const now = Date.now();
  const cur = await db.vocab.get(lemma);
  if (cur) return;
  await db.vocab.put({ lemma, addedAt: now, updatedAt: now, mastered: false, ...from });
}

export async function removeWord(lemma: string): Promise<void> {
  await db.transaction("rw", db.vocab, db.tombstones, async () => {
    await db.vocab.delete(lemma);
    await markDeleted("vocab", [lemma]);
  });
}

/** The word card (if any) follows: a mastered word is out of the flashcard deck. */
export async function setMastered(lemma: string, mastered: boolean): Promise<void> {
  const now = Date.now();
  await db.transaction("rw", db.vocab, db.cards, async () => {
    await db.vocab.update(lemma, { mastered, masteredAt: mastered ? now : undefined, updatedAt: now });
    await db.cards.update("w:" + lemma, { suspended: mastered, updatedAt: now });
  });
}

export async function setNote(lemma: string, note: string): Promise<void> {
  await db.vocab.update(lemma, { note: note.trim() || undefined, updatedAt: Date.now() });
}

/** The vocabulary book, keyed by lemma. */
export function useVocab(): Map<string, VocabEntry> {
  const rows = useLiveQuery(() => db.vocab.toArray(), []);
  return new Map((rows ?? []).map((r) => [r.lemma, r]));
}

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for importing into Anki: one row per saved word, dictionary fields joined with "; ". */
export function vocabCsv(rows: VocabEntry[], byLemma: Map<string, DictEntry>): string {
  const head = ["lemma", "pos", "gender", "ipa", "brief", "zh", "en", "fr", "note", "context", "qid", "added", "mastered"];
  const lines = rows.map((r) => {
    const e = byLemma.get(r.lemma);
    return [
      r.lemma, e?.posLabel, e?.gender, e?.ipa, e?.brief?.join("，"), e?.zh.join("; "), e?.en?.join("; "), e?.fr?.join(" / "),
      r.note, r.context, r.qid, new Date(r.addedAt).toISOString().slice(0, 10), r.mastered ? "yes" : "",
    ].map(csvCell).join(",");
  });
  return [head.join(","), ...lines].join("\n") + "\n";
}
