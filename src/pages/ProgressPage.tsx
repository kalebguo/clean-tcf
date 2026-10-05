import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Bar, PageHeader, PageShell } from "../components/AppShell";
import { LevelTag, Panel, StatTiles } from "../components/controls";
import { LEVEL_BG, PARTS } from "../components/parts";
import { useBanks } from "../data/bank";
import { LEVELS, SECTION_NAME, SECTION_SLUG, slugToSection, type Section } from "../data/types";
import { daysUntil } from "../db/activity";
import { useExamHistory, type ExamKind, type ExamRecord } from "../db/exams";
import { accuracy, countDone, useFavorites, useQStates } from "../db/progress";
import { useExamDate } from "../db/settings";
import { ExamList } from "../exam/ExamPage";
import { EXAM_MAX, nclcOf, NCLC_FLOOR, scaled } from "../exam/score";
import { fmtElapsed } from "../practice/Sidebar";
import { Loading, NotFound } from "./common";

/** Practice progress, exam results and their trend for one section (SPEC §5.H). */
export function ProgressPage() {
  const { section: slug } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  const states = useQStates();
  const favorites = useFavorites();
  const history = useExamHistory(banks, section ?? "CO");
  const [examDate] = useExamDate();
  useEffect(() => {
    if (section) document.title = `${SECTION_NAME[section]}学习进度 · TCF`;
  }, [section]);
  if (!section) return <NotFound />;
  if (!banks || !history) return <Loading />;

  const p = PARTS[section];
  const bank = banks[section];
  const ids = bank.questions.map((q) => q.id);
  const open = ids.filter((id) => states.get(id)?.wrong === "open").length;
  const fixed = ids.filter((id) => states.get(id)?.wrong === "fixed").length;
  const favs = ids.filter((id) => favorites.has(id)).length;
  const days = examDate ? daysUntil(examDate) : null;
  const link = "text-sm font-medium text-primary hover:underline";

  return (
    <PageShell>
      <PageHeader
        back={{ to: p.path, label: p.name }}
        kicker={p.fr}
        kickerClass={p.text}
        title="学习进度"
        description="题库进度、模拟考试和套题测试成绩。"
        actions={
          days !== null && (
            <Badge variant="outline" className="h-7 gap-1.5 px-3 text-[13px]">
              <CalendarClock /> {days > 0 ? `距离考试 ${days} 天` : days === 0 ? "今天考试" : `考试已过去 ${-days} 天`}
            </Badge>
          )
        }
      />
      <div className="grid gap-4">
        <Panel title="题库进度">
          <div className="mb-3 text-xs text-muted-foreground">每道题只算一次；正确率按全部作答次数算。</div>
          <div className="grid gap-1">
            {LEVELS.map((l) => {
              const lid = bank.questions.filter((q) => q.level === l).map((q) => q.id);
              const done = countDone(lid, states);
              const acc = accuracy(lid, states);
              return (
                <Link key={l} className="grid grid-cols-[2.25rem_1fr_4.5rem_3rem] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted" to={`/${slug}/dedupe?level=${l}`}>
                  <LevelTag level={l} />
                  <Bar value={done / lid.length} fill={LEVEL_BG[l]} />
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {done}/{lid.length}
                  </span>
                  <span className="text-right text-xs text-muted-foreground tabular-nums">{acc === null ? "—" : `${Math.round(acc * 100)}%`}</span>
                </Link>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-5 border-t pt-3">
            <Link className={link} to={`/wrong?section=${section}&state=open`}>
              错题待订正 {open}
            </Link>
            <Link className={link} to={`/wrong?section=${section}&state=fixed`}>
              已订正 {fixed}
            </Link>
            <Link className={link} to={`/favorites?section=${section}`}>
              收藏 {favs}
            </Link>
          </div>
        </Panel>

        {(["mock", "set"] as ExamKind[]).map((kind) => (
          <ExamStats key={kind} section={section} kind={kind} records={history.filter((r) => r.kind === kind)} />
        ))}
      </div>
    </PageShell>
  );
}

function ExamStats({ section, kind, records }: { section: Section; kind: ExamKind; records: ExamRecord[] }) {
  const slug = SECTION_SLUG[section];
  const title = kind === "mock" ? "模拟考试" : "套题测试";
  const scores = records.map((r) => scaled(r.result.score, r.result.max));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const routeOf = (r: ExamRecord) => (r.kind === "mock" ? `/${slug}/exam` : `/${slug}/sets/${r.setId}/exam`);
  const stats: [ReactNode, string][] = [
    [records.length, "次数"],
    [avg(scores), "平均分"],
    [Math.max(...scores), "最高分"],
    [avg(scores.slice(-3)), "近三次平均"],
    [scores[scores.length - 1], "最近一次"],
    [fmtElapsed(avg(records.map((r) => r.elapsedMs))), "平均用时"],
  ];
  return (
    <Panel
      title={title}
      action={
        <Link className="text-sm font-medium text-primary hover:underline" to={kind === "mock" ? `/${slug}/exam` : `/${slug}/sets`}>
          {kind === "mock" ? "开始模拟考试 ›" : "去套题列表 ›"}
        </Link>
      }
    >
      {records.length === 0 ? (
        <div className="text-sm text-muted-foreground">还没有{title}成绩。</div>
      ) : (
        <>
          <StatTiles items={stats} className="grid-cols-3 sm:grid-cols-6" />
          {kind === "set" && <div className="mt-2 text-xs text-muted-foreground">不满 39 题的套，分数按 699 分制折算后再统计。</div>}
          <TrendChart section={section} scores={scores} />
          <ExamList records={[...records].reverse().slice(0, 10)} section={section} routeOf={routeOf} />
        </>
      )}
    </Panel>
  );
}

/** Scores out of 699 in the order taken, with the NCLC 5 / 7 / 9 floors as reference lines. */
function TrendChart({ section, scores }: { section: Section; scores: number[] }) {
  const W = 600;
  const H = 180;
  const pad = { l: 36, r: 64, t: 10, b: 20 };
  const x = (i: number) => pad.l + (scores.length < 2 ? (W - pad.l - pad.r) / 2 : (i / (scores.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / EXAM_MAX) * (H - pad.t - pad.b);
  const lines = [5, 7, 9].map((n) => ({ n, v: NCLC_FLOOR[section][n - 4] }));
  const label = "fill-muted-foreground text-[11px]";
  return (
    <svg className="mt-3 mb-1 block h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="分数趋势">
      {[0, 200, 400, 600].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className={label}>
            {v}
          </text>
        </g>
      ))}
      {lines.map(({ n, v }) => (
        <g key={n}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} strokeDasharray="4 4" className="stroke-muted-foreground/60" />
          <text x={W - pad.r + 4} y={y(v) + 4} className={label}>
            NCLC {n}
          </text>
        </g>
      ))}
      <polyline className="fill-none stroke-primary stroke-2" points={scores.map((s, i) => `${x(i)},${y(s)}`).join(" ")} />
      {scores.map((s, i) => (
        <circle key={i} cx={x(i)} cy={y(s)} r={4} className="fill-primary">
          <title>{`第 ${i + 1} 次：${s} 分 · ${nclcOf(section, s) ? `NCLC ${nclcOf(section, s)}` : "NCLC < 4"}`}</title>
        </circle>
      ))}
    </svg>
  );
}
