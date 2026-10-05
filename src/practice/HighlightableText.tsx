import type { EvidenceRange, SentenceRange } from "../data/p2";
import { locate } from "../db/highlights";
import type { Highlight, HighlightField } from "../db/schema";
import { cutPieces } from "./pieces";

interface Props {
  text: string;
  field: HighlightField;
  index: number;
  highlights: Highlight[];
  hidden: boolean;
  onOpen(id: string): void;
  as?: "p" | "span" | "div";
  className?: string;
  /** P2 sentence pieces in this block (hover translation) */
  sentences?: SentenceRange[];
  /** P2 answer evidence in this block, shown once the answer is revealed */
  evidence?: EvidenceRange[];
}

/**
 * A block of question text that can carry highlights and P2 marks. The rendered
 * text is exactly `text` (letter badges are CSS ::after content, which is not part
 * of the DOM text), so DOM character offsets equal offsets in the data.
 */
export function HighlightableText({ text, field, index, highlights, hidden, onOpen, as = "span", className, sentences, evidence }: Props) {
  const Tag = as;
  const hls = hidden
    ? []
    : highlights
        .filter((h) => h.field === field && h.index === index)
        .map((h) => ({ id: h.id, h, r: locate(h, text) }))
        .filter((x): x is { id: string; h: Highlight; r: { start: number; end: number } } => x.r !== null);
  const byId = new Map(hls.map((x) => [x.id, x.h]));

  const parts = cutPieces(text.length, hls, sentences, evidence).map((p) => {
    const content = text.slice(p.s, p.e);
    const cls: string[] = [];
    if (p.ev) cls.push("ev-" + p.ev);
    if (p.evEnd) cls.push("ev-end", p.evEndAnswer ? "ev-end-answer" : "ev-end-trap");
    const attrs = {
      "data-sid": p.sid,
      "data-ev-end": p.evEnd,
    };
    if (p.hl) {
      const h = byId.get(p.hl)!;
      return (
        <mark
          key={p.s}
          {...attrs}
          className={["hl", h.note ? "hl-note" : "", ...cls].filter(Boolean).join(" ")}
          data-hl-id={h.id}
          title={h.note || undefined}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(h.id);
          }}
        >
          {content}
        </mark>
      );
    }
    if (p.sid === undefined && !cls.length) return content;
    return (
      <span key={p.s} {...attrs} className={cls.join(" ") || undefined}>
        {content}
      </span>
    );
  });

  return (
    <Tag className={className} data-hl-block="" data-hl-field={field} data-hl-index={index}>
      {parts}
    </Tag>
  );
}
