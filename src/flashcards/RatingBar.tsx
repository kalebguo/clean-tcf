import { AlarmClock, ChevronRight } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtInterval, GRADE_LABEL, GRADES, previewDue, type Grade } from "../db/cards";
import type { FlashCard } from "../db/schema";

interface Props {
  card: FlashCard;
  /** front: not answered yet; rate: free rating; forced: rated "again" already */
  state: "front" | "rate" | "forced";
  forced: FlashCard | null;
  hint: string;
  onRate(g: Grade): void;
  onPostpone(): void;
  extra?: ReactNode;
}

const GRADE_CLASS: Record<Grade, string> = {
  1: "bg-wrong text-white hover:bg-wrong/85",
  2: "bg-amber-600 text-white hover:bg-amber-600/85",
  3: "",
  4: "bg-sky-700 text-white hover:bg-sky-700/85",
};

/** Bottom bar of a card: postpone before answering; afterwards the four ratings with their next interval. */
export function RatingBar({ card, state, forced, hint, onRate, onPostpone, extra }: Props) {
  const due = useMemo(() => (state === "rate" ? previewDue(card, Date.now()) : null), [card, state]);
  return (
    <footer className="sticky bottom-0 mx-auto flex w-full max-w-[900px] flex-wrap items-center gap-2.5 bg-linear-to-t from-background from-75% to-transparent pt-4 pb-3">
      {state === "front" && (
        <>
          <span className="text-xs text-muted-foreground">{hint}</span>
          <span className="flex-1" />
          {extra}
          <Button variant="outline" size="lg" title="明天再出现，不算错（S）" onClick={onPostpone}>
            <AlarmClock /> 推迟到明天（S）
          </Button>
        </>
      )}
      {state === "forced" && (
        <>
          <span className="text-sm font-semibold text-wrong">
            已记为「重来」{forced && `，${fmtInterval(forced.due - Date.now())}后再出现`}。
          </span>
          <span className="flex-1" />
          {extra}
          <Button size="lg" onClick={() => onRate(1)}>
            下一张（Enter） <ChevronRight />
          </Button>
        </>
      )}
      {state === "rate" && due && (
        <>
          {extra}
          <span className="flex-1" />
          <div className="flex gap-2 max-sm:w-full">
            {GRADES.map((g) => (
              <Button
                key={g}
                className={cn("h-auto min-w-[76px] flex-col gap-0 px-3 py-1.5 leading-tight max-sm:min-w-0 max-sm:flex-1", GRADE_CLASS[g])}
                onClick={() => onRate(g)}
                title={`快捷键 ${g}${g === 3 ? " 或 Enter" : ""}`}
              >
                <b>{GRADE_LABEL[g]}</b>
                <span className="text-xs font-normal opacity-85">{fmtInterval(due[g] - Date.now())}</span>
              </Button>
            ))}
          </div>
        </>
      )}
    </footer>
  );
}
