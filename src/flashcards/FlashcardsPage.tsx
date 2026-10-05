import { Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell, SessionBar } from "../components/AppShell";
import { EmptyState, Panel, Pick, Seg, StatTiles } from "../components/controls";
import { PARTS } from "../components/parts";
import { useBanks, type Banks } from "../data/bank";
import { canSpeak, useDict, type Dict } from "../data/dict";
import { LEVELS, SECTION_NAME, slugToSection, type Level, type Section } from "../data/types";
import {
  buildQueue, inWordDeck, NEW_CHOICES, newLimitKey, nextCard, removeNewListCards, restoreKnownWords, setWordKnown, syncQuestionCards,
  syncWordCards, useDeckCards, useNewLimit, useTodayLog, type Deck,
} from "../db/cards";
import type { FlashCard } from "../db/schema";
import { getKV, setKV } from "../db/settings";
import { useVocab } from "../db/vocab";
import { Loading, NotFound } from "../pages/common";
import { QuestionFlashcard } from "./QuestionFlashcard";
import { WordFlashcard } from "./WordFlashcard";
import { DEFAULT_MODES, MODE_OF, pickMode, WORD_MODES, type WordMode } from "./wordModes";

const DECKS: { deck: Deck; to: string; label: string }[] = [
  { deck: "CO", to: "/listening/flashcards", label: "听力题" },
  { deck: "CE", to: "/reading/flashcards", label: "阅读题" },
  { deck: "words", to: "/vocab/flashcards", label: "单词" },
];
/** rough seconds per card, for the time estimate (words: from the chosen modes) */
const SECONDS: Record<Section, number> = { CO: 50, CE: 60 };

/** /listening/flashcards, /reading/flashcards, /vocab/flashcards (SPEC §5.G). */
export function FlashcardsRoute() {
  const { section: slug } = useParams();
  const deck: Deck | null = slug === "vocab" ? "words" : slugToSection(slug);
  const banks = useBanks();
  const dict = useDict();
  if (!deck) return <NotFound />;
  if (!banks || (deck === "words" && dict === undefined)) return <Loading />;
  return <Flashcards key={deck} deck={deck} banks={banks} dict={dict ?? null} />;
}

interface Session {
  cards: Map<string, FlashCard>;
  newLeft: number;
  current: string | null;
  reviewed: number;
  again: number;
  known: number;
}

function Flashcards({ deck, banks, dict }: { deck: Deck; banks: Banks; dict: Dict | null }) {
  const vocab = useVocab();
  const navigate = useNavigate();
  const [synced, setSynced] = useState(false);
  const [levels, setLevels] = useState<Set<Level> | null>(null);
  const [modes, setModes] = useState<WordMode[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const cards = useDeckCards(deck);
  const today = useTodayLog(deck);
  const limit = useNewLimit(deck);
  const title = deck === "words" ? "单词闪卡" : `${SECTION_NAME[deck]}题目闪卡`;

  useEffect(() => {
    document.title = `${title} · TCF`;
  }, [title]);

  useEffect(() => {
    const sync = deck === "words" ? syncWordCards((l) => dict?.byLemma.get(l)?.level) : syncQuestionCards();
    void sync.then(() => setSynced(true));
    void getKV<Level[] | null>(`fcLevels:${deck}`, null).then((l) => setLevels(new Set(l ?? LEVELS)));
    // the old single "spelling" switch becomes the spell mode
    void Promise.all([getKV<WordMode[] | null>("fcModes", null), getKV<boolean>("fcSpelling", false)]).then(([m, spell]) =>
      setModes(m?.length ? m : spell ? ["spell"] : DEFAULT_MODES),
    );
  }, [deck, dict]);

  // cards in scope: chosen levels; words still in the book and not mastered
  const levelOf = (c: FlashCard) => (deck === "words" ? dict?.byLemma.get(c.id.slice(2))?.level ?? c.level : c.level);
  const pool = useMemo(
    () =>
      (cards ?? []).filter((c) => {
        if (deck === "words") {
          if (!inWordDeck(c, vocab)) return false;
        } else if (!banks.get(c.id.slice(2))) return false;
        const l = levelOf(c);
        return !levels || !l || levels.has(l);
      }),
    [cards, vocab, levels, deck, banks, dict], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!synced || !cards || !today || !levels || !modes || limit === undefined) return <Loading text="准备卡片…" />;

  const newToday = today.filter((r) => r.state === 0).length;
  const newLeft = Math.max(0, limit - newToday);
  const now = Date.now();
  const q = buildQueue(pool, now, newLeft);
  const dueN = q.learning.length + q.review.length;
  const deckWords = deck === "words";
  const perCard = deckWords ? modes.reduce((n, m) => n + MODE_OF[m].seconds, 0) / modes.length : SECONDS[deck as Section];
  const minutes = Math.max(1, Math.round(((dueN + q.fresh.length) * perCard) / 60));

  const start = () => {
    const map = new Map(pool.map((c) => [c.id, c]));
    const first = nextCard(buildQueue([...map.values()], Date.now(), newLeft), Date.now());
    setSession({ cards: map, newLeft, current: first?.id ?? null, reviewed: 0, again: 0, known: 0 });
  };

  /** A card was rated (or postponed): keep its new state in this session and pick the next one. */
  const done = (before: FlashCard, after: FlashCard | undefined, grade?: number, known = false) => {
    setSession((s) => {
      if (!s) return s;
      const map = new Map(s.cards);
      if (after) map.set(after.id, after);
      else map.delete(before.id);
      const newLeft2 = s.newLeft - (grade && before.state === 0 ? 1 : 0);
      const next = nextCard(buildQueue([...map.values()], Date.now(), newLeft2), Date.now());
      return {
        cards: map, newLeft: newLeft2, current: next?.id ?? null,
        reviewed: s.reviewed + (grade ? 1 : 0), again: s.again + (grade === 1 ? 1 : 0), known: s.known + (known ? 1 : 0),
      };
    });
  };

  const toggleMode = (m: WordMode) => {
    const next = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
    if (!next.length) return;
    setModes(next);
    void setKV("fcModes", next);
  };

  const toggleLevel = (l: Level) => {
    const next = new Set(levels);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    if (!next.size) return;
    setLevels(next);
    void setKV(`fcLevels:${deck}`, [...next]);
  };

  const current = session?.current ? session.cards.get(session.current) : undefined;

  const part = PARTS[deckWords ? "V" : (deck as Section)];
  const back = { to: part.path, label: part.name };
  const LINK = "text-primary hover:underline";

  if (session) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SessionBar back={back} title={title}>
          <Button variant="outline" size="sm" className="mr-1" onClick={() => setSession(null)}>
            结束本场
          </Button>
        </SessionBar>
        <main className="mx-auto w-full max-w-[900px] flex-1 px-4 pt-4 md:pt-5">
          {current ? (
            <>
              <div className="mb-2.5 text-xs text-muted-foreground">
                本场已评分 {session.reviewed} 张 · 剩余到期 {(() => {
                  const sq = buildQueue([...session.cards.values()], Date.now(), session.newLeft);
                  return `${sq.learning.length + sq.review.length} · 新卡 ${sq.fresh.length}`;
                })()}
              </div>
              {current.kind === "question" ? (
                <QuestionFlashcard key={current.id + current.reps + current.due} banks={banks} card={current} onDone={(after, grade) => done(current, after, grade)} />
              ) : (
                <WordFlashcard
                  key={current.id + current.reps + current.due}
                  entry={dict?.byLemma.get(current.id.slice(2))}
                  lemma={current.id.slice(2)}
                  card={current}
                  mode={pickMode(current, dict?.byLemma.get(current.id.slice(2)), modes, canSpeak)}
                  entries={dict?.entries}
                  onDone={(after, grade) => done(current, after, grade)}
                  onKnown={() => void setWordKnown(current.id.slice(2), true).then(() => done(current, undefined, undefined, true))}
                />
              )}
            </>
          ) : (
            <FinishedCard session={session} onAgain={() => setSession(null)} />
          )}
        </main>
      </div>
    );
  }

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        back={back}
        kicker={part.fr}
        kickerClass={part.text}
        title={title}
        actions={
          <Seg<Deck>
            value={deck}
            onChange={(d) => navigate(DECKS.find((x) => x.deck === d)!.to)}
            options={DECKS.map((d) => [d.deck, d.label])}
          />
        }
      />
      <div className="grid gap-4">
        <Panel>
          <StatTiles
            items={[
              [dueN, "今天到期"],
              [q.fresh.length, `新卡（今天还能学 ${newLeft}）`],
              [dueN + q.fresh.length ? `${minutes} 分钟` : "—", "预计用时"],
              [today.length, "今天已评分"],
            ]}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted-foreground">本场范围（不影响排程）</span>
            <div className="flex flex-wrap gap-1.5">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={levels.has(l)}
                  className={cn(
                    "h-7 rounded-full border px-3 text-[13px] transition-colors",
                    levels.has(l) ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                  )}
                  onClick={() => toggleLevel(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {deckWords && (
            <>
              <div className="mt-4 grid gap-2">
                <span className="text-[13px] text-muted-foreground">题型（可多选；新卡先用最简单的一种，复习时轮换）</span>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {WORD_MODES.map((m) => (
                    <button
                      key={m.mode}
                      type="button"
                      aria-pressed={modes.includes(m.mode)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition-colors",
                        modes.includes(m.mode) ? "border-primary bg-primary/10" : "bg-card hover:bg-muted",
                      )}
                      onClick={() => toggleMode(m.mode)}
                    >
                      <div className={cn("text-sm font-semibold", modes.includes(m.mode) && "text-primary")}>
                        {m.label}
                        {m.typed && <span className="ml-1.5 text-xs font-normal text-muted-foreground">要打字</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2.5 text-[13px]">
                <span className="text-muted-foreground">每天新词</span>
                <Pick<string>
                  label="每天新词上限"
                  className="h-8 w-24"
                  value={String(limit)}
                  onChange={(v) => void setKV(newLimitKey("words"), Number(v))}
                  options={NEW_CHOICES.map((n) => [String(n), `${n} 个`])}
                />
                <span className="text-xs text-muted-foreground">和题目闪卡的上限分开算</span>
              </div>
            </>
          )}
          <div className="mt-4 flex justify-end">
            <Button size="lg" disabled={dueN + q.fresh.length === 0} onClick={start}>
              <Play className="fill-current" /> 开始
            </Button>
          </div>
        </Panel>
        <Panel title="牌堆">
          <div className="grid gap-2 text-[13px] leading-relaxed text-muted-foreground">
            <p>
              {deckWords
                ? "牌堆：生词本里没有标「已掌握」的词，加上从分级词表整组加入的词。一个词只有一张卡，不管用哪种题型，评分都记在这张卡上。背面是释义、发音、短语、近义词、变位表和题库例句。卡上点「已掌握」就移出牌堆。"
                : "牌堆：在练习、考试里做过的每道题（不论对错）。选答案后立刻判对错：答错自动记「重来」，今天稍后再出现；答对后自己选「重来 / 困难 / 良好 / 简单」。这里的作答不进错题本。"}{" "}
              排程用 FSRS 算法；每天最多 {limit} 张新卡；答题前按 S 推迟到明天。
            </p>
            <p>
              牌堆共 {pool.length} 张：新卡 {pool.filter((c) => c.state === 0).length} · 学习中 {pool.filter((c) => c.state === 1 || c.state === 3).length} · 复习中{" "}
              {pool.filter((c) => c.state === 2).length}
            </p>
            {deckWords && <WordDeckTools cards={cards} pool={pool} />}
            {pool.length === 0 && (
              <EmptyState>
                {deckWords ? (
                  <>
                    牌堆里还没有词。<Link className={LINK} to="/vocab">去分级词表整组加入</Link>，或在<Link className={LINK} to="/vocab?tab=book">生词本</Link>收词。
                  </>
                ) : (
                  <>
                    还没做过题。<Link className={LINK} to={`/${deck === "CO" ? "listening" : "reading"}/dedupe`}>去练习</Link>
                  </>
                )}
              </EmptyState>
            )}
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}

function FinishedCard({ session, onAgain }: { session: Session; onAgain(): void }) {
  const later = buildQueue([...session.cards.values()], Date.now(), 0).later;
  const wait = later.length ? Math.ceil((later[0].due - Date.now()) / 60000) : 0;
  return (
    <Panel className="text-center">
      <h2 className="mb-2 text-xl font-bold">这一场完成了</h2>
      <p className="text-sm text-muted-foreground">
        评分 {session.reviewed} 张，其中「重来」{session.again} 张。
        {session.known > 0 && ` 标为已掌握 ${session.known} 个词。`}
        {later.length > 0 && ` 还有 ${later.length} 张学习中的卡，最早 ${wait} 分钟后到期。`}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="outline" asChild>
          <Link to="/">回首页</Link>
        </Button>
        <Button onClick={onAgain}>回到牌堆</Button>
      </div>
    </Panel>
  );
}

/** Word deck: where the cards come from, and the two ways back (put known words back, undo a group add). */
function WordDeckTools({ cards, pool }: { cards: FlashCard[]; pool: FlashCard[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const known = cards.filter((c) => c.suspended).length;
  const fromList = pool.filter((c) => c.src === "list").length;
  const unstudied = cards.filter((c) => c.src === "list" && c.state === 0 && c.reps === 0).length;
  const LINK = "text-primary hover:underline";
  return (
    <p>
      来源：生词本 {pool.length - fromList} · 分级词表 {fromList}
      {known > 0 && (
        <>
          {" "}· 已掌握（移出）{known}{" "}
          <button type="button" className={LINK} onClick={() => void restoreKnownWords().then((n) => setMsg(`已放回 ${n} 个词`))}>
            全部放回
          </button>
        </>
      )}
      {unstudied > 0 && (
        <>
          {" "}·{" "}
          <button
            type="button"
            className={LINK}
            onClick={() => {
              if (window.confirm(`把分级词表加入、还没学过的 ${unstudied} 个词移出牌堆？学过的词不受影响。`))
                void removeNewListCards().then((n) => setMsg(`已移出 ${n} 个词`));
            }}
          >
            撤回还没学的词表词（{unstudied}）
          </button>
        </>
      )}
      {msg && <span className="ml-2 text-correct">{msg}</span>}
    </p>
  );
}
