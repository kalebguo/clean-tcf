import { CalendarDays, Mic, PenLine, Tags } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LinkCard, PageHeader, PageShell } from "../components/AppShell";
import { PARTS } from "../components/parts";
import { fmtYm, KIND_FR, KIND_ZH, TACHE_INFO, TACHES, TOPICS, useOral, type OralBank, type OralKind } from "./data";
import { MonthBars } from "./MonthBars";

export function OralHub({ kind }: { kind: OralKind }) {
  const data = useOral();
  const navigate = useNavigate();
  const p = PARTS[kind === "writing" ? "EE" : "EO"];
  useEffect(() => {
    document.title = `${KIND_ZH[kind]} · TCF`;
  }, [kind]);
  if (data === undefined) return <PageShell><div className="py-20 text-center text-muted-foreground">加载题库…</div></PageShell>;
  if (!data) return <PageShell><div className="py-20 text-center text-muted-foreground">没有找到写作 / 口语数据。请运行 <code>npm run data</code>。</div></PageShell>;
  const b = data[kind];
  const first = b.months[0];
  const last = b.months[b.months.length - 1];
  const setsPerMonth = new Map<string, number>();
  for (const s of b.sets) setsPerMonth.set(s.ym, (setsPerMonth.get(s.ym) ?? 0) + 1);
  const Icon = kind === "writing" ? PenLine : Mic;
  const base = `/${kind}/bank`;

  const description =
    kind === "writing"
      ? `考试 60 分钟，3 个任务。题库：${fmtYm(first, true)}–${fmtYm(last)}，${b.sets.length} 套，去重后 ${b.subjects.length} 题。`
      : `考试 12 分钟，3 个任务，和考官面对面。题库：${fmtYm(first, true)}–${fmtYm(last)}，${b.sets.length} 组，去重后 ${b.subjects.length} 题。`;

  return (
    <PageShell>
      <PageHeader kicker={KIND_FR[kind]} kickerClass={p.text} title={KIND_ZH[kind]} description={description} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kind === "speaking" && (
          <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
            <TacheHead kind={kind} t={1} />
            <p className="text-[13px] leading-relaxed text-muted-foreground">{TACHE_INFO.speaking[1].desc}</p>
            <div className="mt-auto rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">常见问题清单和练习（以后做）</div>
          </div>
        )}
        {TACHES[kind].map((t) => {
          const subs = b.subjects.filter((s) => s.tache === t);
          const thisMonth = subs.filter((s) => s.months.includes(last)).length;
          const repeated = subs.filter((s) => s.months.length > 1).length;
          return (
            <LinkCard key={t} to={`${base}?t=${t}`} title={<TacheHead kind={kind} t={t} />}>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{TACHE_INFO[kind][t].desc}</p>
              <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-3">
                <Num value={subs.length} label="题（去重）" />
                <Num value={thisMonth} label={`${fmtYm(last)}出现`} />
                <Num value={repeated} label="出现过多次" />
              </div>
            </LinkCard>
          );
        })}
      </div>

      <TopicGrid b={b} kind={kind} />

      <div className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <CalendarDays className={cn("size-5", p.text)} />
          <h2 className="font-bold">月度真题</h2>
          <span className="text-sm text-muted-foreground">
            每月{kind === "writing" ? "套数" : "组数"} · 点柱子看这个月的题
          </span>
          <Link to={`${base}?view=month`} className={cn("ml-auto text-sm font-medium", p.text)}>
            全部月份 →
          </Link>
        </div>
        <MonthBars
          months={b.months}
          counts={setsPerMonth}
          selected={null}
          onSelect={(m) => m && navigate(`${base}?view=month&m=${m}`)}
          barClass={p.bg}
          unit={kind === "writing" ? "套" : "组"}
        />
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed p-5 text-muted-foreground">
        <Icon className="mt-0.5 size-5 shrink-0" />
        <div className="text-sm leading-relaxed">
          <div className="font-semibold text-foreground">{kind === "writing" ? "作答和 AI 批改" : "录音练习和 AI 评分"}（以后做）</div>
          {kind === "writing"
            ? "计划：按考试计时写作，自动计字数，保存草稿，以后接 AI 批改。"
            : "计划：按考试计时（Tâche 2 含 2 分钟准备），录音、回放，以后接 AI 评分。"}
        </div>
      </div>
    </PageShell>
  );
}

/** Prompts per topic and tâche; each number opens the bank filtered to that topic. */
function TopicGrid({ b, kind }: { b: OralBank; kind: OralKind }) {
  const p = PARTS[kind === "writing" ? "EE" : "EO"];
  if (!b.subjects.some((s) => s.cat)) return null;
  const taches = TACHES[kind];
  const count = (cat: string, t?: number) => b.subjects.filter((s) => s.cat === cat && (t === undefined || s.tache === t)).length;
  return (
    <div className="mt-4 rounded-2xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tags className={cn("size-5", p.text)} />
        <h2 className="font-bold">按话题</h2>
        <span className="text-sm text-muted-foreground">去重后的题数 · 点 Tâche 看这类题</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {TOPICS.map((t) => (
          <div key={t.id} className="rounded-xl border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", p.soft, p.text)}>
                <t.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.zh}</span>
              <span className="text-sm font-bold tabular-nums">{count(t.id)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {taches.map((n) => {
                const c = count(t.id, n);
                return c ? (
                  <Link
                    key={n}
                    to={`/${kind}/bank?t=${n}&cat=${t.id}`}
                    className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums hover:bg-muted/70 hover:text-foreground"
                  >
                    T{n} · {c}
                  </Link>
                ) : null;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TacheHead({ kind, t }: { kind: OralKind; t: number }) {
  const p = PARTS[kind === "writing" ? "EE" : "EO"];
  const info = TACHE_INFO[kind][t];
  return (
    <div className="flex items-start gap-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-lg font-extrabold", p.soft, p.text)}>{t}</span>
      <div className="min-w-0">
        <div className="font-bold">
          Tâche {t} · {info.zh}
        </div>
        <div className="text-[13px] font-normal text-muted-foreground">{info.fr}</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge variant="secondary">{info.limit}</Badge>
          {info.note && kind === "speaking" && <Badge variant="outline">{info.note}</Badge>}
        </div>
      </div>
    </div>
  );
}

function Num({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-xl leading-none font-extrabold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
