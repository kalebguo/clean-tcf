import { Pause, Play, Search as SearchIcon, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "../components/AppShell";
import { EmptyState, LevelTag, LEVEL_OPTIONS, MARK, Pick, ROW, SECTION_OPTIONS, Toolbar } from "../components/controls";
import { displayNo, useBanks, type Banks } from "../data/bank";
import type { Question } from "../data/types";
import { toggleFavorite, useFavorites, useQStates } from "../db/progress";
import { db, type QState } from "../db/schema";
import { getEngine, type SearchHit } from "../search/engine";
import { Loading } from "./common";

export interface SearchFilters {
  section: string; // ALL | CO | CE
  level: string; // ALL | A1…
  status: string; // all | todo | done | wrong | fav
}

function passes(q: Question, f: SearchFilters, st: QState | undefined, fav: boolean) {
  if (f.section !== "ALL" && q.section !== f.section) return false;
  if (f.level !== "ALL" && q.level !== f.level) return false;
  switch (f.status) {
    case "todo": return !st?.attempts;
    case "done": return Boolean(st?.attempts);
    case "wrong": return st?.wrong === "open" || st?.wrong === "fixed";
    case "fav": return fav;
  }
  return true;
}

async function runSearch(banks: Banks, query: string, f: SearchFilters): Promise<SearchHit[]> {
  const engine = await getEngine(banks);
  const [states, favs] = await Promise.all([db.qstate.toArray(), db.favorites.toArray()]);
  const sm = new Map(states.map((s) => [s.qid, s]));
  const fm = new Set(favs.map((x) => x.qid));
  return engine.search(query).filter((h) => passes(h.q, f, sm.get(h.q.id), fm.has(h.q.id)));
}

export async function searchQids(banks: Banks, query: string, f: SearchFilters): Promise<string[]> {
  return (await runSearch(banks, query, f)).map((h) => h.q.id);
}

export function Search() {
  const banks = useBanks();
  const states = useQStates();
  const favorites = useFavorites();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(sp.get("q") ?? "");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);

  const query = sp.get("q") ?? "";
  const f: SearchFilters = { section: sp.get("section") ?? "ALL", level: sp.get("level") ?? "ALL", status: sp.get("status") ?? "all" };

  useEffect(() => {
    document.title = query ? `搜索：${query} · TCF` : "搜索 · TCF";
  }, [query]);

  // debounce typing into the URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (input !== query) {
        const n = new URLSearchParams(sp);
        n.set("q", input);
        setSp(n, { replace: true });
      }
    }, 150);
    return () => clearTimeout(t);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!banks) return;
    let cancelled = false;
    const t0 = performance.now();
    runSearch(banks, query, f).then((h) => {
      if (cancelled) return;
      setHits(h);
      setMs(Math.round(performance.now() - t0));
    });
    return () => {
      cancelled = true;
    };
  }, [banks, query, f.section, f.level, f.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!banks) return <Loading />;
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const practiceUrl = (start?: string) => {
    const n = new URLSearchParams(sp);
    if (start) n.set("start", start);
    return `/search/practice?${n.toString()}`;
  };

  const play = (q: Question) => {
    const a = player.current!;
    if (playing === q.id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = `/media/${q.audio}`;
    void a.play();
    setPlaying(q.id);
  };

  return (
    <PageShell>
      <audio ref={player} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />
      <PageHeader
        title="搜索题目"
        description="单词、短语、原形或题号。结果可以直接开始练习。"
        actions={
          <Button disabled={!hits?.length} onClick={() => navigate(practiceUrl())}>
            <Play /> 练习这些题
          </Button>
        }
      />
      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          className="h-12 rounded-xl bg-card pl-11 text-base md:text-base"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`单词、短语（"à cause de"）、原形（aller）、题号（5-8、155-8、听力 12）`}
        />
      </div>
      <Toolbar>
        <Pick label="部分" value={f.section} onChange={(v) => set("section", v)} options={SECTION_OPTIONS} />
        <Pick label="难度" value={f.level} onChange={(v) => set("level", v)} options={LEVEL_OPTIONS} />
        <Pick
          label="状态"
          value={f.status}
          onChange={(v) => set("status", v)}
          options={[
            ["all", "全部状态"],
            ["todo", "未做"],
            ["done", "已做"],
            ["wrong", "错题"],
            ["fav", "收藏"],
          ]}
        />
        <span className="text-xs text-muted-foreground">{hits ? `${hits.length} 条结果 · ${ms}ms` : "建立索引…"}</span>
      </Toolbar>
      <div className="grid gap-2">
        {(hits ?? []).map(({ q, snippet }) => {
          const st = states.get(q.id);
          const fav = favorites.has(q.id);
          return (
            <div key={q.id} role="link" tabIndex={0} className={cn(ROW, "cursor-pointer")} onClick={() => navigate(practiceUrl(q.id))}>
              {q.audio ? (
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="rounded-full"
                  title="播放音频"
                  onClick={(e) => {
                    e.stopPropagation();
                    play(q);
                  }}
                >
                  {playing === q.id ? <Pause className="fill-current" /> : <Play className="fill-current" />}
                </Button>
              ) : (
                <span className="size-7 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <LevelTag level={q.level} />
                  <b className="text-sm">{displayNo(q)}</b>
                  {st?.attempts ? <Badge variant="secondary">已做</Badge> : null}
                  {st?.wrong === "open" && <Badge className="bg-wrong/10 text-wrong">错题</Badge>}
                </div>
                {snippet && (
                  <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
                    {snippet.before}
                    {snippet.match && <mark className={MARK}>{snippet.match}</mark>}
                    {snippet.after}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title={fav ? "取消收藏" : "收藏"}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleFavorite(q);
                }}
              >
                <Star className={cn(fav && "fill-amber-400 text-amber-400")} />
              </Button>
            </div>
          );
        })}
        {hits && query && hits.length === 0 && <EmptyState>没有找到。试试原形（aller）、去掉重音，或题号 5-8。</EmptyState>}
      </div>
    </PageShell>
  );
}
