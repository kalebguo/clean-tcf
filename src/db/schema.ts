import Dexie, { type Table } from "dexie";
import type { Letter, Level, Mode, Section } from "../data/types";

export interface Attempt {
  id?: number;
  qid: string;
  section: Section;
  level: Level;
  choice: Letter;
  correct: boolean;
  peeked: boolean;
  mode: Mode;
  sessionId: string;
  answeredAt: number;
}

export type WrongState = "none" | "open" | "fixed";

export interface QState {
  qid: string;
  section: Section;
  level: Level;
  attempts: number;
  correctCount: number;
  lastChoice: Letter;
  lastCorrect: boolean;
  lastAt: number;
  wrong: WrongState;
  wrongCount: number;
  wrongAt?: number;
  fixedAt?: number;
  /** last change of any kind (an answer, or the wrong book edited), for cloud sync (SPEC §K) */
  updatedAt?: number;
}

export interface Favorite {
  qid: string;
  section: Section;
  level: Level;
  createdAt: number;
}

export interface Note {
  qid: string;
  section: Section;
  level: Level;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export type HighlightField = "transcript" | "passage" | "question" | "option";

export interface Highlight {
  id: string;
  qid: string;
  section: Section;
  level: Level;
  field: HighlightField;
  index: number;
  start: number;
  end: number;
  text: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface DraftEntry {
  choice?: Letter;
  peeked: boolean;
  revealed: boolean;
}

export interface Session {
  id: string;
  mode: Mode;
  section: Section | "ALL";
  scopeKey: string;
  scope: Record<string, string | undefined>;
  qids: string[];
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  currentIndex: number;
  draft: Record<string, DraftEntry>;
  status: "open" | "submitted" | "discarded";
  submittedAt?: number;
}

/** Word saved to the vocabulary book (SPEC-P2 §10). */
export interface VocabEntry {
  lemma: string;
  addedAt: number;
  qid?: string;
  context?: string;
  mastered: boolean;
  masteredAt?: number;
  /** the learner's own note on the word */
  note?: string;
  /** last change, so merging two backups keeps the newer state */
  updatedAt?: number;
}

export type P2FlagKind = "translation" | "analysis" | "evidence" | "answer" | "other";

/** A learner's report of a mistake in AI-generated content, exported for later fixing. */
export interface P2Flag {
  id?: number;
  qid: string;
  kind: P2FlagKind;
  note: string;
  createdAt: number;
}

/**
 * A flashcard (SPEC §5.G) with its FSRS state. "q:<qid>" for a question answered in practice,
 * "w:<lemma>" for a word of the vocabulary book. Dates are epoch milliseconds.
 */
export interface FlashCard {
  id: string;
  kind: "question" | "word";
  /** question cards only */
  section?: Section;
  level?: Level;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 new, 1 learning, 2 review, 3 relearning */
  state: 0 | 1 | 2 | 3;
  lastReview?: number;
  addedAt: number;
  /** word cards: "list" = added as a group from the graded word list, not from the vocabulary book */
  src?: "list";
  /** word cards: marked as known; out of the deck until put back (mirrors `mastered` for book words) */
  suspended?: boolean;
  /** last change (rating or postponing), so merging two backups keeps the newer card */
  updatedAt: number;
}

/** One rating of a flashcard; only ever appended. */
export interface ReviewLogRow {
  id?: number;
  cardId: string;
  /** 1 again, 2 hard, 3 good, 4 easy */
  rating: 1 | 2 | 3 | 4;
  /** card state before this review */
  state: 0 | 1 | 2 | 3;
  reviewedAt: number;
  elapsedDays: number;
  scheduledDays: number;
}

export interface KV {
  key: string;
  value: unknown;
  /** for cloud sync (SPEC §K); rows written before it existed have none */
  updatedAt?: number;
}

/** A row deleted on this device, so a cloud sync does not bring it back from another one (SPEC §K). */
export interface Tombstone {
  /** "<table>|<key>" */
  id: string;
  table: UserTable;
  key: string;
  at: number;
}

/** Cloud sync state of this device; never synced or backed up. */
export interface SyncMeta {
  key: string;
  value: unknown;
}

export class TcfDB extends Dexie {
  attempts!: Table<Attempt, number>;
  qstate!: Table<QState, string>;
  favorites!: Table<Favorite, string>;
  notes!: Table<Note, string>;
  highlights!: Table<Highlight, string>;
  sessions!: Table<Session, string>;
  kv!: Table<KV, string>;
  vocab!: Table<VocabEntry, string>;
  p2flags!: Table<P2Flag, number>;
  cards!: Table<FlashCard, string>;
  reviewlog!: Table<ReviewLogRow, number>;
  tombstones!: Table<Tombstone, string>;
  syncmeta!: Table<SyncMeta, string>;

  constructor(name = "tcf-site") {
    super(name);
    this.version(1).stores({
      attempts: "++id, qid, sessionId, [section+answeredAt]",
      qstate: "qid, [section+level], [section+wrong], wrongAt",
      favorites: "qid, section, createdAt",
      notes: "qid, section, updatedAt",
      highlights: "id, qid, section, updatedAt",
      sessions: "id, scopeKey, status, [mode+section+status]",
      kv: "key",
    });
    // P2: vocabulary book and reports on AI content. `mastered` is a boolean, which
    // IndexedDB cannot index, so it is filtered in memory (a few thousand rows at most).
    this.version(2).stores({
      vocab: "lemma, addedAt",
      p2flags: "++id, qid, createdAt",
    });
    // flashcards (SPEC §5.G); word cards have no section, so they are read through [kind+due]
    this.version(3).stores({
      cards: "id, [kind+due], [kind+section+due], [kind+state]",
      reviewlog: "++id, cardId, reviewedAt",
    });
    // cloud sync (SPEC §K)
    this.version(4).stores({
      tombstones: "id",
      syncmeta: "key",
    });
  }
}

export const db = new TcfDB();

/*
 * A newer version of the site open in another tab wants to upgrade the database.
 * Let open pages save what they hold (e.g. the practice draft), then close this
 * connection so the upgrade can run, and tell the page to ask for a reload.
 * Returning false stops Dexie's default handler, which would close immediately.
 */
const beforeUpgrade = new Set<() => Promise<void>>();

export function onBeforeDbUpgrade(save: () => Promise<void>): () => void {
  beforeUpgrade.add(save);
  return () => beforeUpgrade.delete(save);
}

export const DB_UPGRADED_EVENT = "tcf-db-upgraded";

db.on("versionchange", () => {
  const saved = Promise.allSettled([...beforeUpgrade].map((f) => f()));
  const timeout = new Promise((r) => setTimeout(r, 2000));
  void Promise.race([saved, timeout]).then(() => {
    db.close();
    if (typeof window !== "undefined") window.dispatchEvent(new Event(DB_UPGRADED_EVENT));
  });
  return false;
});

export const USER_TABLES = [
  "attempts", "qstate", "favorites", "notes", "highlights", "sessions", "kv", "vocab", "p2flags", "cards", "reviewlog",
] as const;
export type UserTable = (typeof USER_TABLES)[number];

export function uid(): string {
  return crypto.randomUUID();
}

/** Record deleted rows for cloud sync (SPEC §K). Call it in the transaction that deletes them (scope must include db.tombstones). */
export function markDeleted(table: UserTable, keys: string[], at = Date.now()): Promise<unknown> {
  return db.tombstones.bulkPut(keys.map((key) => ({ id: `${table}|${key}`, table, key, at })));
}
