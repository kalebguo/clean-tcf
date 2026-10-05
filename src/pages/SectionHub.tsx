import { BookmarkCheck, ChartColumn, ClipboardCheck, Eye, Layers, ListChecks, Play, RotateCcw, Sparkles, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bar, LinkCard, PageHeader, PageShell } from "../components/AppShell";
import { LEVEL_BG, LEVEL_TEXT, PARTS } from "../components/parts";
import { useBanks } from "../data/bank";
import { LEVELS, slugToSection, type Section } from "../data/types";
import { EXAM_MAX, LISTENING_MINUTES, nclcOf } from "../exam/score";
import { dayKey, daysAgo, useActivity, useDueCounts } from "../db/activity";
import { useExamHistory } from "../db/exams";
import { accuracy, countDone, useFavorites, useNotes, useQStates } from "../db/progress";
import { Loading, NotFound } from "./common";

function CardIcon({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", className)}>
      <Icon className="size-[18px]" />
    </span>
  );
}

function Big({ value, label, className }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div>
      <div className={cn("text-[28px] leading-none font-extrabold tabular-nums", className)}>{value}</div>
      <div className="mt-1.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function SectionHub() {
  const { section: slug } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  const states = useQStates();
  const favorites = useFavorites();
  const notes = useNotes();
  const history = useExamHistory(banks, section ?? "CO");
  const due = useDueCounts(section ?? "CO");
  const week = useActivity(7, section ?? "CO");
  const p = PARTS[section ?? "CO"];
  useEffect(() => {
    if (section) document.title = `${p.name} · TCF`;
  }, [section, p.name]);
  if (!section) return <NotFound />;
  if (!banks) return <Loading />;

  const bank = banks[section];
  const ids = bank.questions.map((q) => q.id);
  const done = countDone(ids, states);
  const acc = accuracy(ids, states);
  const mine = (sec: Section) => sec === section;
  const wrongOpen = [...states.values()].filter((s) => mine(s.section) && s.wrong === "open").length;
  const wrongFixed = [...states.values()].filter((s) => mine(s.section) && s.wrong === "fixed").length;
  const favN = [...favorites.values()].filter((f) => mine(f.section)).length;
  const noteN = [...notes.values()].filter((n) => mine(n.section) && n.text.trim()).length;
  const setsStarted = bank.sets.filter((s) => countDone([...new Set(s.questionIds)], states) > 0).length;
  const tested = new Set((history ?? []).filter((r) => r.kind === "set").map((r) => r.setId)).size;
  const mocks = (history ?? []).filter((r) => r.kind === "mock");
  const lastMock = mocks[mocks.length - 1];
  const days = Array.from({ length: 7 }, (_, i) => {
    const k = dayKey(daysAgo(6 - i));
    return { k, n: week?.get(k) ?? 0 };
  });
  const maxDay = Math.max(1, ...days.map((d) => d.n));
  const base = `/${slug}`;

  return (
    <PageShell>
      <PageHeader
        kicker={p.fr}
        kickerClass={p.text}
        title={p.name}
        description={`${ids.length} 题 · ${bank.sets.length} 套 · 考试 ${section === "CO" ? `${LISTENING_MINUTES} 分钟` : "60 分钟"} 39 题，满分 ${EXAM_MAX}`}
        actions={
          <>
            <Button asChild variant="outline" className="h-9">
              <Link to={`${base}/review`}>
                <Eye /> 复习模式
              </Link>
            </Button>
            <Button asChild className={cn("h-9 text-white hover:opacity-90", p.bg)}>
              <Link to={`${base}/dedupe`}>
                <Play /> 开始刷题
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* dedupe bank with the six levels */}
        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 md:col-span-2">
          <div className="flex items-start gap-3">
            <CardIcon icon={ListChecks} className={cn(p.soft, p.text)} />
            <div className="flex-1">
              <div className="font-bold">去重题库</div>
              <div className="text-[13px] text-muted-foreground">重复题只出现一次，按难度练</div>
            </div>
            <Link to={`${base}/dedupe`} className={cn("text-sm font-medium", p.text)}>
              继续 →
            </Link>
          </div>
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="flex gap-8 sm:w-44 sm:flex-col sm:gap-4">
              <Big value={`${done}`} label={`已做 / 共 ${ids.length} 题`} />
              <Big value={acc === null ? "—" : `${Math.round(acc * 100)}%`} label="正确率" />
            </div>
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
              {LEVELS.map((l) => {
                const lid = bank.questions.filter((q) => q.level === l).map((q) => q.id);
                const d = countDone(lid, states);
                return (
                  <Link key={l} to={`${base}/dedupe?level=${l}`} className="rounded-xl border p-3 transition-colors hover:bg-muted/60">
                    <div className="flex items-baseline justify-between">
                      <span className={cn("text-sm font-extrabold", LEVEL_TEXT[l])}>{l}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {d}/{lid.length}
                      </span>
                    </div>
                    <Bar value={d / lid.length} className="mt-2" fill={LEVEL_BG[l]} />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <LinkCard to={`${base}/flashcards`} title="记忆闪卡" sub="做过的题按 FSRS 间隔复习" icon={<CardIcon icon={Layers} className="bg-vocab/10 text-vocab" />}>
          <div className="mt-auto flex gap-8">
            <Big value={due?.due ?? "—"} label="今天待复习" />
            <Big value={due?.fresh ?? "—"} label="新卡片" />
          </div>
        </LinkCard>

        <LinkCard to={`${base}/sets`} title="按套练习" sub="真题套题，可做套题测试" icon={<CardIcon icon={BookmarkCheck} className={cn(p.soft, p.text)} />}>
          <div className="mt-auto flex gap-8">
            <Big value={`${setsStarted}`} label={`已练 / 共 ${bank.sets.length} 套`} />
            <Big value={tested} label="已测试的套" />
          </div>
        </LinkCard>

        <LinkCard to={`${base}/exam`} title="模拟考试" sub={`按难度分布抽 39 题，满分 ${EXAM_MAX}`} icon={<CardIcon icon={ClipboardCheck} className="bg-ee/10 text-ee" />}>
          <div className="mt-auto flex gap-8">
            {lastMock ? (
              <>
                <Big value={lastMock.result.score} label="最近一次得分" />
                <Big value={`NCLC ${nclcOf(section, lastMock.result.score) ?? "—"}`} label={`共考 ${mocks.length} 次`} />
              </>
            ) : (
              <Big value="—" label="还没有考过" />
            )}
          </div>
        </LinkCard>

        <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <div className="flex items-start gap-3">
            <CardIcon icon={RotateCcw} className="bg-wrong/10 text-wrong" />
            <div className="flex-1">
              <div className="font-bold">错题本</div>
              <div className="text-[13px] text-muted-foreground">答对一次自动订正</div>
            </div>
          </div>
          <div className="flex gap-8">
            <Big value={wrongOpen} label="待订正" className="text-wrong" />
            <Big value={wrongFixed} label="已订正" className="text-correct" />
          </div>
          <div className="mt-auto flex gap-2">
            <Button asChild size="sm" disabled={!wrongOpen} className="flex-1">
              <Link to={`/wrong/practice?section=${section}&level=ALL&state=open&sort=recent`}>开始订正</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="flex-1">
              <Link to={`/wrong?section=${section}&state=open`}>查看错题</Link>
            </Button>
          </div>
        </div>

        <LinkCard to={`${base}/progress`} title="学习进度" sub="成绩趋势和各难度进度" icon={<CardIcon icon={ChartColumn} className="bg-ce/10 text-ce" />}>
          <div className="mt-auto flex items-end gap-4">
            <Big value={days[6].n} label="今天做题" />
            <div className="flex h-12 flex-1 items-end gap-1" title="最近 7 天">
              {days.map((d) => (
                <span key={d.k} className={cn("flex-1 rounded-sm", d.n ? p.bg : "bg-muted")} style={{ height: `${Math.max(8, (d.n / maxDay) * 100)}%` }} />
              ))}
            </div>
          </div>
        </LinkCard>

        <LinkCard to={`/favorites?section=${section}`} title="收藏与笔记" sub="收藏的题、题目笔记和划词高亮" icon={<CardIcon icon={Sparkles} className="bg-lv-b1/15 text-lv-b1" />}>
          <div className="mt-auto flex gap-8">
            <Big value={favN} label="收藏" />
            <Big value={noteN} label="笔记" />
          </div>
        </LinkCard>
      </div>
    </PageShell>
  );
}
