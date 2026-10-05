import { Search, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "../components/AppShell";
import { PARTS } from "../components/parts";
import { stripAccents } from "../data/dict";
import {
  fmtYm, isTopic, KIND_FR, KIND_ZH, lastMonth, TACHE_INFO, TACHES, TOPICS, useOral, type OralBank, type OralKind, type OralSet, type Subject, type TopicCat,
} from "./data";
import { MonthBars } from "./MonthBars";
import { TopicDetail, TopicTag } from "./TopicDetail";

type View = "dedupe" | "month";
type Sort = "recent" | "freq";

const fold = (s: string) => stripAccents(s.toLowerCase()).replace(/[’']/g, "'");

/** Search text (French, or the Chinese title) and topic. */
function matches(s: Subject, q: string, cat: TopicCat | null = null): boolean {
  if (cat && s.cat !== cat) return false;
  if (!q) return true;
  return fold([s.zh ?? "", s.text, s.intro ?? "", ...(s.docs ?? [])].join(" ")).includes(q);
}

function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.entries()];
}

function SubjectRow({ s, b, onOpen }: { s: Subject; b: OralBank; onOpen(): void }) {
  const p = PARTS[b.kind === "writing" ? "EE" : "EO"];
  const t3 = b.kind === "writing" && s.tache === 3 && s.docs;
  const fr = s.zh ? "text-[13.5px] leading-relaxed text-foreground/75" : "text-[14.5px] leading-relaxed";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full gap-4 rounded-xl border bg-card px-4 py-3 text-left transition-all hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(16_24_40/0.07)]"
    >
      <div className="min-w-0 flex-1">
        {s.zh && (
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold">{s.zh}</span>
            {s.cat && <TopicTag cat={s.cat} />}
          </div>
        )}
        {t3 ? (
          <>
            <div className={s.zh ? cn(fr, "font-medium") : "font-semibold"}>{s.intro}</div>
            <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">{s.docs![0]}</p>
          </>
        ) : (
          <p className={cn("line-clamp-2", fr)}>{s.text}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {s.months.length > 1 && <Badge className={cn(p.soft, p.text)}>出现 {s.months.length} 个月</Badge>}
        <span className="text-xs text-muted-foreground tabular-nums">{fmtYm(lastMonth(s))}</span>
      </div>
    </button>
  );
}

/** Topic filter: one chip per category with the number of prompts in the current tâche / month / search. */
function TopicChips({ counts, total, value, onChange, on }: { counts: Map<TopicCat, number>; total: number; value: TopicCat | null; onChange(c: TopicCat | null): void; on: string }) {
  const chip = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors disabled:opacity-40";
  const idle = "bg-card hover:bg-muted";
  // phones: one row that scrolls sideways, with the active chip scrolled into view
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    const btn = el?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (el && btn) el.scrollLeft += btn.getBoundingClientRect().left - el.getBoundingClientRect().left - 16;
  }, [value]);
  return (
    <div ref={row} className="mb-4 flex flex-wrap gap-1.5 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none]">
      <button type="button" aria-pressed={value === null} className={cn(chip, value === null ? on : idle)} onClick={() => onChange(null)}>
        全部话题 <span className="tabular-nums opacity-70">{total}</span>
      </button>
      {TOPICS.map((t) => {
        const n = counts.get(t.id) ?? 0;
        const active = value === t.id;
        return (
          <button key={t.id} type="button" aria-pressed={active} disabled={!n && !active} className={cn(chip, active ? on : idle)} onClick={() => onChange(active ? null : t.id)}>
            <t.icon className="size-3.5" />
            {t.zh}
            <span className="tabular-nums opacity-70">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function SetBlock({ set, b, tache, hit, onOpen }: { set: OralSet; b: OralBank; tache: number; hit(s: Subject): boolean; onOpen(id: string): void }) {
  const p = PARTS[b.kind === "writing" ? "EE" : "EO"];
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-[13px] font-semibold">
        {b.kind === "writing" ? `第 ${set.no} 套` : `组合 ${set.no}`}
        {set.sameAs && <span className="font-normal text-muted-foreground">· 和 {fmtYm(b.set.get(set.sameAs)!.ym)}第 {b.set.get(set.sameAs)!.no} 套相同</span>}
      </div>
      <ol>
        {set.subjects.map((sid, i) => {
          const s = b.subject.get(sid)!;
          const mark = hit(s);
          const sel = b.kind === "writing" && s.tache === tache;
          return (
            <li key={sid + i} className="border-b last:border-b-0">
              <button type="button" onClick={() => onOpen(sid)} className="flex w-full gap-3 px-4 py-2.5 text-left text-[14px] leading-snug hover:bg-muted/60">
                <span className={cn("mt-px w-6 shrink-0 font-semibold tabular-nums text-muted-foreground", sel && p.text)}>
                  {b.kind === "writing" ? `T${s.tache}` : i + 1}
                </span>
                <span className={cn("min-w-0", mark && "rounded bg-yellow-200/60 dark:bg-yellow-500/20")}>
                  {s.zh && <span className="block font-medium">{s.zh}</span>}
                  <span className={cn("line-clamp-2", s.zh && "text-[13px] text-muted-foreground")}>{s.intro ?? s.text}</span>
                </span>
                {s.months.length > 1 && <span className={cn("ml-auto shrink-0 text-xs", p.text)}>×{s.months.length}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function TopicBank({ kind }: { kind: OralKind }) {
  const data = useOral();
  const [sp, setSp] = useSearchParams();
  const taches = TACHES[kind];
  const tache = Number(sp.get("t")) || taches[0];
  const view: View = sp.get("view") === "month" ? "month" : "dedupe";
  const sort: Sort = sp.get("sort") === "freq" ? "freq" : "recent";
  const month = sp.get("m");
  const query = sp.get("q") ?? "";
  const q = fold(query.trim());
  const openId = sp.get("open");
  const catParam = sp.get("cat");
  const cat = isTopic(catParam) ? catParam : null;
  const p = PARTS[kind === "writing" ? "EE" : "EO"];

  const set = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: !push });
  };

  useEffect(() => {
    document.title = `${KIND_ZH[kind]}题库 · Tâche ${tache} · TCF`;
  }, [kind, tache]);

  const b = data ? data[kind] : undefined;

  // dedupe view: the distinct prompts of this tâche
  const subjects = useMemo(() => {
    if (!b) return [];
    const rows = b.subjects.filter((s) => s.tache === tache && (!month || s.months.includes(month)) && matches(s, q, cat));
    return sort === "freq"
      ? rows.sort((x, y) => y.months.length - x.months.length || lastMonth(y).localeCompare(lastMonth(x)))
      : rows.sort((x, y) => lastMonth(y).localeCompare(lastMonth(x)));
  }, [b, tache, month, q, cat, sort]);

  // writing sets hold all three tâches; the filters look at the selected one
  const inTache = (s: Subject) => kind === "speaking" || s.tache === tache;

  // month view: the sets (speaking: of this tâche)
  const sets = useMemo(() => {
    if (!b) return [];
    return b.sets
      .filter((s) => (kind === "writing" || s.tache === tache) && (!month || s.ym === month))
      .filter((s) => (!q && !cat) || s.subjects.some((id) => inTache(b.subject.get(id)!) && matches(b.subject.get(id)!, q, cat)))
      .sort((x, y) => y.ym.localeCompare(x.ym) || x.no - y.no);
  }, [b, kind, tache, month, q, cat]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    if (!b) return c;
    if (view === "dedupe") {
      for (const s of b.subjects) if (s.tache === tache && (!cat || s.cat === cat)) for (const m of s.months) c.set(m, (c.get(m) ?? 0) + 1);
    } else {
      for (const s of b.sets)
        if ((kind === "writing" || s.tache === tache) && (!cat || s.subjects.some((id) => b.subject.get(id)!.tache === tache && b.subject.get(id)!.cat === cat)))
          c.set(s.ym, (c.get(s.ym) ?? 0) + 1);
    }
    return c;
  }, [b, view, tache, kind, cat]);

  // topic chips: prompts of this tâche per topic, within the month and search filters
  const topicCounts = useMemo(() => {
    const c = new Map<TopicCat, number>();
    if (!b) return { c, total: 0, any: false };
    let total = 0;
    let any = false;
    for (const s of b.subjects) {
      any ||= Boolean(s.cat);
      if (s.tache !== tache || (month && !s.months.includes(month)) || !matches(s, q)) continue;
      total++;
      if (s.cat) c.set(s.cat, (c.get(s.cat) ?? 0) + 1);
    }
    return { c, total, any };
  }, [b, tache, month, q]);

  // the order the detail panel steps through: what the list shows
  const order = useMemo(() => {
    if (view === "dedupe") return subjects.map((s) => s.id);
    if (!b) return [];
    return [...new Set(sets.flatMap((s) => s.subjects.filter((id) => kind === "speaking" || b.subject.get(id)!.tache === tache)))];
  }, [view, subjects, sets, b, kind, tache]);

  if (data === undefined) return <PageShell><div className="py-20 text-center text-muted-foreground">加载题库…</div></PageShell>;
  if (!b) return <PageShell><div className="py-20 text-center text-muted-foreground">没有找到写作 / 口语数据。请运行 <code>npm run data</code>。</div></PageShell>;

  const info = TACHE_INFO[kind][tache];
  const idx = openId ? order.indexOf(openId) : -1;
  const open = (id: string | null) => set({ open: id });
  const random = () => {
    if (order.length) open(order[Math.floor(Math.random() * order.length)]);
  };
  const unit = view === "dedupe" ? "题" : kind === "writing" ? "套" : "组";
  const total = view === "dedupe" ? subjects.length : sets.length;

  return (
    <PageShell>
      <PageHeader
        back={{ to: p.path, label: KIND_ZH[kind] }}
        kicker={`${KIND_FR[kind]} · Tâche ${tache}`}
        kickerClass={p.text}
        title={`${KIND_ZH[kind]}题库`}
        description={`${info.zh} · ${info.limit}${info.note ? `（${info.note}）` : ""}。真题按考试月份整理。`}
        actions={
          <>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="搜索题目（法语或中文）" value={query} onChange={(e) => set({ q: e.target.value })} />
            </div>
            <Button className={cn("h-9", p.bg, "text-white hover:opacity-90")} onClick={random} disabled={!order.length}>
              <Shuffle /> 随机抽题
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={String(tache)} onValueChange={(v) => set({ t: v, open: null })}>
          <TabsList>
            {taches.map((t) => (
              <TabsTrigger key={t} value={String(t)} className="px-3">
                Tâche {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={view} onValueChange={(v) => set({ view: v === "month" ? "month" : null, open: null })}>
          <TabsList>
            <TabsTrigger value="dedupe" className="px-3">去重题库</TabsTrigger>
            <TabsTrigger value="month" className="px-3">月度真题</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "dedupe" && (
          <Tabs value={sort} onValueChange={(v) => set({ sort: v === "freq" ? "freq" : null })}>
            <TabsList>
              <TabsTrigger value="recent" className="px-3">最新</TabsTrigger>
              <TabsTrigger value="freq" className="px-3">出现次数</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {topicCounts.any && (
        <TopicChips counts={topicCounts.c} total={topicCounts.total} value={cat} onChange={(c) => set({ cat: c, open: null })} on={cn(p.bg, "border-transparent text-white")} />
      )}

      <div className="mb-5 rounded-2xl border bg-card px-4 pt-3 pb-2">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            每月{view === "dedupe" ? "题数" : kind === "writing" ? "套数" : "组数"}，点柱子筛选
          </span>
          {month && (
            <button type="button" className={cn("font-medium", p.text)} onClick={() => set({ m: null })}>
              清除 {fmtYm(month, true)} ✕
            </button>
          )}
        </div>
        <MonthBars months={b.months} counts={counts} selected={month} onSelect={(m) => set({ m })} barClass={p.bg} unit={unit} />
      </div>

      <div className="mb-3 text-sm text-muted-foreground">
        共 {total} {unit}
        {month && ` · ${fmtYm(month, true)}`}
        {cat && ` · ${TOPICS.find((t) => t.id === cat)!.zh}`}
        {query && ` · 搜索「${query}」`}
      </div>

      {view === "dedupe" && sort === "freq" && (
        <div className="flex flex-col gap-2">
          {subjects.map((s) => (
            <SubjectRow key={s.id} s={s} b={b} onOpen={() => open(s.id)} />
          ))}
        </div>
      )}

      {view === "dedupe" && sort === "recent" &&
        groupBy(subjects, lastMonth).map(([m, rows]) => (
          <section key={m} className="mb-6">
            <h2 className="mb-2 flex items-baseline gap-2 text-sm font-bold">
              {fmtYm(m, true)}
              <span className="font-normal text-muted-foreground">最近一次出现 · {rows.length} 题</span>
            </h2>
            <div className="flex flex-col gap-2">
              {rows.map((s) => (
                <SubjectRow key={s.id} s={s} b={b} onOpen={() => open(s.id)} />
              ))}
            </div>
          </section>
        ))}

      {view === "month" &&
        groupBy(sets, (s) => s.ym).map(([m, rows]) => (
          <section key={m} className="mb-6">
            <h2 className="mb-2 flex items-baseline gap-2 text-sm font-bold">
              {fmtYm(m, true)}
              <span className="font-normal text-muted-foreground">
                {rows.length} {unit}
              </span>
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {rows.map((s) => (
                <SetBlock key={s.id} set={s} b={b} tache={tache} hit={(x) => Boolean(q || cat) && inTache(x) && matches(x, q, cat)} onOpen={open} />
              ))}
            </div>
          </section>
        ))}

      {total === 0 && <div className="py-16 text-center text-muted-foreground">没有符合条件的题目。</div>}

      <TopicDetail
        bank={b}
        subjectId={openId}
        onOpen={(id) => open(id)}
        onClose={() => open(null)}
        onPrev={idx > 0 ? () => open(order[idx - 1]) : undefined}
        onNext={idx >= 0 && idx < order.length - 1 ? () => open(order[idx + 1]) : undefined}
        position={idx >= 0 ? `${idx + 1} / ${order.length}` : undefined}
      />
    </PageShell>
  );
}
