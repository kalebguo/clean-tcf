import { useLiveQuery } from "dexie-react-hooks";
import type { Section } from "../data/types";
import { buildQueue, inWordDeck, useDeckCards, useNewLimit, useTodayLog, type Deck } from "./cards";
import { db } from "./schema";

/** Local calendar day, "2026-10-04". */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysAgo(n: number, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

/** Calendar days from today to a "2026-11-20" date (negative when past). Rounded, so a DST change does not add a day. */
export function daysUntil(date: string, now = Date.now()): number {
  return Math.round((new Date(date + "T00:00").getTime() - daysAgo(0, now)) / 86400000);
}

/**
 * Practice per day over the last `days` days: questions answered (practice and exams)
 * plus flashcard ratings. `section` limits it to one part (its questions and its question cards).
 */
export function useActivity(days: number, section?: Section): Map<string, number> | undefined {
  return useLiveQuery(async () => {
    const from = daysAgo(days - 1);
    const out = new Map<string, number>();
    const add = (ts: number) => out.set(dayKey(ts), (out.get(dayKey(ts)) ?? 0) + 1);
    for (const sec of section ? [section] : (["CO", "CE"] as Section[])) {
      const rows = await db.attempts.where("[section+answeredAt]").between([sec, from], [sec, Infinity]).toArray();
      rows.forEach((r) => add(r.answeredAt));
    }
    const logs = await db.reviewlog.where("reviewedAt").aboveOrEqual(from).toArray();
    for (const l of logs) {
      if (!section || l.cardId.startsWith("q:" + section)) add(l.reviewedAt);
    }
    return out;
  }, [days, section]);
}

/** Consecutive days with practice, ending today (or yesterday if nothing yet today). */
export function streakOf(act: Map<string, number>, now = Date.now()): number {
  let n = 0;
  let i = (act.get(dayKey(now)) ?? 0) > 0 ? 0 : 1;
  while ((act.get(dayKey(daysAgo(i, now))) ?? 0) > 0) {
    n++;
    i++;
  }
  return n;
}

/** Cards to review today and new cards allowed today, as the flashcard page counts them. */
export function useDueCounts(deck: Deck): { due: number; fresh: number } | undefined {
  const cards = useDeckCards(deck);
  const today = useTodayLog(deck);
  const limit = useNewLimit(deck);
  const book = useLiveQuery(async () => (deck === "words" ? new Map((await db.vocab.toArray()).map((v) => [v.lemma, v])) : null), [deck]);
  if (!cards || !today || limit === undefined || book === undefined) return undefined;
  const newLeft = Math.max(0, limit - today.filter((r) => r.state === 0).length);
  const q = buildQueue(book ? cards.filter((c) => inWordDeck(c, book)) : cards, Date.now(), newLeft);
  return { due: q.learning.length + q.review.length, fresh: q.fresh.length };
}
