import { cn } from "@/lib/utils";
import { fmtYm } from "./data";

/** One bar per month (height = count); click a bar to filter by that month, click again to clear. */
export function MonthBars({
  months,
  counts,
  selected,
  onSelect,
  barClass,
  unit,
}: {
  months: string[];
  counts: Map<string, number>;
  selected: string | null;
  onSelect(m: string | null): void;
  barClass: string;
  unit: string;
}) {
  const max = Math.max(1, ...months.map((m) => counts.get(m) ?? 0));
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1 sm:gap-1.5">
      {months.map((m) => {
        const n = counts.get(m) ?? 0;
        const on = selected === m;
        return (
          <button
            key={m}
            type="button"
            title={`${fmtYm(m, true)} · ${n} ${unit}`}
            onClick={() => onSelect(on ? null : m)}
            className="group flex min-w-6 flex-1 flex-col items-center gap-1"
          >
            <span className={cn("text-[11px] tabular-nums text-muted-foreground", on && "font-semibold text-foreground")}>{n}</span>
            <span className="flex h-16 w-full items-end">
              <span
                className={cn(
                  "w-full rounded-md transition-opacity",
                  barClass,
                  selected && !on ? "opacity-25" : on ? "opacity-100" : "opacity-60 group-hover:opacity-90",
                )}
                style={{ height: `${Math.max(6, (n / max) * 100)}%` }}
              />
            </span>
            <span className={cn("text-[11px] whitespace-nowrap text-muted-foreground", on && "font-semibold text-foreground")}>
              {/* phones: month number only */}
              {Number(m.slice(5))}
              <span className="max-sm:hidden"> 月</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
