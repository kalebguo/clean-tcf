import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Lightbulb } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SessionBar } from "../components/AppShell";
import { Banner, EmptyState } from "../components/controls";
import { Modal, ModalActions } from "../components/Modal";
import type { Banks } from "../data/bank";
import { useP2 } from "../data/p2";
import type { Letter, Level, Mode, Section } from "../data/types";
import { addHighlight, blockText, useHighlights } from "../db/highlights";
import { toggleFavorite, useFavorites, useHighlightCounts, useNotes, useQStates } from "../db/progress";
import { hasChoices } from "../db/rules";
import { db, onBeforeDbUpgrade, type DraftEntry, type Session } from "../db/schema";
import { createSession, discardSession, findOpenSession, saveDraft, submitSession, type SubmitResult } from "../db/sessions";
import { useSettings, type Settings } from "../db/settings";
import type { AudioHandle } from "./AudioBar";
import { contextOf, DictBubble, prevWordOf, type DictQuery } from "./DictBubble";
import { HighlightBubble } from "./HighlightBubble";
import { QuestionView } from "./QuestionView";
import { readSelection, type BlockSelection } from "./selection";
import { SessionSummary } from "./SessionSummary";
import { optionOrder, originalLetter } from "./shuffle";
import { Sidebar, type Cell, type CellStatus, type Filter, type Group } from "./Sidebar";
import { useShortcuts } from "./useShortcuts";

export interface PracticeProps {
  banks: Banks;
  mode: Mode;
  section: Section | "ALL";
  scopeKey: string;
  scope?: Record<string, string | undefined>;
  /** sidebar title, e.g. "去重题库 - 听力" */
  title: string;
  /** used in the browser tab title, e.g. "听力去重练习" */
  pageTitle: string;
  /** question list when a new round starts */
  qids: string[];
  levelTabs?: boolean;
  initialLevel?: Level;
  onLevelChange?(l: Level): void;
  startQid?: string;
  /** filter-based modes (wrong book, favorites): current matching list, merged in on resume */
  refresh?: () => Promise<string[]>;
  back: { to: string; label?: string };
  wrongLink?: string;
  /** called when the current question changes (review mode remembers its place) */
  onCurrentChange?(qid: string): void;
}

const EMPTY: DraftEntry = { peeked: false, revealed: false };

export function PracticePage(props: PracticeProps) {
  const { banks, mode, levelTabs } = props;
  // review: the whole bank with answers and analysis shown; no session, nothing recorded
  const review = mode === "review";
  const navigate = useNavigate();
  const [settings, setSettings] = useSettings();
  const states = useQStates();
  const favorites = useFavorites();
  const notes = useNotes();
  const hlCounts = useHighlightCounts();

  const [session, setSession] = useState<Session | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<Session | null>(null);
  const [qids, setQids] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState<Level>(props.initialLevel ?? "A1");
  const [filter, setFilter] = useState<Filter>("all");
  const [showAnalysis, setShowAnalysis] = useState(review);
  /** review mode: questions whose answer the learner hid again */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [noteOpen, setNoteOpen] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [selTool, setSelTool] = useState<{ blocks: BlockSelection[]; rect: DOMRect } | null>(null);
  const [dictQuery, setDictQuery] = useState<DictQuery | null>(null);
  const [summary, setSummary] = useState<SubmitResult | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900);

  const audio = useRef<AudioHandle>(null);
  const container = useRef<HTMLDivElement>(null);
  const pending = useRef<Record<string, DraftEntry>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ current, elapsed, qids, session });
  latest.current = { current, elapsed, qids, session };

  const q = current ? banks.get(current) : undefined;
  const entry = (current && draft[current]) || EMPTY;
  const valid = useCallback((ids: string[]) => ids.filter((id) => banks.get(id)), [banks]);

  // the session row, watched so a round submitted in another tab is noticed here
  const live = useLiveQuery(() => (session ? db.sessions.get(session.id) : undefined), [session?.id]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const stale = Boolean(live && live.status !== "open" && !summary && !reviewOnly && saveState !== "saving" && saveState !== "saved");

  // ------------------------------------------------------------ session lifecycle

  const adopt = useCallback(
    (s: Session, resumed: boolean) => {
      const ids = s.qids;
      setSession(s);
      setQids(ids);
      setDraft(s.draft);
      setElapsed(s.elapsedMs);
      setSummary(null);
      setReviewOnly(false);
      setSaveState("idle");
      pending.current = {};
      let cur: string | undefined;
      if (props.startQid && ids.includes(props.startQid)) cur = props.startQid;
      else if (resumed) cur = ids[Math.min(Math.max(0, s.currentIndex), ids.length - 1)];
      else if (levelTabs) cur = ids.find((id) => banks.get(id)?.level === (props.initialLevel ?? "A1"));
      cur ??= ids[0];
      setCurrent(cur ?? null);
      if (levelTabs && cur) setLevel(banks.get(cur)!.level);
    },
    [banks, levelTabs, props.startQid, props.initialLevel],
  );

  const startNew = useCallback(async () => {
    const ids = valid(props.refresh ? await props.refresh() : props.qids);
    const s = await createSession({
      mode, section: props.section, scopeKey: props.scopeKey, scope: props.scope, qids: ids,
      currentIndex: props.startQid ? Math.max(0, ids.indexOf(props.startQid)) : 0,
    });
    adopt(s, false);
    setShown(new Set());
  }, [adopt, mode, props, valid]);

  useEffect(() => {
    if (review) {
      const ids = valid(props.qids);
      const level0 = props.initialLevel ?? "A1";
      const cur = (props.startQid && ids.includes(props.startQid) ? props.startQid : undefined)
        ?? ids.find((id) => banks.get(id)?.level === level0) ?? ids[0];
      setQids(ids);
      setCurrent(cur ?? null);
      if (levelTabs && cur) setLevel(banks.get(cur)!.level);
      return;
    }
    let cancelled = false;
    (async () => {
      const existing = await findOpenSession(props.scopeKey);
      if (cancelled) return;
      if (existing && hasChoices(existing.draft)) return setResumeCandidate(existing);
      if (existing) await discardSession(existing.id);
      if (!cancelled) await startNew();
    })();
    return () => {
      cancelled = true;
    };
  }, [props.scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const resume = async () => {
    const s = resumeCandidate!;
    let ids = valid(s.qids); // drop questions removed from the bank since
    if (props.refresh) {
      const extra = valid(await props.refresh()).filter((id) => !ids.includes(id));
      ids = [...ids, ...extra]; // new wrong items / favorites join this round
    }
    if (ids.join() !== s.qids.join()) await saveDraft(s.id, { qids: ids });
    setResumeCandidate(null);
    adopt({ ...s, qids: ids }, true);
  };

  const discard = async () => {
    await discardSession(resumeCandidate!.id);
    setResumeCandidate(null);
    await startNew();
  };

  // ------------------------------------------------------------ draft persistence

  const flush = useCallback(async () => {
    clearTimeout(flushTimer.current);
    const { session: s, current: cur, elapsed: el, qids: ids } = latest.current;
    if (!s) return;
    const entries = pending.current;
    pending.current = {};
    await saveDraft(s.id, { entries, currentIndex: cur ? ids.indexOf(cur) : 0, elapsedMs: el });
  }, []);

  const scheduleSave = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), 500);
  }, [flush]);

  // a newer version of the site upgrading the database closes this page's connection: save first
  useEffect(() => onBeforeDbUpgrade(flush), [flush]);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    const t = setInterval(() => void flush(), 15000);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      clearInterval(t);
      void flush();
    };
  }, [flush]);

  const updateEntry = (qid: string, patch: Partial<DraftEntry>) => {
    setDraft((d) => {
      const next = { ...EMPTY, ...d[qid], ...patch };
      pending.current[qid] = next;
      return { ...d, [qid]: next };
    });
    scheduleSave();
  };

  // ------------------------------------------------------------ timer

  const running = Boolean(session) && !reviewOnly && !summary && !stale && !resumeCandidate;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setElapsed((e) => e + 1000);
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  // ------------------------------------------------------------ lists & navigation

  const isDone = useCallback((id: string) => (states.get(id)?.attempts ?? 0) > 0, [states]);
  const passes = useCallback(
    (f: Filter, id: string) => {
      const st = states.get(id);
      if (f === "todo") return !st?.attempts;
      if (f === "done") return (st?.attempts ?? 0) > 0;
      if (f === "wrong") return st?.wrong === "open";
      if (f === "right") return Boolean(st?.attempts && st.lastCorrect);
      return true;
    },
    [states],
  );
  const levelQids = useMemo(
    () => (levelTabs ? qids.filter((id) => banks.get(id)?.level === level) : qids),
    [qids, level, levelTabs, banks],
  );
  const visible = useMemo(() => levelQids.filter((id) => passes(filter, id)), [levelQids, filter, passes]);

  const select = useCallback(
    (qid: string) => {
      setCurrent(qid);
      setShowAnalysis(review);
      setBubble(null);
      setSelTool(null);
      setDictQuery(null);
      const lq = banks.get(qid);
      if (levelTabs && lq) setLevel(lq.level);
      scheduleSave();
    },
    [banks, levelTabs, scheduleSave, review],
  );

  const onCurrentChange = props.onCurrentChange;
  useEffect(() => {
    if (current) onCurrentChange?.(current);
  }, [current, onCurrentChange]);

  const goto = (delta: 1 | -1) => {
    if (!current) return;
    const i = visible.indexOf(current);
    if (i >= 0) {
      const j = i + delta;
      if (j >= 0 && j < visible.length) select(visible[j]);
      return;
    }
    const pos = levelQids.indexOf(current);
    const cand = delta > 0 ? visible.find((id) => levelQids.indexOf(id) > pos) : [...visible].reverse().find((id) => levelQids.indexOf(id) < pos);
    if (cand) select(cand);
  };
  const nav = useRef(goto);
  nav.current = goto;

  // P2 content of the current question; the two before and after are prefetched
  const neighbours = useMemo(() => {
    const i = current ? visible.indexOf(current) : -1;
    return i < 0 ? [] : visible.slice(Math.max(0, i - 2), i + 3).filter((id) => id !== current);
  }, [visible, current]);
  const p2 = useP2(q, neighbours);
  const setLang = (l: Settings["p2Lang"]) => {
    if (!q || !p2?.segments?.length) return;
    setSettings(q.section === "CE" ? { p2Lang: l, readingView: "text" } : { p2Lang: l });
  };

  const changeLevel = (l: Level) => {
    setLevel(l);
    props.onLevelChange?.(l);
    const inLevel = qids.filter((id) => banks.get(id)?.level === l);
    const first = inLevel.find((id) => passes(filter, id)) ?? inLevel[0];
    if (first) select(first);
  };

  // ------------------------------------------------------------ answering

  const order = useMemo(
    () => (q && session ? optionOrder(session.id, q.id, settings.shuffle && !(q.section === "CO" && q.options.every((o) => !o))) : [0, 1, 2, 3]),
    [q, session, settings.shuffle],
  );
  const locked = review ? false : reviewOnly || stale || !session;
  const answerShown = q ? (review ? !hidden.has(q.id) : entry.revealed || reviewOnly) : false;

  const choose = (orig: Letter) => {
    if (!q || locked) return;
    const newChoice = entry.choice === orig ? undefined : orig;
    updateEntry(q.id, { choice: newChoice, peeked: entry.peeked || entry.revealed });
    if (newChoice && newChoice === q.answer && settings.instantJudge && settings.autoNext) setTimeout(() => nav.current(1), 600);
  };

  const chooseAndNext = (orig: Letter) => {
    if (!q || locked) return;
    if (entry.choice !== orig) updateEntry(q.id, { choice: orig, peeked: entry.peeked || entry.revealed });
    setTimeout(() => nav.current(1), 150);
  };

  const setRevealed = (on: boolean) => {
    if (!q) return;
    if (review) {
      setHidden((h) => {
        const next = new Set(h);
        if (on) next.delete(q.id);
        else next.add(q.id);
        return next;
      });
      return;
    }
    if (locked) return;
    updateEntry(q.id, { revealed: on, peeked: entry.peeked || (on && !entry.choice) });
    if (on) setShown((s) => new Set(s).add(q.id));
  };

  const toggleAnalysis = () => {
    if (!showAnalysis) setRevealed(true);
    setShowAnalysis(!showAnalysis);
  };

  // ------------------------------------------------------------ submit

  const answeredCount = useMemo(() => qids.filter((id) => draft[id]?.choice).length, [qids, draft]);

  const submit = async () => {
    if (!session || saveState === "saving") return;
    if (answeredCount === 0) {
      window.alert("本轮还没有作答，选择答案后再提交。");
      return;
    }
    setSaveState("saving");
    try {
      clearTimeout(flushTimer.current);
      const entries = pending.current;
      pending.current = {};
      const r = await submitSession(session.id, banks.get, { entries, elapsedMs: latest.current.elapsed });
      setSaveState("saved");
      setSummary(r);
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  };

  // ------------------------------------------------------------ highlights

  const highlights = useHighlights(q?.id);

  const createHighlights = async (blocks: BlockSelection[], withNote: boolean) => {
    if (!q) return;
    let first: string | null = null;
    for (const b of blocks) {
      const text = blockText(q, b.field, b.index);
      if (!text) continue;
      const id = await addHighlight(q, b.field, b.index, { start: b.start, end: b.end }, text);
      first ??= id;
    }
    window.getSelection()?.removeAllRanges();
    setSelTool(null);
    if (withNote && first) setBubble(first);
  };

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onUp = (e: MouseEvent) => {
      if (e.detail > 1) return; // a double click selects a word to look up, not to highlight
      setTimeout(() => {
        const sel = readSelection(el);
        if (!sel) return setSelTool(null);
        if (settings.quickHighlight) void createHighlights(sel.blocks, false);
        else setSelTool(sel);
      }, 0);
    };
    // double click on a word of the original text: bubble dictionary
    const onDbl = (e: MouseEvent) => {
      const t = e.target as Element;
      const sel = window.getSelection();
      const word = sel?.toString().trim();
      if (!q || !word || /\s/.test(word) || !t.closest?.("[data-hl-block]") || !sel?.rangeCount) return;
      setSelTool(null);
      setDictQuery({ text: word, multi: false, rect: sel.getRangeAt(0).getBoundingClientRect(), qid: q.id, context: contextOf(sel), prev: prevWordOf(sel) });
    };
    el.addEventListener("mouseup", onUp);
    el.addEventListener("dblclick", onDbl);
    return () => {
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("dblclick", onDbl);
    };
  });

  const lookUpSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!q || !text || !selTool) return;
    setDictQuery({ text, multi: true, rect: selTool.rect, qid: q.id, context: contextOf(sel) });
    setSelTool(null);
  };

  // ------------------------------------------------------------ shortcuts

  const closeDict = useCallback(() => setDictQuery(null), []);

  const pickDisplay = (pos: number) => q && choose(originalLetter(order, pos));
  useShortcuts(
    {
      " ": () => audio.current?.toggle(),
      s: () => audio.current?.replay(),
      "-": () => audio.current?.seek(-3),
      "+": () => audio.current?.seek(3),
      "=": () => audio.current?.seek(3),
      a: () => pickDisplay(0), b: () => pickDisplay(1), c: () => pickDisplay(2), d: () => pickDisplay(3),
      "1": () => pickDisplay(0), "2": () => pickDisplay(1), "3": () => pickDisplay(2), "4": () => pickDisplay(3),
      enter: () => goto(1),
      arrowright: () => goto(1),
      backspace: () => goto(-1),
      arrowleft: () => goto(-1),
      t: () => setRevealed(!answerShown),
      r: toggleAnalysis,
      f: () => q && void toggleFavorite(q),
      n: () => setNoteOpen((o) => !o),
      q: () => setLang("fr"),
      w: () => setLang("zh"),
      e: () => setLang("en"),
      h: () => {
        const sel = container.current && readSelection(container.current);
        if (sel) void createHighlights(sel.blocks, false);
      },
    },
    settings.shortcuts && !summary && !resumeCandidate && !bubble,
  );

  // ------------------------------------------------------------ browser tab title

  const no = q ? (levelTabs ? q.bankNo : qids.indexOf(q.id) + 1) : 0;
  useEffect(() => {
    document.title = q ? `第 ${no} 题 · ${q.level} · ${props.pageTitle} · TCF` : `${props.pageTitle} · TCF`;
  }, [q, no, props.pageTitle]);

  // ------------------------------------------------------------ sidebar model

  const judged = (id: string) => settings.instantJudge || reviewOnly || review || draft[id]?.revealed;
  const cellOf = (id: string, n: number): Cell => {
    const d = draft[id];
    const cq = banks.get(id)!;
    const st = states.get(id);
    let status: CellStatus = isDone(id) ? "done" : "todo";
    if (review && st?.attempts) status = st.wrong === "open" ? "wrong" : st.lastCorrect ? "right" : "done";
    if (d?.choice) status = judged(id) ? (d.choice === cq.answer ? "right" : "wrong") : "selected";
    return { qid: id, no: n, status, current: id === current, fav: favorites.has(id), noted: notes.has(id) || (hlCounts.get(id) ?? 0) > 0 };
  };
  const groups: Group[] = levelTabs
    ? (["main", "extra"] as const).map((src) => {
        const all = levelQids.filter((id) => banks.get(id)!.source === src);
        return {
          title: src === "main" ? "真题题库" : "补充题库",
          cells: visible.filter((id) => banks.get(id)!.source === src).map((id) => cellOf(id, banks.get(id)!.bankNo)),
          doneCount: all.filter(isDone).length,
        };
      }).filter((g) => g.cells.length || g.title === "真题题库")
    : [{ title: "", cells: visible.map((id) => cellOf(id, qids.indexOf(id) + 1)), doneCount: levelQids.filter(isDone).length }];

  const doneN = levelQids.filter(isDone).length;
  const filters: { key: Filter; label: string; count: number }[] = review
    ? [
        { key: "all", label: "全部", count: levelQids.length },
        { key: "wrong", label: "错题", count: levelQids.filter((id) => passes("wrong", id)).length },
        { key: "right", label: "已答对", count: levelQids.filter((id) => passes("right", id)).length },
        { key: "todo", label: "未做", count: levelQids.length - doneN },
      ]
    : [
        { key: "todo", label: "未做", count: levelQids.length - doneN },
        { key: "done", label: "已做", count: doneN },
      ];
  const submitLabel = reviewOnly
    ? "开始新一轮"
    : saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存 ✓" : saveState === "error" ? "保存失败，重试" : `提交答卷（已答 ${answeredCount}）`;

  const sectionsInRound = useMemo(() => {
    const set = new Set(qids.map((id) => banks.get(id)?.section).filter(Boolean) as Section[]);
    return (["CO", "CE"] as Section[]).filter((s) => set.has(s));
  }, [qids, banks]);

  // ------------------------------------------------------------ render

  const footBtn = "max-md:flex-1 max-md:px-1 max-md:text-[13px]";
  const onBtn = "border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SessionBar back={props.back} title={props.title} />
      <div className="mx-auto flex w-full max-w-[1360px] flex-1">
        <Sidebar
          title={props.title}
          total={qids.length}
          elapsedMs={review ? undefined : elapsed}
          filters={filters}
          filter={filter}
          onFilter={setFilter}
          level={levelTabs ? level : undefined}
          onLevel={levelTabs ? changeLevel : undefined}
          groups={groups}
          onPick={(id) => {
            select(id);
            if (window.innerWidth < 900) setCollapsed(true);
          }}
          submit={
            review
              ? undefined
              : {
                  label: submitLabel,
                  disabled: saveState === "saving" || (!reviewOnly && (answeredCount === 0 || stale)),
                  onClick: reviewOnly ? () => void startNew() : () => void submit(),
                }
          }
          collapsed={collapsed}
          onCollapse={() => setCollapsed((c) => !c)}
        />
        <main className="relative min-w-0 flex-1 px-4 pt-4 md:px-7 md:pt-5" ref={container}>
          <div className="mx-auto max-w-[900px]">
            {stale && (
              <Banner tone="warn">
                这一轮已在其他页面提交或放弃，这里的作答不会再保存。
                <Button size="sm" onClick={() => void startNew()}>开始新一轮</Button>
              </Banner>
            )}
            {review && <Banner className="text-[13px]">复习模式：答案和解析直接显示；选选项只用来自测，不记录，也不进错题本。</Banner>}
            {reviewOnly && (
              <Banner>
                正在查看已提交的本轮作答。
                <Button size="sm" onClick={() => void startNew()}>开始新一轮</Button>
              </Banner>
            )}
          </div>
          {q ? (
            <QuestionView
              q={q}
              p2={p2}
              no={no}
              done={isDone(q.id)}
              entry={draft[q.id]}
              order={order}
              settings={settings}
              setSettings={setSettings}
              revealAnswer={answerShown}
              judgeChoice={settings.instantJudge || reviewOnly || review}
              showAnalysis={showAnalysis}
              transcriptShown={settings.alwaysShowTranscript || shown.has(q.id) || answerShown}
              onShowTranscript={() => setShown((s) => new Set(s).add(q.id))}
              favorite={favorites.has(q.id)}
              onToggleFavorite={() => void toggleFavorite(q)}
              noteOpen={noteOpen}
              onToggleNote={() => setNoteOpen((o) => !o)}
              onOpenAnalysis={() => {
                setRevealed(true);
                setShowAnalysis(true);
              }}
              highlights={highlights}
              onOpenHighlight={setBubble}
              audioRef={audio}
              autoplayDelay={settings.autoplay && running ? settings.autoplayDelay : null}
              readOnly={locked}
              onChoose={choose}
              onChooseAndNext={chooseAndNext}
            />
          ) : (
            session && (
              <div className="mx-auto max-w-[900px]">
                <EmptyState>这一轮没有题目。</EmptyState>
              </div>
            )
          )}
          {q && (
            <footer className="sticky bottom-0 mx-auto flex max-w-[900px] items-center gap-1.5 bg-linear-to-t from-background from-70% to-transparent pt-4 pb-3 md:gap-2.5">
              <Button variant="outline" size="lg" className={footBtn} disabled={visible.indexOf(q.id) === 0} onClick={() => goto(-1)}>
                <ChevronLeft /> 上一题
              </Button>
              <span className="flex-1 max-md:hidden" />
              <Button variant="outline" size="lg" className={cn(footBtn, answerShown && onBtn)} onClick={() => setRevealed(!answerShown)} disabled={reviewOnly}>
                {answerShown ? <EyeOff /> : <Eye />}
                {answerShown ? "隐藏答案" : "显示答案"}
              </Button>
              <Button variant="outline" size="lg" className={cn(footBtn, showAnalysis && onBtn)} onClick={toggleAnalysis}>
                <Lightbulb /> 答案解析
              </Button>
              <Button size="lg" className={footBtn} disabled={visible.indexOf(q.id) === visible.length - 1} onClick={() => goto(1)}>
                下一题 <ChevronRight />
              </Button>
            </footer>
          )}
        </main>
      </div>

      {selTool && !settings.quickHighlight && (
        <div
          className="absolute z-40 flex -translate-x-1/2 gap-0.5 rounded-lg bg-foreground p-[3px] shadow-lg"
          style={{ top: selTool.rect.top - 44 + window.scrollY, left: selTool.rect.left + selTool.rect.width / 2 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {(
            [
              ["高亮", () => void createHighlights(selTool.blocks, false)],
              ["高亮并写笔记", () => void createHighlights(selTool.blocks, true)],
              ["查词", lookUpSelection],
            ] as const
          ).map(([label, onClick]) => (
            <button key={label} type="button" className="rounded-md px-2.5 py-1.5 text-[13px] text-background hover:bg-background/15" onClick={onClick}>
              {label}
            </button>
          ))}
        </div>
      )}
      {bubble && <HighlightBubble id={bubble} onClose={() => setBubble(null)} />}
      {dictQuery && <DictBubble key={dictQuery.text + dictQuery.rect.top} query={dictQuery} onClose={closeDict} />}

      {resumeCandidate && (
        <Modal
          title="继续上次的练习？"
          description={`上次这一轮还有 ${Object.values(resumeCandidate.draft).filter((d) => d.choice).length} 道题已作答但未提交（${new Date(resumeCandidate.updatedAt).toLocaleString()}）。`}
        >
          <ModalActions>
            <Button variant="outline" onClick={() => void discard()}>
              放弃，重新开始
            </Button>
            <Button onClick={() => void resume()}>继续上次</Button>
          </ModalActions>
        </Modal>
      )}

      {summary && (
        <SessionSummary
          result={summary}
          banks={banks}
          states={states}
          sections={sectionsInRound}
          onReview={(qid) => {
            setSummary(null);
            setReviewOnly(true);
            if (qid) select(qid);
          }}
          onNewRound={() => void startNew()}
          onGoWrong={() => navigate(props.wrongLink ?? "/wrong?state=open")}
        />
      )}
    </div>
  );
}

