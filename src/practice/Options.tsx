import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isPictureItem } from "../data/bank";
import { LETTERS, type Letter, type Question } from "../data/types";
import type { Highlight } from "../db/schema";
import { HighlightableText } from "./HighlightableText";
import { originalLetter } from "./shuffle";

interface Props {
  q: Question;
  order: number[];
  choice?: Letter;
  /** show which option is correct */
  revealAnswer: boolean;
  /** color the chosen option green / red */
  judgeChoice: boolean;
  highlights: Highlight[];
  hideHighlights: boolean;
  /** P2 option translations in original A–D order, when they should be shown */
  translations?: (string | null)[];
  disabled?: boolean;
  onChoose(original: Letter): void;
  onChooseAndNext(original: Letter): void;
  onOpenHighlight(id: string): void;
}

const TONE = {
  chosen: "border-l-primary bg-primary/10",
  correct: "border-l-correct bg-correct/10 text-correct",
  wrong: "border-l-wrong bg-wrong/10 text-wrong",
};

export function Options(p: Props) {
  const picture = isPictureItem(p.q);
  const shuffled = p.order.some((v, i) => v !== i);
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card" role="radiogroup">
      {p.order.map((orig, pos) => {
        const letter = LETTERS[pos];
        const original = originalLetter(p.order, pos);
        const chosen = p.choice === original;
        const isAnswer = original === p.q.answer;
        const judged = (p.revealAnswer || p.judgeChoice) && chosen;
        let tone: keyof typeof TONE | null = chosen ? "chosen" : null;
        if (p.revealAnswer && isAnswer) tone = "correct";
        if (judged) tone = isAnswer ? "correct" : "wrong";
        const Mark = isAnswer ? Check : X;
        return (
          <div
            key={orig}
            role="radio"
            aria-checked={chosen}
            className={cn(
              "flex cursor-pointer items-center gap-3.5 border-l-4 border-l-transparent px-3.5 py-3 font-serif text-[16.5px] transition-colors hover:bg-muted/60 md:px-4.5 md:py-3.5 md:text-lg",
              tone && TONE[tone],
              p.revealAnswer && !isAnswer && !chosen && "opacity-75",
            )}
            onClick={() => {
              if (p.disabled) return;
              if (window.getSelection()?.toString()) return; // dragging to copy text is not a click
              p.onChoose(original);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!p.disabled) p.onChooseAndNext(original);
            }}
          >
            <span className={cn("box-content w-[22px] shrink-0 border-r pr-3 font-sans font-bold", tone === "chosen" ? "text-primary" : !tone && "text-muted-foreground")}>
              {letter}
            </span>
            <span className="flex-1">
              {picture ? (
                `Proposition ${letter}`
              ) : (
                <HighlightableText
                  text={p.q.options[orig]}
                  field="option"
                  index={orig}
                  highlights={p.highlights}
                  hidden={p.hideHighlights}
                  onOpen={p.onOpenHighlight}
                />
              )}
              {p.translations?.[orig] && <small className="mt-0.5 block font-sans text-[13px] text-muted-foreground">{p.translations[orig]}</small>}
            </span>
            {shuffled && p.revealAnswer && <span className="font-sans text-xs whitespace-nowrap text-muted-foreground">原题 {original}</span>}
            {(judged || (p.revealAnswer && isAnswer)) && <Mark className="size-5 shrink-0" strokeWidth={2.5} />}
          </div>
        );
      })}
    </div>
  );
}
