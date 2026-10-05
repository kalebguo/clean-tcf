import { CalendarClock, Flame, History, Layers, RotateCcw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Bar, LinkCard, PageShell } from "../components/AppShell";
import { PARTS, type Part } from "../components/parts";
import { useBanks } from "../data/bank";
import { SECTIONS, type Section } from "../data/types";
import { dayKey, daysAgo, daysUntil, streakOf, useActivity, useDueCounts } from "../db/activity";
import { accuracy, countDone, useQStates } from "../db/progress";
import { useExamDate } from "../db/settings";
import { useVocab } from "../db/vocab";
import { fmtYm, useOral } from "../oral/data";
import { fmtDate, Loading, useOpenRounds } from "./common";

const WEEKS = 26;

function TodayTile({ icon: Icon, value, label, to, tone }: { icon: LucideIcon; value: ReactNode; label: ReactNode; to?: string; tone: string }) {
  const body = (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tone)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xl leading-none font-extrabold tabular-nums">{value}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function ExamCountdown() {
  const [date, setDate] = useExamDate();
  const days = date ? daysUntil(date) : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-left">
          <TodayTile
            icon={CalendarClock}
            tone="bg-ee/10 text-ee"
            value={days === null ? "—" : days >= 0 ? `${days} 天` : "已考完"}
            label={days === null ? "点这里填考试日期" : `距离考试 · ${date}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="mb-2 text-sm font-semibold">考试日期</div>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {date && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDate("")}>
            清除
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Heatmap({ act }: { act: Map<string, number> | undefined }) {
  // columns are weeks (Monday first), the last column is this week
  const today = new Date(daysAgo(0));
  const offset = (today.getDay() + 6) % 7; // days since Monday
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const back = WEEKS * 7 - 1 - i - (6 - offset);
    const k = dayKey(daysAgo(back));
    return { k, n: back < 0 ? -1 : (act?.get(k) ?? 0) };
  });
  const tone = (n: number) =>
    n < 0 ? "bg-transparent" : n === 0 ? "bg-muted" : n < 10 ? "bg-primary/25" : n < 30 ? "bg-primary/50" : n < 60 ? "bg-primary/75" : "bg-primary";
  const total = cells.reduce((a, c) => a + Math.max(0, c.n), 0);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="shrink-0 font-bold">练习记录</div>
        <div className="text-xs text-muted-foreground">最近 {WEEKS} 周 · {total} 次（做题 + 闪卡）</div>
      </div>
      {/* rtl so that a narrow screen shows the latest weeks first */}
      <div className="overflow-x-auto [scrollbar-width:none]" dir="rtl">
        <div dir="ltr" className="grid w-fit grid-flow-col grid-rows-7 gap-[3px]">
          {cells.map((c) => (
            <span key={c.k} title={c.n >= 0 ? `${c.k}：${c.n}` : undefined} className={cn("size-3.5 rounded-[3px]", tone(c.n))} />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        少
        {[0, 5, 20, 40, 80].map((n) => (
          <span key={n} className={cn("size-3 rounded-[3px]", tone(n))} />
        ))}
        多
      </div>
    </div>
  );
}

export function Home() {
  const banks = useBanks();
  const states = useQStates();
  const rounds = useOpenRounds();
  const oral = useOral();
  const vocab = useVocab();
  const act = useActivity(WEEKS * 7);
  const dueCO = useDueCounts("CO");
  const dueCE = useDueCounts("CE");
  const dueW = useDueCounts("words");
  useEffect(() => {
    document.title = "TCF 练习";
  }, []);
  if (!banks) return <Loading />;

  const today = act?.get(dayKey(Date.now())) ?? 0;
  const streak = act ? streakOf(act) : 0;
  const due = (dueCO?.due ?? 0) + (dueCE?.due ?? 0) + (dueW?.due ?? 0);
  const dueTo = dueCO?.due ? "/listening/flashcards" : dueCE?.due ? "/reading/flashcards" : "/vocab/flashcards";
  const wrongOpen = [...states.values()].filter((s) => s.wrong === "open").length;
  const now = new Date();
  const weekday = "日一二三四五六"[now.getDay()];
  const bookOpen = [...vocab.values()].filter((v) => !v.mastered).length;

  const sectionCard = (sec: Section) => {
    const p = PARTS[sec];
    const bank = banks[sec];
    const ids = bank.questions.map((q) => q.id);
    const done = countDone(ids, states);
    const acc = accuracy(ids, states);
    return (
      <LinkCard key={sec} to={p.path} title={p.name} sub={p.fr} icon={<PartIcon part={sec} />}>
        <div className="mt-auto">
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
            <span>
              已做 {done} / {ids.length}
            </span>
            <span>正确率 {acc === null ? "—" : `${Math.round(acc * 100)}%`}</span>
          </div>
          <Bar value={done / ids.length} fill={p.bg} />
        </div>
      </LinkCard>
    );
  };

  const oralCard = (kind: "writing" | "speaking") => {
    const part: Part = kind === "writing" ? "EE" : "EO";
    const p = PARTS[part];
    const b = oral?.[kind];
    const last = b?.months[b.months.length - 1];
    const inLast = b && last ? b.subjects.filter((s) => s.months.includes(last)) : [];
    const fresh = inLast.filter((s) => s.months.length === 1).length;
    return (
      <LinkCard key={kind} to={p.path} title={p.name} sub={p.fr} icon={<PartIcon part={part} />}>
        <div className="mt-auto text-xs text-muted-foreground">
          {b && last ? (
            <>
              <span className="font-semibold text-foreground">{b.subjects.length}</span> 题 · {b.sets.length} {kind === "writing" ? "套" : "组"} ·{" "}
              {fmtYm(last)} {inLast.length} 题，其中新题 <span className={cn("font-semibold", p.text)}>{fresh}</span>
            </>
          ) : (
            "题库加载中…"
          )}
        </div>
      </LinkCard>
    );
  };

  return (
    <PageShell>
      <div className="mb-6">
        <div className="text-sm text-muted-foreground">
          {now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{weekday}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">Bonjour !</h1>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TodayTile icon={Flame} tone="bg-lv-b2/10 text-lv-b2" value={today} label={streak ? `今天练习 · 连续 ${streak} 天` : "今天练习"} />
        <TodayTile icon={Layers} tone="bg-vocab/10 text-vocab" value={due} label="闪卡待复习" to={dueTo} />
        <TodayTile icon={RotateCcw} tone="bg-wrong/10 text-wrong" value={wrongOpen} label="错题待订正" to="/wrong?state=open" />
        <ExamCountdown />
      </div>

      {rounds.length > 0 && (
        <div className="mb-6 rounded-2xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold">
            <History className="size-4 text-primary" /> 继续上次练习
          </div>
          <div className="flex flex-col">
            {rounds.slice(0, 4).map((r) => (
              <Link key={r.id} to={r.route} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-muted">
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted-foreground">
                  已答 {r.answered} 题 · {fmtDate(r.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map(sectionCard)}
        {oralCard("writing")}
        {oralCard("speaking")}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Heatmap act={act} />
        </div>
        <LinkCard to="/vocab" title="单词本" sub="分级词表 · 生词本 · 单词闪卡" icon={<PartIcon part="V" />}>
          <div className="mt-auto flex gap-8">
            <div>
              <div className="text-2xl leading-none font-extrabold tabular-nums">{bookOpen}</div>
              <div className="mt-1 text-xs text-muted-foreground">生词（未掌握）</div>
            </div>
            <div>
              <div className="text-2xl leading-none font-extrabold tabular-nums">{dueW?.due ?? 0}</div>
              <div className="mt-1 text-xs text-muted-foreground">单词待复习</div>
            </div>
          </div>
        </LinkCard>
      </div>

      <div className="mt-8 flex justify-center gap-5 text-sm text-muted-foreground">
        <Link to="/search" className="hover:text-foreground">搜索</Link>
        <Link to="/wrong" className="hover:text-foreground">错题本</Link>
        <Link to="/favorites" className="hover:text-foreground">收藏夹和笔记本</Link>
        <Link to="/data" className="hover:text-foreground">数据备份</Link>
      </div>
    </PageShell>
  );
}

export function PartIcon({ part }: { part: Part | "V" }) {
  const p = PARTS[part];
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", p.soft, p.text)}>
      <p.icon className="size-5" />
    </span>
  );
}
