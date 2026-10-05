import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addListWords, buildQueue, dayEnd, dayStart, fmtInterval, inWordDeck, newCard, nextCard, postponeCard, previewDue, rateCard,
  removeNewListCards, restoreKnownWords, schedule, setWordKnown, syncQuestionCards, syncWordCards,
} from "../db/cards";
import { setMastered } from "../db/vocab";
import { db, type FlashCard } from "../db/schema";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// 2026-10-04 15:00 local
const NOW = new Date(2026, 9, 4, 15, 0, 0).getTime();

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("FSRS scheduling", () => {
  it("keeps a new card in learning on again, and spaces it out on easy", () => {
    const c = newCard("q:CO-1-01", "question", { section: "CO", level: "A1" }, NOW);
    expect(c.state).toBe(0);
    const again = schedule(c, 1, NOW).card;
    expect(again.state).toBe(1);
    expect(again.due - NOW).toBeLessThan(10 * MIN);
    const easy = schedule(c, 4, NOW).card;
    expect(easy.state).toBe(2);
    expect(easy.due - NOW).toBeGreaterThanOrEqual(DAY);
    const p = previewDue(c, NOW);
    expect(p[1] <= p[2] && p[2] <= p[3] && p[3] <= p[4]).toBe(true);
  });

  it("logs each rating with the state the card was in", async () => {
    await db.cards.add(newCard("w:annonce", "word", {}, NOW));
    const c = await rateCard("w:annonce", 3, NOW);
    expect(c?.reps).toBe(1);
    const log = await db.reviewlog.toArray();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ cardId: "w:annonce", rating: 3, state: 0, reviewedAt: NOW });
  });

  it("postpones to the next study day (4:00) without touching the schedule", async () => {
    await db.cards.add(newCard("w:annonce", "word", {}, NOW));
    const c = await postponeCard("w:annonce", NOW);
    expect(c?.due).toBe(new Date(2026, 9, 5, 4, 0, 0).getTime());
    expect(c?.reps).toBe(0);
    expect(await db.reviewlog.count()).toBe(0);
  });

  it("counts the hours before 4:00 as the day before", () => {
    const late = new Date(2026, 9, 5, 1, 30).getTime();
    expect(dayStart(late)).toBe(new Date(2026, 9, 4, 4, 0).getTime());
    expect(dayEnd(late)).toBe(new Date(2026, 9, 5, 4, 0).getTime());
    expect(fmtInterval(30 * 1000)).toBe("<1 分钟");
    expect(fmtInterval(10 * MIN)).toBe("10 分钟");
    expect(fmtInterval(3 * DAY)).toBe("3 天");
  });
});

describe("queue", () => {
  const card = (id: string, state: FlashCard["state"], due: number, addedAt = 0): FlashCard => ({
    ...newCard(id, "question", { section: "CO" }, NOW), state, due, addedAt,
  });

  it("orders learning cards due, then reviews, then new cards, then learning cards early", () => {
    const cards = [
      card("q:new2", 0, NOW, 2), card("q:new1", 0, NOW, 1), card("q:rev", 2, NOW - DAY),
      card("q:learnSoon", 1, NOW + 5 * MIN), card("q:learnNow", 1, NOW - MIN),
      card("q:revTomorrow", 2, NOW + 2 * DAY), card("q:learnLater", 3, NOW + 2 * 60 * MIN),
    ];
    const q = buildQueue(cards, NOW, 1);
    expect(q.fresh.map((c) => c.id)).toEqual(["q:new1"]);
    expect(q.review.map((c) => c.id)).toEqual(["q:rev"]);
    expect(q.later.map((c) => c.id)).toEqual(["q:learnLater"]);
    expect(nextCard(q, NOW)?.id).toBe("q:learnNow");
    const rest = cards.filter((c) => c.id !== "q:learnNow");
    expect(nextCard(buildQueue(rest, NOW, 1), NOW)?.id).toBe("q:rev");
    expect(nextCard(buildQueue(rest.filter((c) => c.id !== "q:rev"), NOW, 1), NOW)?.id).toBe("q:new1");
    expect(nextCard(buildQueue(rest.filter((c) => c.state !== 2), NOW, 0), NOW)?.id).toBe("q:learnSoon");
  });

  it("skips a postponed new card until tomorrow", () => {
    const q = buildQueue([card("q:new", 0, dayEnd(NOW))], NOW, 20);
    expect(q.fresh).toHaveLength(0);
  });
});

describe("deck sync", () => {
  it("adds answered questions and unmastered words once", async () => {
    await db.qstate.bulkPut([
      { qid: "CO-1-01", section: "CO", level: "A1", attempts: 1, correctCount: 1, lastChoice: "A", lastCorrect: true, lastAt: 2, wrong: "none", wrongCount: 0 },
      { qid: "CE-1-01", section: "CE", level: "B1", attempts: 2, correctCount: 0, lastChoice: "B", lastCorrect: false, lastAt: 1, wrong: "open", wrongCount: 2 },
    ]);
    await db.vocab.bulkPut([
      { lemma: "annonce", addedAt: 1, mastered: false },
      { lemma: "maison", addedAt: 2, mastered: true },
    ]);
    expect(await syncQuestionCards(NOW)).toBe(2);
    expect(await syncQuestionCards(NOW)).toBe(0);
    expect(await syncWordCards(() => "A2", NOW)).toBe(1);
    const cards = await db.cards.toArray();
    expect(cards.map((c) => c.id).sort()).toEqual(["q:CE-1-01", "q:CO-1-01", "w:annonce"]);
    expect(cards.find((c) => c.id === "q:CE-1-01")).toMatchObject({ section: "CE", level: "B1", state: 0 });
    expect(cards.find((c) => c.id === "w:annonce")?.level).toBe("A2");
  });
});

describe("graded-list groups and known words", () => {
  it("adds a group once, in order, behind the words of the book", async () => {
    await db.vocab.put({ lemma: "loyer", addedAt: 1, mastered: false });
    await syncWordCards(() => "B1", NOW + 100);
    expect(await addListWords([{ lemma: "être", level: "A1" }, { lemma: "avoir", level: "A1" }, { lemma: "loyer", level: "B1" }], NOW)).toBe(2);
    expect(await addListWords([{ lemma: "être", level: "A1" }], NOW)).toBe(0);
    const cards = await db.cards.toArray();
    expect(cards.find((c) => c.id === "w:être")).toMatchObject({ src: "list", level: "A1", state: 0 });
    // list cards were added earlier, but the book word comes first
    expect(buildQueue(cards, NOW + 200, 50).fresh.map((c) => c.id)).toEqual(["w:loyer", "w:être", "w:avoir"]);
  });

  it("takes known words out of the deck and puts them back, in step with the book", async () => {
    await db.vocab.put({ lemma: "loyer", addedAt: 1, mastered: false });
    await syncWordCards(() => "B1", NOW);
    await addListWords([{ lemma: "être", level: "A1" }], NOW);
    await setWordKnown("loyer", true, NOW);
    await setWordKnown("être", true, NOW);
    let book = new Map((await db.vocab.toArray()).map((v) => [v.lemma, v]));
    expect(book.get("loyer")?.mastered).toBe(true);
    expect((await db.cards.toArray()).filter((c) => inWordDeck(c, book))).toHaveLength(0);
    expect(buildQueue(await db.cards.toArray(), NOW, 50).fresh).toHaveLength(0);
    expect(await restoreKnownWords(NOW)).toBe(2);
    book = new Map((await db.vocab.toArray()).map((v) => [v.lemma, v]));
    expect((await db.cards.toArray()).filter((c) => inWordDeck(c, book))).toHaveLength(2);
    // the switch in the book moves the card too
    await setMastered("loyer", true);
    expect((await db.cards.get("w:loyer"))?.suspended).toBe(true);
  });

  it("undoes a group add only for words never studied", async () => {
    await addListWords([{ lemma: "être", level: "A1" }, { lemma: "avoir", level: "A1" }], NOW);
    await rateCard("w:être", 3, NOW);
    expect(await removeNewListCards()).toBe(1);
    expect((await db.cards.toArray()).map((c) => c.id)).toEqual(["w:être"]);
  });
});
