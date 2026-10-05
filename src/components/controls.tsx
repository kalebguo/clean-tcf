import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LEVELS, type Level } from "../data/types";
import { LEVEL_TEXT } from "./parts";

/** Segmented control: one of a few options. */
export function Seg<T extends string>({ value, onChange, options, className }: { value: T; onChange(v: T): void; options: [T, ReactNode][]; className?: string }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <TabsList>
        {options.map(([v, label]) => (
          <TabsTrigger key={v} value={v} className="px-3">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** Drop-down filter. */
export function Pick<T extends string>({ value, onChange, options, label, className }: { value: T; onChange(v: T): void; options: [T, ReactNode][]; label: string; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger aria-label={label} className={cn("bg-card", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Row of chips; `null` is the "all" chip. Clicking the active chip again goes back to "all". */
export function Chips<T extends string>({ value, onChange, options }: { value: T | null; onChange(v: T | null): void; options: [T | null, ReactNode][] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <button
            key={v ?? "*"}
            type="button"
            onClick={() => onChange(on ? null : v)}
            className={cn(
              "h-7 rounded-full border px-3 text-[13px] transition-colors",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function LevelTag({ level, className }: { level: Level; className?: string }) {
  return <span className={cn("text-xs font-extrabold tracking-wide", LEVEL_TEXT[level], className)}>{level}</span>;
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed px-4 py-14 text-center text-sm leading-relaxed text-muted-foreground">{children}</div>;
}

/** Classes of a clickable list row (question lists). */
export const ROW = "flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40";

/** Search match inside a snippet. */
export const MARK = "rounded-sm bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/25";

export const SECTION_OPTIONS: ["ALL" | "CO" | "CE", string][] = [
  ["ALL", "听力 + 阅读"],
  ["CO", "听力"],
  ["CE", "阅读"],
];

export const LEVEL_OPTIONS: ["ALL" | Level, string][] = [["ALL", "全部难度"], ...LEVELS.map((l): [Level, string] => [l, l])];

/** Classes of a native <select>: used where keyboard shortcuts are on, because they skip native selects. */
export const NATIVE_SELECT = "h-8 rounded-lg border bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Row of number tiles (results of a round, an exam, a flashcard session). */
export function StatTiles({ items, className }: { items: [ReactNode, string][]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-2", className)}>
      {items.map(([v, label]) => (
        <div key={label} className="rounded-xl bg-muted/60 px-1 py-2.5 text-center">
          <div className="text-xl font-extrabold tabular-nums">{v}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

/** One-line notice above a question or a card. */
export function Banner({ tone = "info", children, className }: { tone?: "info" | "warn"; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5 text-sm",
        tone === "warn" ? "bg-wrong/10 text-wrong" : "bg-primary/10 text-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** "答案有争议" label; a button when it opens the analysis. */
export function DisputedBadge({ onClick }: { onClick?(): void }) {
  const cls = "inline-flex h-5 items-center rounded-full border border-amber-500/50 bg-amber-100 px-2 text-[11.5px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
  return onClick ? (
    <button type="button" className={cn(cls, "hover:bg-amber-200 dark:hover:bg-amber-500/25")} onClick={onClick} title="解析或 AI 复核对标准答案有不同意见，点击查看">
      答案有争议
    </button>
  ) : (
    <span className={cls}>答案有争议</span>
  );
}

/** White card with a title row; the building block of the progress, exam and flashcard pages. */
export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title && <h2 className="font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
