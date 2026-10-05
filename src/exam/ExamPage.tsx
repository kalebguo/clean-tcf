import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Bar, PageHeader, PageShell } from "../components/AppShell";
import { LevelTag, Panel, Pick, Seg, StatTiles } from "../components/controls";
import { ModalActions } from "../components/Modal";
import { LEVEL_BG, PARTS } from "../components/parts";
import { useUI } from "../components/ui";
import { isPictureItem, useBanks, type Banks } from "../data/bank";
import { useP2 } from "../data/p2";
import { LEVELS, SECTION_NAME, SECTION_SLUG, slugToSection, type Section, type SetInfo } from "../data/types";
import { examScopeKey, toRecord, useExamHistory, type ExamKind, type ExamRecord } from "../db/exams";
import { useHighlights } from "../db/highlights";
import { toggleFavorite, useFavorites, useQStates } from "../db/progress";
import { db, type Session } from "../db/schema";
import { createSession, discardSession, findOpenSession, type SubmitResult } from "../db/sessions";
import { getKV, setKV, useSettings } from "../db/settings";
import { fmtDate, Loading, NotFound } from "../pages/common";
import type { AudioHandle } from "../practice/AudioBar";
import { HighlightBubble } from "../practice/HighlightBubble";
import { QuestionView } from "../practice/QuestionView";
import { optionOrder } from "../practice/shuffle";
import { cellClass, fmtElapsed } from "../practice/Sidebar";
import { ExamRunner } from "./ExamRunner";
import {
  ANSWER_SECONDS, cefrOf, EXAM_DIST, EXAM_MAX, LISTENING_MINUTES, nclcOf, pickExam, scaled, type ExamSource,
} from "./score";

const noop = () => {};

export function MockExamRoute() {
  const { section: slug } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  if (!section) return <NotFound />;
  if (!banks) return <Loading />;
  return <Exam key={`mock:${section}`} banks={banks} section={section} kind="mock" />;
}

export function SetExamRoute() {
  const { section: slug, setId } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  if (!section) return <NotFound />;
  if (!banks) return <Loading />;
  const set = banks[section].sets.find((s) => s.id === setId);
  if (!set) return <NotFound />;
  return <Exam key={`set:${section}:${set.id}`} banks={banks} section={section} kind="set" set={set} />;
}

interface ExamInfo {
  section: Section;
  kind: ExamKind;
  set?: SetInfo;
  scopeKey: string;
  route: string;
  label: string;
}

/** Setup → exam → report (?report=<session id>). An open paper is resumed from the setup page. */
function Exam({ banks, section, kind, set }: { banks: Banks; section: Section; kind: ExamKind; set?: SetInfo }) {
  const slug = SECTION_SLUG[section];
  const info: ExamInfo = {
    section, kind, set,
    scopeKey: examScopeKey(section, kind, set?.id),
    route: kind === "mock" ? `/${slug}/exam` : `/${slug}/sets/${set!.id}/exam`,
    label: kind === "mock" ? `${SECTION_NAME[section]}模拟考试` : `${SECTION_NAME[section]} ${set!.label} 测试`,
  };
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const ui = useUI();
  const report = sp.get("report");
  const [open, setOpen] = useState<Session | null | undefined>(undefined);
  const [running, setRunning] = useState<Session | null>(null);

  useEffect(() => {
    if (!report && !running) void findOpenSession(info.scopeKey).then((s) => setOpen(s ?? null));
  }, [info.scopeKey, report, running]);

  const run = (s: Session) => {
    ui.closeDict();
    setRunning(s);
  };

  if (report) return <ExamReport key={report} banks={banks} id={report} info={info} />;
  if (running) {
    return (
      <ExamRunner
        banks={banks}
        session={running}
        onQuit={() => setRunning(null)}
        onSubmitted={(id, result) => {
          setRunning(null);
          navigate(`${info.route}?report=${id}`, { state: { result } });
        }}
      />
    );
  }
  if (open === undefined) return <Loading />;
  return <ExamSetup banks={banks} info={info} open={open} onRun={run} />;
}

// ---------------------------------------------------------------- setup

interface Prefs {
  source: ExamSource;
  onlyNew: boolean;
  shuffle: boolean;
  answerSeconds: number;
}
const DEFAULT_PREFS: Prefs = { source: "all", onlyNew: false, shuffle: true, answerSeconds: 10 };
const SOURCE_LABEL: Record<ExamSource, string> = { all: "全部", main: "真题", extra: "补充" };

function ExamSetup({ banks, info, open, onRun }: { banks: Banks; info: ExamInfo; open: Session | null; onRun(s: Session): void }) {
  const { section, kind, set } = info;
  const slug = SECTION_SLUG[section];
  const listening = section === "CO";
  const states = useQStates();
  const history = useExamHistory(banks, section);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getKV<Partial<Prefs>>("examPrefs", {}).then((p) => setPrefs({ ...DEFAULT_PREFS, ...p }));
  }, []);
  useEffect(() => {
    document.title = `${info.label} · TCF`;
  }, [info.label]);

  const bank = banks[section];
  const setQids = useMemo(() => (set ? [...new Set(set.questionIds)].filter((id) => banks.get(id)) : []), [set, banks]);
  // levels where "only new questions" runs short and answered ones fill the gap
  const short = useMemo(() => {
    if (kind !== "mock" || !prefs?.onlyNew) return [];
    return LEVELS.flatMap((l) => {
      const fresh = bank.questions.filter(
        (q) => q.level === l && (prefs.source === "all" || q.source === prefs.source) && !states.get(q.id)?.attempts,
      ).length;
      return fresh < EXAM_DIST[l] ? [`${l} 只剩 ${fresh} 道`] : [];
    });
  }, [kind, prefs, bank, states]);

  if (!prefs) return <Loading />;
  const update = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    void setKV("examPrefs", next);
  };

  const mine = (history ?? []).filter((r) => r.kind === kind && (kind === "mock" || r.setId === set?.id)).reverse();
  const openAnswered = open ? Object.values(open.draft).filter((d) => d.choice).length : 0;
  const maxPoints = kind === "mock" ? EXAM_MAX : setQids.reduce((s, id) => s + (banks.get(id)?.points ?? 0), 0);
  const total = kind === "mock" ? 39 : setQids.length;

  const start = async () => {
    if (open && openAnswered > 0 && !window.confirm(`放弃上次没交卷的考试（已答 ${openAnswered} 题）？`)) return;
    setBusy(true);
    if (open) await discardSession(open.id);
    const qids =
      kind === "mock"
        ? pickExam(bank.questions, { source: prefs.source, onlyNew: prefs.onlyNew, isDone: (id) => (states.get(id)?.attempts ?? 0) > 0 }).qids
        : setQids;
    const s = await createSession({
      mode: "exam",
      section,
      scopeKey: info.scopeKey,
      scope: {
        kind, setId: set?.id, route: info.route, label: info.label, source: kind === "mock" ? prefs.source : undefined,
        shuffle: prefs.shuffle ? "1" : "0", answerSeconds: String(prefs.answerSeconds),
      },
      qids,
    });
    onRun(s);
  };

  const p = PARTS[section];
  const OPT = "flex flex-wrap items-center gap-x-3 gap-y-1.5";
  const OPT_LABEL = "min-w-24 text-[13.5px] text-muted-foreground";
  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        back={kind === "mock" ? { to: `/${slug}`, label: SECTION_NAME[section] } : { to: `/${slug}/sets`, label: "套题列表" }}
        kicker={p.fr}
        kickerClass={p.text}
        title={info.label}
      />
      <div className="grid gap-4">
        {open && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/50 bg-primary/5 p-4">
            <div className="min-w-0 flex-1">
              <b>上次的考试还没交卷</b>
              <div className="text-xs text-muted-foreground">
                已答 {openAnswered}/{open.qids.length} 题 · 用时 {fmtElapsed(open.elapsedMs)} · {fmtDate(open.updatedAt)}
                {listening && ` · 从第 ${open.currentIndex + 1} 题重新播放`}
              </div>
            </div>
            <Button onClick={() => onRun(open)}>
              <Play className="fill-current" /> 继续考试
            </Button>
          </div>
        )}

        <Panel title="考试规则">
          <ul className="mb-5 list-disc space-y-1 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
            {kind === "mock" ? (
              <li>
                39 题：{LEVELS.map((l) => `${l} ${EXAM_DIST[l]}`).join(" · ")}，从易到难，满分 699 分。
              </li>
            ) : (
              <li>
                这一套的 {total} 道题，按原顺序，满分 {maxPoints} 分{maxPoints !== EXAM_MAX && "（不满 39 题，等级按 699 分制折算）"}。
              </li>
            )}
            {listening ? (
              <>
                <li>每段录音只放一次，不能暂停、拖动或重听。录音放完后有 {prefs.answerSeconds} 秒作答，然后自动进入下一题，不能回到前面的题。</li>
                <li>录音约 30 分钟，加上作答时间，整场约 {LISTENING_MINUTES} 分钟。录音播放时就可以选答案。</li>
              </>
            ) : (
              <li>限时 60 分钟，可以自由切换题目。时间到自动交卷。</li>
            )}
            <li>考试界面是法语，没有译文、悬停翻译、查词和答案。</li>
            <li>中途退出会保存进度，下次从这里继续{listening && "（当前这题的录音从头再放）"}。</li>
            <li>交卷后看分数、NCLC 等级和逐题解析；答错的题进错题本。</li>
          </ul>

          <div className="grid gap-3 border-t pt-4">
            {kind === "mock" && (
              <>
                <div className={OPT}>
                  <span className={OPT_LABEL}>题目来源</span>
                  <Seg<ExamSource>
                    value={prefs.source}
                    onChange={(source) => update({ source })}
                    options={(["all", "main", "extra"] as const).map((k) => [k, SOURCE_LABEL[k]])}
                  />
                </div>
                <div className={OPT}>
                  <span className={OPT_LABEL}>抽题范围</span>
                  <Seg<"all" | "new">
                    value={prefs.onlyNew ? "new" : "all"}
                    onChange={(v) => update({ onlyNew: v === "new" })}
                    options={[
                      ["all", "全部"],
                      ["new", "优先没做过的"],
                    ]}
                  />
                </div>
                {short.length > 0 && <div className="text-xs text-muted-foreground">没做过的题不够：{short.join("，")}，不足的用做过的题补。</div>}
              </>
            )}
            {listening && (
              <div className={OPT}>
                <span className={OPT_LABEL}>每题作答时间</span>
                <Pick<string>
                  label="每题作答时间"
                  className="w-28"
                  value={String(prefs.answerSeconds)}
                  onChange={(v) => update({ answerSeconds: Number(v) })}
                  options={ANSWER_SECONDS.map((n) => [String(n), `${n} 秒`])}
                />
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Switch checked={prefs.shuffle} onCheckedChange={(shuffle) => update({ shuffle })} />
              打乱选项顺序{listening && "（看图题的选项是录音读的，不打乱）"}
            </label>
          </div>

          <ModalActions>
            <Button variant="outline" size="lg" asChild>
              <Link to={`/${slug}/progress`}>学习进度</Link>
            </Button>
            <Button size="lg" disabled={busy || total === 0} onClick={() => void start()}>
              {open ? "重新开始" : "开始考试"}
            </Button>
          </ModalActions>
        </Panel>

        {mine.length > 0 && (
          <Panel title="最近成绩">
            <ExamList records={mine.slice(0, 8)} section={section} routeOf={() => info.route} />
          </Panel>
        )}
      </div>
    </PageShell>
  );
}

/** Rows of past exams with score, NCLC and time; each opens its report. */
export function ExamList({ records, section, routeOf }: { records: ExamRecord[]; section: Section; routeOf(r: ExamRecord): string }) {
  return (
    <div className="mt-3 grid gap-1">
      {records.map((r) => {
        const s699 = scaled(r.result.score, r.result.max);
        const nclc = nclcOf(section, s699);
        return (
          <Link
            key={r.id}
            className="grid grid-cols-2 items-baseline gap-x-3 rounded-lg px-3 py-2 text-sm hover:bg-muted sm:grid-cols-[6rem_7rem_5rem_1fr]"
            to={`${routeOf(r)}?report=${r.id}`}
          >
            <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(r.submittedAt)}</span>
            <b className="tabular-nums">
              {r.result.score}
              <span className="text-xs font-normal text-muted-foreground"> / {r.result.max}</span>
            </b>
            <span>{nclc ? `NCLC ${nclc}` : "NCLC < 4"}</span>
            <span className="text-xs text-muted-foreground">
              {r.result.correct}/{r.result.total} 题 · {fmtElapsed(r.elapsedMs)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- report

function ExamReport({ banks, id, info }: { banks: Banks; id: string; info: ExamInfo }) {
  const { section } = info;
  const slug = SECTION_SLUG[section];
  const loc = useLocation();
  const result = (loc.state as { result?: SubmitResult } | null)?.result;
  const s = useLiveQuery(() => db.sessions.get(id).then((r) => r ?? null), [id]);
  useEffect(() => {
    document.title = `成绩 · ${info.label} · TCF`;
  }, [info.label]);
  if (s === undefined) return <Loading text="加载成绩…" />;
  if (!s || s.mode !== "exam") return <NotFound />;

  const r = toRecord(s, banks).result;
  const full = r.max === EXAM_MAX;
  const s699 = scaled(r.score, r.max);
  const nclc = nclcOf(section, s699);
  const cefr = cefrOf(s699);

  const p = PARTS[section];
  return (
    <PageShell className="max-w-[960px]">
      <PageHeader
        back={{ to: info.route, label: info.kind === "mock" ? "模拟考试" : "套题测试" }}
        kicker={p.fr}
        kickerClass={p.text}
        title={`${info.label} · 成绩`}
      />
      {s.status !== "submitted" ? (
        <Panel>
          这场考试还没交卷。
          <Link className="text-primary hover:underline" to={info.route}>
            回去继续
          </Link>
        </Panel>
      ) : (
        <div className="grid gap-4">
          <Panel>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-1.5">
              <b className="text-5xl leading-none font-extrabold tabular-nums">{r.score}</b>
              <span className="text-muted-foreground">/ {r.max}</span>
              {!full && <span className="text-xs text-muted-foreground">（按 699 分制折算 {s699}）</span>}
            </div>
            <StatTiles
              items={[
                [nclc ? `NCLC ${nclc}` : "< 4", full ? "NCLC" : "NCLC（折算）"],
                [cefr ?? "< A1", "欧框等级"],
                [`${r.correct}/${r.total}`, "答对"],
                [r.total - r.answered, "未答"],
                [fmtElapsed(s.elapsedMs), "用时"],
              ]}
            />
            {result && !result.alreadySubmitted && (
              <p className="mt-3 text-xs text-muted-foreground">
                答错的 {result.wrongQids.length} 题已进错题本
                {result.fixedQids.length > 0 && `，订正了 ${result.fixedQids.length} 道旧错题`}。没作答的题不记录。
              </p>
            )}
            <div className="mt-4 grid gap-1">
              {r.byLevel.map((l) => (
                <div key={l.level} className="grid grid-cols-[2.25rem_1fr_4.5rem] items-center gap-3">
                  <LevelTag level={l.level} />
                  <Bar value={l.correct / l.total} fill={LEVEL_BG[l.level]} />
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {l.correct}/{l.total}
                  </span>
                </div>
              ))}
            </div>
            <ModalActions>
              <Button variant="outline" asChild>
                <Link to={`/wrong?section=${section}&state=open`}>错题本</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/${slug}/progress`}>学习进度</Link>
              </Button>
              <Button asChild>
                <Link to={info.route}>再考一次</Link>
              </Button>
            </ModalActions>
          </Panel>
          <ExamReview banks={banks} s={s} />
        </div>
      )}
    </PageShell>
  );
}

/** Each question of the paper with the answer given, the key, translations and analysis. */
function ExamReview({ banks, s }: { banks: Banks; s: Session }) {
  const [settings, setSettings] = useSettings();
  const favorites = useFavorites();
  const [cur, setCur] = useState(() => s.qids.find((id) => s.draft[id]?.choice !== banks.get(id)?.answer) ?? s.qids[0]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const audio = useRef<AudioHandle>(null);
  const q = banks.get(cur);
  const p2 = useP2(q);
  const highlights = useHighlights(q?.id);
  if (!q) return null;
  const order = optionOrder(s.id, q.id, s.scope.shuffle !== "0" && !isPictureItem(q));
  const i = s.qids.indexOf(cur);
  const slug = SECTION_SLUG[q.section];

  return (
    <Panel title="逐题回顾" action={<span className="text-xs text-muted-foreground">绿 = 答对，红 = 答错，灰 = 未答。题号是这场考试里的顺序。</span>}>
      <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5">
        {s.qids.map((id, n) => {
          const c = s.draft[id]?.choice;
          return (
            <button
              key={id}
              type="button"
              className={cellClass(!c ? "done" : c === banks.get(id)?.answer ? "right" : "wrong", id === cur)}
              onClick={() => setCur(id)}
            >
              {n + 1}
            </button>
          );
        })}
      </div>
      <QuestionView
        key={q.id}
        q={q}
        p2={p2}
        no={i + 1}
        done
        entry={s.draft[q.id]}
        order={order}
        settings={settings}
        setSettings={setSettings}
        revealAnswer
        judgeChoice
        showAnalysis
        transcriptShown
        onShowTranscript={noop}
        favorite={favorites.has(q.id)}
        onToggleFavorite={() => void toggleFavorite(q)}
        noteOpen={noteOpen}
        onToggleNote={() => setNoteOpen((o) => !o)}
        onOpenAnalysis={noop}
        highlights={highlights}
        onOpenHighlight={setBubble}
        audioRef={audio}
        autoplayDelay={null}
        readOnly
        onChoose={noop}
        onChooseAndNext={noop}
      />
      <footer className="flex flex-wrap items-center gap-2.5 pt-4">
        <Button variant="outline" disabled={i === 0} onClick={() => setCur(s.qids[i - 1])}>
          <ChevronLeft /> 上一题
        </Button>
        <span className="flex-1" />
        <Link className="text-[13px] text-primary hover:underline max-sm:order-last max-sm:w-full max-sm:text-center" to={`/${slug}/review?q=${q.id}`}>
          在复习模式打开（可查词、高亮）
        </Link>
        <span className="flex-1" />
        <Button variant="outline" disabled={i === s.qids.length - 1} onClick={() => setCur(s.qids[i + 1])}>
          下一题 <ChevronRight />
        </Button>
      </footer>
      {bubble && <HighlightBubble id={bubble} onClose={() => setBubble(null)} />}
    </Panel>
  );
}
