import { ChevronLeft, ChevronRight, Star, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LEVEL_TEXT } from "../components/parts";
import { LEVELS, type Level } from "../data/types";

export type CellStatus = "todo" | "selected" | "done" | "right" | "wrong";

export interface Cell {
  qid: string;
  no: number;
  status: CellStatus;
  current: boolean;
  fav: boolean;
  noted: boolean;
}

export interface Group {
  title: string;
  cells: Cell[];
  doneCount: number;
}

export type Filter = "all" | "todo" | "done" | "wrong" | "right";

interface Props {
  title: string;
  total: number;
  /** round timer; hidden when undefined */
  elapsedMs?: number;
  /** filter buttons with their counts; pressing the active one goes back to "all" */
  filters: { key: Filter; label: string; count: number }[];
  filter: Filter;
  onFilter(f: Filter): void;
  level?: Level;
  onLevel?(l: Level): void;
  groups: Group[];
  onPick(qid: string): void;
  /** submit button; none in review mode */
  submit?: { label: string; disabled: boolean; onClick(): void };
  collapsed: boolean;
  onCollapse(): void;
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const CELL: Record<CellStatus, string> = {
  todo: "",
  done: "bg-muted text-muted-foreground",
  selected: "border-primary bg-primary/10 text-primary",
  right: "border-correct bg-correct/10 text-correct",
  wrong: "border-wrong bg-wrong/10 text-wrong",
};

/** Classes of one numbered square of an answer grid (practice sidebar, exam, exam review). */
export function cellClass(status: CellStatus, current: boolean) {
  return cn(
    "relative aspect-square rounded-lg border bg-card text-[13px] tabular-nums transition-colors hover:border-primary/60",
    CELL[status],
    current && "font-bold outline-2 outline-offset-1 outline-primary",
  );
}

/** Answer grid of a round. On screens under 900 px wide it floats over the question. */
export function Sidebar(p: Props) {
  return (
    <aside
      className={cn(
        "sticky top-14 h-[calc(100vh-3.5rem)] w-[300px] shrink-0 border-r bg-card transition-[width] duration-200",
        "max-[900px]:fixed max-[900px]:left-0 max-[900px]:z-30 max-[900px]:shadow-xl",
        p.collapsed && "w-0 max-[900px]:shadow-none",
      )}
    >
      <button
        type="button"
        className="absolute top-[45%] -right-3.5 z-10 grid h-11 w-5.5 place-items-center rounded-md border bg-card text-muted-foreground shadow-sm hover:text-foreground max-[900px]:-right-6"
        title={p.collapsed ? "展开侧栏" : "收起侧栏"}
        onClick={p.onCollapse}
      >
        {p.collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
      </button>
      <div className={cn("flex h-full flex-col overflow-hidden p-3.5", p.collapsed && "invisible")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold">{p.title}</div>
            <div className="text-xs text-muted-foreground">共 {p.total} 道题目</div>
          </div>
          {p.elapsedMs !== undefined && (
            <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-sm font-semibold tabular-nums" title="本轮用时">
              <Timer className="size-3.5 text-muted-foreground" />
              {fmtElapsed(p.elapsedMs)}
            </div>
          )}
        </div>
        <div className={cn("my-3 grid gap-2", p.filters.length > 2 ? "grid-cols-4 gap-1.5" : "grid-cols-2")}>
          {p.filters.map((f) => {
            const on = p.filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                className={cn(
                  "flex flex-col items-center rounded-xl border px-1 py-1.5 transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                )}
                onClick={() => p.onFilter(on ? "all" : f.key)}
              >
                <b className={cn("font-extrabold tabular-nums", p.filters.length > 2 ? "text-lg" : "text-xl")}>{f.count}</b>
                <span className={cn("text-xs", !on && "text-muted-foreground")}>{f.label}</span>
              </button>
            );
          })}
        </div>
        {p.level && p.onLevel && (
          <div className="mb-2 grid grid-cols-6 gap-0.5 rounded-lg bg-muted p-[3px]">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={cn("rounded-md py-1 text-xs font-extrabold", LEVEL_TEXT[l], p.level === l ? "bg-card shadow-sm" : "opacity-80 hover:opacity-100")}
                onClick={() => p.onLevel!(l)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
          {p.groups.map((g) => (
            <section key={g.title || "all"}>
              {g.title && (
                <div className="mt-2.5 mb-1.5 flex justify-between text-[13px] font-semibold">
                  <span>{g.title}</span>
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {g.doneCount}/{g.cells.length}
                  </span>
                </div>
              )}
              <div className={cn("grid grid-cols-6 gap-1.5", !g.title && "pt-1")}>
                {g.cells.map((c) => (
                  <button
                    key={c.qid}
                    type="button"
                    className={cellClass(c.status, c.current)}
                    onClick={() => p.onPick(c.qid)}
                    title={c.qid}
                  >
                    {c.no}
                    {c.fav && <Star className="absolute top-0.5 right-0.5 size-2.5 fill-amber-400 text-amber-400" />}
                    {c.noted && <i className="absolute bottom-[3px] left-1/2 size-1 -translate-x-1/2 rounded-full bg-amber-500" />}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {p.groups.every((g) => g.cells.length === 0) && <div className="py-5 text-center text-xs text-muted-foreground">没有符合筛选的题目</div>}
        </div>
        {p.submit && (
          <Button size="lg" className="mt-2.5 w-full" disabled={p.submit.disabled} onClick={p.submit.onClick}>
            {p.submit.label}
          </Button>
        )}
      </div>
    </aside>
  );
}
