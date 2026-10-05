import { existsSync } from "node:fs";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { dayKey, daysAgo, daysUntil, streakOf } from "../db/activity";
import { exportAll, importAll, validateBackup } from "../db/backup";
import { locate, planMerge } from "../db/highlights";
import { db, type Highlight } from "../db/schema";
import { displayLetter, optionOrder, originalLetter } from "../practice/shuffle";

describe("option shuffle", () => {
  it("is a stable permutation and maps letters both ways", () => {
    const o = optionOrder("seed", "CO-1-11", true);
    expect([...o].sort()).toEqual([0, 1, 2, 3]);
    expect(optionOrder("seed", "CO-1-11", true)).toEqual(o);
    for (let pos = 0; pos < 4; pos++) expect(displayLetter(o, originalLetter(o, pos))).toBe("ABCD"[pos]);
    expect(optionOrder("seed", "x", false)).toEqual([0, 1, 2, 3]);
  });
});

const hl = (id: string, start: number, end: number, text: string, note = ""): Highlight => ({
  id, qid: "q", section: "CE", level: "A1", field: "passage", index: 0, start, end, text, note, createdAt: 1, updatedAt: 1,
});

describe("highlights", () => {
  const text = "Nous installerons des tables-rondes pour le midi.";
  it("relocates after the text changed", () => {
    expect(locate(hl("a", 5, 17, "installerons"), text)).toEqual({ start: 5, end: 17 });
    expect(locate(hl("a", 0, 12, "installerons"), text)).toEqual({ start: 5, end: 17 });
    expect(locate(hl("a", 0, 5, "absent"), text)).toBeNull();
  });
  it("merges overlapping ranges and their notes", () => {
    const m = planMerge([hl("a", 5, 17, "installerons", "verbe"), hl("b", 40, 44, "midi")], { start: 14, end: 35 }, text, "repas");
    expect(m).toMatchObject({ start: 5, end: 35, note: "verbe\nrepas" });
    expect(m.absorbed.map((h) => h.id)).toEqual(["a"]);
  });
});

describe("backup", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  it("round-trips and merges idempotently", async () => {
    await db.favorites.put({ qid: "CO-1-01", section: "CO", level: "A1", createdAt: 1 });
    await db.attempts.add({ qid: "CO-1-01", section: "CO", level: "A1", choice: "A", correct: true, peeked: false, mode: "dedupe", sessionId: "s", answeredAt: 10 });
    const b = await exportAll();
    expect(validateBackup(b)).toBeNull();
    await importAll(b, "merge");
    await importAll(b, "merge");
    expect(await db.attempts.count()).toBe(1);
    await Promise.all(db.tables.map((t) => t.clear()));
    await importAll(b, "replace");
    expect(await db.favorites.count()).toBe(1);
  });
  it("imports schema 1 backups (before P2) and de-duplicates reports", async () => {
    const old = { app: "tcf-site", schema: 1, exportedAt: 1, tables: { favorites: [{ qid: "CE-1-01", section: "CE", level: "A1", createdAt: 1 }] } };
    expect(validateBackup(old)).toBeNull();
    await importAll(old as never, "merge");
    expect(await db.favorites.count()).toBe(1);
    await db.p2flags.add({ qid: "CE-1-01", kind: "analysis", note: "x", createdAt: 5 });
    await db.vocab.put({ lemma: "annonce", addedAt: 3, mastered: false });
    const b = await exportAll();
    expect(b.schema).toBe(3);
    await importAll(b, "merge");
    expect(await db.p2flags.count()).toBe(1);
    expect(await db.vocab.count()).toBe(1);
    expect(validateBackup({ ...b, schema: 2 })).toBeNull();
    expect(validateBackup({ ...b, schema: 4 })).toMatch(/不兼容/);
  });
  it("rejects foreign files", () => {
    expect(validateBackup({ app: "other" })).toMatch(/不是本网站/);
    expect(validateBackup({ app: "tcf-site", schema: 1, tables: { qstate: [{}] } })).toMatch(/qid/);
  });
});

describe("activity dates", () => {
  it("counts calendar days to the exam across a DST change", () => {
    const tz = process.env.TZ;
    process.env.TZ = "America/Toronto"; // DST ends on 1 Nov 2026
    try {
      const now = new Date(2026, 9, 4, 21, 0).getTime();
      expect(daysUntil("2026-11-20", now)).toBe(47);
      expect(daysUntil("2026-10-04", now)).toBe(0);
      expect(daysUntil("2026-10-01", now)).toBe(-3);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it("counts the streak back from today, or from yesterday before today's first practice", () => {
    const now = new Date(2026, 9, 4, 12, 0).getTime();
    const day = (n: number) => dayKey(daysAgo(n, now));
    expect(streakOf(new Map([[day(0), 3], [day(1), 1], [day(2), 5], [day(4), 2]]), now)).toBe(3);
    expect(streakOf(new Map([[day(1), 1], [day(2), 5]]), now)).toBe(2);
    expect(streakOf(new Map([[day(2), 5]]), now)).toBe(0);
  });
});

describe("speaking / writing topics", () => {
  // the labelling script and its guide are not in the public repo
  it.runIf(existsSync("scripts/oral_writing/labels.py"))("the site and the labelling script use the same category ids", async () => {
    const { readFileSync } = await import("node:fs");
    const { TOPICS } = await import("../oral/data");
    const py = readFileSync("scripts/oral_writing/labels.py", "utf8").match(/^CATS = \[(.*)\]$/m)![1];
    expect(TOPICS.map((t) => t.id)).toEqual([...py.matchAll(/"(\w+)"/g)].map((m) => m[1]));
    const guide = readFileSync("data/oral-writing/LABEL_GUIDE.md", "utf8");
    for (const t of TOPICS) expect(guide).toContain(`| \`${t.id}\` | ${t.zh} |`);
  });
});
