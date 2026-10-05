import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade, type State } from "ts-fsrs";
import type { Level, Section } from "../data/types";
import { db, markDeleted, type FlashCard, type ReviewLogRow } from "./schema";

/*
 * Flashcards (SPEC §5.G), scheduled by FSRS (ts-fsrs, default parameters, 90 % retention).
 * Question cards: every question answered in practice, per section. Word cards: the
 * vocabulary book minus the words marked as mastered, plus groups added from the graded
 * word list (src "list"). Answers given on a card never reach the attempts table or the wrong book.
 */

export type Deck = Section | "words";
export type { Grade };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

/** New cards per study day, counted per deck. Words have their own, larger limit (settable). */
export const DEFAULT_NEW: Record<Deck, number> = { CO: 20, CE: 20, words: 50 };
export const NEW_CHOICES = [10, 20, 30, 50, 100];
export const newLimitKey = (deck: Deck) => `fcNew:${deck}`;

export function useNewLimit(deck: Deck): number | undefined {
  return useLiveQuery(async () => ((await db.kv.get(newLimitKey(deck)))?.value as number | undefined) ?? DEFAULT_NEW[deck], [deck]);
}
/** learning cards due within this time are shown early when nothing else is left */
const LEARN_AHEAD = 20 * 60 * 1000;

/** A study day starts at 4:00, so a session past midnight still belongs to the evening before. */
export function dayStart(now: number): number {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  d.setHours(4, 0, 0, 0);
  return d.getTime();
}

export function dayEnd(now: number): number {
  const d = new Date(dayStart(now));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function deckOf(cardId: string): Deck {
  return cardId.startsWith("w:") ? "words" : cardId.startsWith("q:CO-") ? "CO" : "CE";
}

// ---------------------------------------------------------------- FSRS bridge

function toFsrs(c: FlashCard): Card {
  return {
    due: new Date(c.due), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays, learning_steps: c.learningSteps, reps: c.reps, lapses: c.lapses,
    state: c.state as State, last_review: c.lastReview ? new Date(c.lastReview) : undefined,
  };
}

function withFsrs(c: FlashCard, card: Card, now: number): FlashCard {
  return {
    ...c, due: card.due.getTime(), stability: card.stability, difficulty: card.difficulty,
    elapsedDays: card.elapsed_days, scheduledDays: card.scheduled_days, learningSteps: card.learning_steps,
    reps: card.reps, lapses: card.lapses, state: card.state as FlashCard["state"],
    lastReview: card.last_review?.getTime(), updatedAt: now,
  };
}

export function newCard(id: string, kind: FlashCard["kind"], extra: { section?: Section; level?: Level }, now: number): FlashCard {
  const base = { id, kind, ...extra, addedAt: now } as FlashCard;
  return withFsrs(base, createEmptyCard(new Date(now)), now);
}

export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
export const GRADE_LABEL: Record<Grade, string> = { 1: "重来", 2: "困难", 3: "良好", 4: "简单" };

/** When the card would be due again after each rating (for the labels on the buttons). */
export function previewDue(c: FlashCard, now: number): Record<Grade, number> {
  const p = scheduler.repeat(toFsrs(c), new Date(now));
  return { 1: p[Rating.Again].card.due.getTime(), 2: p[Rating.Hard].card.due.getTime(), 3: p[Rating.Good].card.due.getTime(), 4: p[Rating.Easy].card.due.getTime() };
}

/** Pure FSRS step, for tests and for rateCard. */
export function schedule(c: FlashCard, grade: Grade, now: number): { card: FlashCard; log: Omit<ReviewLogRow, "id"> } {
  const { card, log } = scheduler.next(toFsrs(c), new Date(now), grade);
  return {
    card: withFsrs(c, card, now),
    log: { cardId: c.id, rating: grade, state: c.state, reviewedAt: now, elapsedDays: log.elapsed_days, scheduledDays: log.scheduled_days },
  };
}

/** "<1 分钟" / "10 分钟" / "3 小时" / "4 天" / "2.5 月" / "1.2 年" */
export function fmtInterval(ms: number): string {
  const min = ms / 60000;
  if (min < 1) return "<1 分钟";
  if (min < 60) return `${Math.round(min)} 分钟`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} 小时`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} 天`;
  if (d < 365) return `${Math.round((d / 30) * 10) / 10} 月`;
  return `${Math.round((d / 365) * 10) / 10} 年`;
}

// ---------------------------------------------------------------- writes

export async function rateCard(id: string, grade: Grade, now = Date.now()): Promise<FlashCard | undefined> {
  return db.transaction("rw", db.cards, db.reviewlog, async () => {
    const c = await db.cards.get(id);
    if (!c) return undefined;
    const r = schedule(c, grade, now);
    await db.cards.put(r.card);
    await db.reviewlog.add(r.log);
    return r.card;
  });
}

/** "Not now": the card comes back tomorrow; its schedule is otherwise untouched. */
export async function postponeCard(id: string, now = Date.now()): Promise<FlashCard | undefined> {
  return db.transaction("rw", db.cards, async () => {
    const c = await db.cards.get(id);
    if (!c) return undefined;
    const next = { ...c, due: dayEnd(now), updatedAt: now };
    await db.cards.put(next);
    return next;
  });
}

/** Questions answered in practice that have no card yet join the deck, oldest first. */
export async function syncQuestionCards(now = Date.now()): Promise<number> {
  return db.transaction("rw", db.qstate, db.cards, async () => {
    const have = new Set(await db.cards.toCollection().primaryKeys());
    const done = (await db.qstate.filter((s) => s.attempts > 0).toArray())
      .filter((s) => !have.has("q:" + s.qid))
      .sort((a, b) => a.lastAt - b.lastAt);
    await db.cards.bulkAdd(done.map((s, i) => newCard("q:" + s.qid, "question", { section: s.section, level: s.level }, now + i)));
    return done.length;
  });
}

/** Words of the vocabulary book not marked as mastered join the deck, in the order they were added. */
export async function syncWordCards(levelOf: (lemma: string) => Level | undefined, now = Date.now()): Promise<number> {
  return db.transaction("rw", db.vocab, db.cards, async () => {
    const have = new Set(await db.cards.toCollection().primaryKeys());
    const words = (await db.vocab.toArray())
      .filter((v) => !v.mastered && !have.has("w:" + v.lemma))
      .sort((a, b) => a.addedAt - b.addedAt);
    await db.cards.bulkAdd(words.map((v, i) => newCard("w:" + v.lemma, "word", { level: levelOf(v.lemma) }, now + i)));
    return words.length;
  });
}

/** A group of the graded word list joins the deck in the given order (most frequent first); words with a card are skipped. */
export async function addListWords(words: { lemma: string; level: Level }[], now = Date.now()): Promise<number> {
  return db.transaction("rw", db.cards, async () => {
    const have = new Set(await db.cards.toCollection().primaryKeys());
    const add = words.filter((w) => !have.has("w:" + w.lemma));
    await db.cards.bulkAdd(add.map((w, i) => ({ ...newCard("w:" + w.lemma, "word", { level: w.level }, now + i), src: "list" as const })));
    return add.length;
  });
}

/** Word cards from the graded list that were never studied leave the deck (undo of a group add). */
export async function removeNewListCards(): Promise<number> {
  return db.transaction("rw", db.cards, db.tombstones, async () => {
    const ids = (await db.cards.filter((c) => c.kind === "word" && c.src === "list" && c.state === 0 && c.reps === 0).primaryKeys()) as string[];
    await db.cards.bulkDelete(ids);
    await markDeleted("cards", ids);
    return ids.length;
  });
}

/** "Known": the card leaves the deck (and a book word is marked as mastered); `false` puts it back. */
export async function setWordKnown(lemma: string, known: boolean, now = Date.now()): Promise<void> {
  await db.transaction("rw", db.cards, db.vocab, async () => {
    await db.cards.update("w:" + lemma, { suspended: known, updatedAt: now });
    if (await db.vocab.get(lemma)) await db.vocab.update(lemma, { mastered: known, masteredAt: known ? now : undefined, updatedAt: now });
  });
}

/** Put every word card marked as known back into the deck (book words too). */
export async function restoreKnownWords(now = Date.now()): Promise<number> {
  const ids = (await db.cards.filter((c) => c.kind === "word" && !!c.suspended).primaryKeys()) as string[];
  for (const id of ids) await setWordKnown(id.slice(2), false, now);
  return ids.length;
}

/** Is this word card in the deck? Book words: while not mastered; list words: always; neither when marked known. */
export function inWordDeck(c: FlashCard, book: Map<string, { mastered: boolean }>): boolean {
  if (c.suspended) return false;
  const v = book.get(c.id.slice(2));
  return v ? !v.mastered : c.src === "list";
}

// ---------------------------------------------------------------- reads

/** Lemmas that have a word card (in the deck or marked as known). */
export function useWordCardIds(): Set<string> | undefined {
  const keys = useLiveQuery(() => db.cards.where("[kind+due]").between(["word", Dexie.minKey], ["word", Dexie.maxKey]).primaryKeys(), []);
  return keys && new Set((keys as string[]).map((k) => k.slice(2)));
}

export function useDeckCards(deck: Deck): FlashCard[] | undefined {
  return useLiveQuery(
    () =>
      deck === "words"
        ? db.cards.where("[kind+due]").between(["word", Dexie.minKey], ["word", Dexie.maxKey]).toArray()
        : db.cards.where("[kind+section+due]").between(["question", deck, Dexie.minKey], ["question", deck, Dexie.maxKey]).toArray(),
    [deck],
  );
}

/** Ratings given today (since 4:00) on cards of this deck. */
export function useTodayLog(deck: Deck): ReviewLogRow[] | undefined {
  return useLiveQuery(
    async () => (await db.reviewlog.where("reviewedAt").aboveOrEqual(dayStart(Date.now())).toArray()).filter((r) => deckOf(r.cardId) === deck),
    [deck],
  );
}

// ---------------------------------------------------------------- the queue

export interface Queue {
  /** learning / relearning cards due now or within LEARN_AHEAD */
  learning: FlashCard[];
  /** review cards due today */
  review: FlashCard[];
  /** new cards allowed today */
  fresh: FlashCard[];
  /** learning cards due later today */
  later: FlashCard[];
}

export function buildQueue(all: FlashCard[], now: number, newLeft: number): Queue {
  const end = dayEnd(now);
  const cards = all.filter((c) => !c.suspended);
  const fromList = (c: FlashCard) => (c.src === "list" ? 1 : 0);
  const byDue = (a: FlashCard, b: FlashCard) => a.due - b.due;
  const learning = (c: FlashCard) => c.state === 1 || c.state === 3;
  return {
    learning: cards.filter((c) => learning(c) && c.due <= now + LEARN_AHEAD).sort(byDue),
    review: cards.filter((c) => c.state === 2 && c.due < end).sort(byDue),
    fresh: cards
      .filter((c) => c.state === 0 && c.due < end)
      .sort((a, b) => fromList(a) - fromList(b) || a.addedAt - b.addedAt)
      .slice(0, Math.max(0, newLeft)),
    later: cards.filter((c) => learning(c) && c.due > now + LEARN_AHEAD && c.due < end).sort(byDue),
  };
}

/** Learning cards that are due, then reviews, then new cards (own words before list groups), then learning cards a little early. */
export function nextCard(q: Queue, now: number): FlashCard | undefined {
  return q.learning.find((c) => c.due <= now) ?? q.review[0] ?? q.fresh[0] ?? q.learning[0];
}
