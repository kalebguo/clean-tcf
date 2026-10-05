import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { exportAll, importAll, resetAll } from "../db/backup";
import { db } from "../db/schema";
import { decodeSnapshot, encodeSnapshot, getMeta, localSnapshot, mergeSnapshot, type Snapshot } from "../db/sync";
import { addWord, removeWord } from "../db/vocab";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

/** A snapshot as another device would upload it. */
async function remote(patch: Partial<Snapshot["tables"]>, extra: Partial<Snapshot> = {}): Promise<Snapshot> {
  const empty = await exportAll();
  for (const k of Object.keys(empty.tables) as (keyof Snapshot["tables"])[]) empty.tables[k] = [];
  return { ...empty, epoch: 0, tombstones: [], ...extra, tables: { ...empty.tables, ...patch } };
}

const word = (lemma: string, at: number, mastered = false) => ({ lemma, addedAt: at, updatedAt: at, mastered });

describe("merging a cloud snapshot", () => {
  it("keeps the newer row per key and reports what only this device has", async () => {
    await db.vocab.bulkPut([word("loyer", 10), word("maison", 10)]);
    const r = await remote({ vocab: [word("maison", 20, true), word("avoir", 5)] });
    expect(await mergeSnapshot(r)).toEqual({ localAhead: true }); // "loyer" is only here
    const book = new Map((await db.vocab.toArray()).map((v) => [v.lemma, v]));
    expect([...book.keys()].sort()).toEqual(["avoir", "loyer", "maison"]);
    expect(book.get("maison")?.mastered).toBe(true);
    // the same snapshot plus "loyer": nothing new here any more
    const r2 = await remote({ vocab: [...(r.tables.vocab as object[]), word("loyer", 10)] as never });
    expect(await mergeSnapshot(r2)).toEqual({ localAhead: false });
  });

  it("adds log rows once, whatever their local ids", async () => {
    const a = { qid: "CO-1-01", section: "CO", level: "A1", choice: "A", correct: true, mode: "set", sessionId: "s", answeredAt: 1 };
    await db.attempts.add({ ...a } as never);
    const r = await remote({ attempts: [{ ...a, id: 7 }, { ...a, id: 8, answeredAt: 2 }] as never });
    expect(await mergeSnapshot(r)).toEqual({ localAhead: false });
    await mergeSnapshot(r);
    expect(await db.attempts.count()).toBe(2);
  });

  it("does not bring back a row deleted here, and applies deletions made there", async () => {
    await addWord("loyer");
    await removeWord("loyer"); // deleted here after it was added there
    await db.vocab.put(word("maison", 10));
    const later = Date.now() + 1000;
    const r = await remote({ vocab: [word("loyer", 1), word("maison", 10)] }, { tombstones: [{ id: "vocab|maison", table: "vocab", key: "maison", at: later }] });
    expect(await mergeSnapshot(r)).toEqual({ localAhead: true });
    expect(await db.vocab.count()).toBe(0);
    // a word added again after the deletion stays
    await db.vocab.put(word("maison", later + 1));
    await mergeSnapshot(r);
    expect(await db.vocab.get("maison")).toBeTruthy();
  });

  it("takes a newer epoch as a whole and ignores an older one", async () => {
    await db.vocab.put(word("loyer", 10));
    const wiped = await remote({ vocab: [word("avoir", 1)] }, { epoch: 500 });
    expect(await mergeSnapshot(wiped)).toEqual({ localAhead: false });
    expect((await db.vocab.toArray()).map((v) => v.lemma)).toEqual(["avoir"]);
    expect(await getMeta("epoch", 0)).toBe(500);
    expect(await mergeSnapshot(await remote({ vocab: [word("être", 1)] }, { epoch: 0 }))).toEqual({ localAhead: true });
    expect(await db.vocab.count()).toBe(1);
  });

  it("starts a new epoch when all data is wiped or replaced", async () => {
    await addWord("loyer");
    await removeWord("loyer");
    expect(await db.tombstones.count()).toBe(1);
    await resetAll();
    expect(await db.tombstones.count()).toBe(0);
    const e1 = await getMeta("epoch", 0);
    expect(e1).toBeGreaterThan(0);
    await importAll(await exportAll(), "replace");
    expect(await getMeta("epoch", 0)).toBeGreaterThanOrEqual(e1);
  });

  it("round-trips through the gzip wire format", async () => {
    await db.vocab.put(word("loyer", 10));
    const s = await localSnapshot();
    const bytes = await encodeSnapshot(s);
    expect(bytes[0]).toBe(0x1f); // gzip magic
    expect(await decodeSnapshot(bytes)).toEqual(s);
  });
});
