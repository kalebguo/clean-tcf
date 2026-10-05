import { Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ConjHint, WordBrief, WordHead, WordMeanings } from "../components/WordCard";
import { lookupInContext, lookupSelection, useDict, type DictEntry } from "../data/dict";
import { addWord, removeWord, useVocab } from "../db/vocab";
import { BUBBLE } from "./HighlightBubble";

export interface DictQuery {
  /** the word double-clicked, or the selected text ("查词") */
  text: string;
  multi: boolean;
  rect: DOMRect;
  qid: string;
  context?: string;
  /** the word just before it in the text, to tell "une annonce" from "il annonce" */
  prev?: string;
}

/** The word before the selection inside its text block. */
export function prevWordOf(sel: Selection | null): string | undefined {
  if (!sel?.rangeCount) return undefined;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const block = (node instanceof Element ? node : node.parentElement)?.closest("[data-hl-block]");
  if (!block) return undefined;
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  // "l'annonce": the elided article is glued to the word
  const m = before.toString().match(/([\p{L}]+['’]|[\p{L}]+)\s*$/u);
  return m?.[1];
}

/** The sentence around a selection, as context for the vocabulary book. */
export function contextOf(sel: Selection | null): string | undefined {
  const node = sel?.anchorNode;
  const block = (node instanceof Element ? node : node?.parentElement)?.closest("[data-hl-block]");
  const text = block?.textContent?.trim();
  const word = sel?.toString().trim();
  if (!text || !word) return undefined;
  const sentence = text.split(/(?<=[.!?…])\s+/).find((s) => s.includes(word)) ?? text;
  return sentence.length > 220 ? sentence.slice(0, 217) + "…" : sentence;
}

/** Bubble dictionary (SPEC-P2 §7.4): meanings in Chinese / English / French, pronunciation, add to the vocabulary book. */
export function DictBubble({ query, onClose }: { query: DictQuery; onClose(): void }) {
  const dict = useDict();
  const vocab = useVocab();
  const box = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState(0);
  const hits: DictEntry[] = dict ? (query.multi ? lookupSelection(dict, query.text) : lookupInContext(dict, query.text, query.prev)) : [];
  const e = hits[Math.min(pick, hits.length - 1)];

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const width = 340;
  const below = query.rect.bottom + 260 < window.innerHeight;
  const style = {
    left: Math.max(8, Math.min(window.innerWidth - width - 8, query.rect.left)),
    ...(below ? { top: query.rect.bottom + 8 } : { bottom: window.innerHeight - query.rect.top + 8 }),
  };

  return (
    <div className={BUBBLE + " w-[340px] max-w-[calc(100vw-16px)]"} ref={box} style={style} data-no-shortcuts="">
      {dict === undefined && <div className="text-sm text-muted-foreground">加载词典…</div>}
      {dict === null && <div className="text-sm text-muted-foreground">还没有词典数据（运行 npm run p2）。</div>}
      {dict && !e && <div className="text-sm text-muted-foreground">词库里没有“{query.text.slice(0, 30)}”。</div>}
      {e && (
        <>
          <WordHead e={e} />
          {!query.multi && <ConjHint e={e} word={query.text} />}
          <WordBrief e={e} />
          {hits.length > 1 && (
            <div className="text-xs text-muted-foreground">
              也可能是：
              {hits.map((h, i) =>
                i === pick ? null : (
                  <button key={h.lemma + h.pos} type="button" className="px-1 text-primary hover:underline" onClick={() => setPick(i)}>
                    {h.lemma}（{h.posLabel}）
                  </button>
                ),
              )}
            </div>
          )}
          <WordMeanings e={e} compact />
          <div className="mt-2 flex items-center gap-2">
            {vocab.has(e.lemma) ? (
              <Button variant="ghost" size="sm" className="text-amber-600" onClick={() => void removeWord(e.lemma)}>
                <Star className="fill-current" /> 已在生词本（移除）
              </Button>
            ) : (
              <Button size="sm" onClick={() => void addWord(e.lemma, { qid: query.qid, context: query.context })}>
                <Star /> 加入生词本
              </Button>
            )}
            <span className="flex-1" />
            <Link className="text-[13px] text-primary hover:underline" to={`/vocab?q=${encodeURIComponent(e.lemma)}`}>
              在单词本查看
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
