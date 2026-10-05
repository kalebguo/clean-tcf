import { ChevronLeft, Languages, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useConj } from "../data/conj";
import { briefOf, useDict, type DictEntry } from "../data/dict";
import { searchDict } from "../data/dictSearch";
import { addWord, removeWord, useVocab } from "../db/vocab";
import { LevelTag } from "./controls";
import { ConjHint, WordBrief, WordHead, WordMeanings } from "./WordCard";

/**
 * Dictionary panel in the lower right corner, opened from the top bar: type a French word
 * (any form, accents optional) or a Chinese one, pick a result, add it to the vocabulary book.
 * It does not block the page, so the question stays readable while looking up words.
 */
export function DictPanel({ onClose }: { onClose(): void }) {
  const dict = useDict();
  const conj = useConj();
  const vocab = useVocab();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<DictEntry | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (dict ? searchDict(dict, conj, q) : []), [dict, conj, q]);
  const e = picked ?? (hits.length === 1 ? hits[0] : null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setPicked(null), [q]);

  const note = "text-[13px] text-muted-foreground";
  return (
    <div
      data-no-shortcuts=""
      className="fixed right-4 bottom-4 z-[46] flex max-h-[min(560px,calc(100vh-96px))] w-[360px] flex-col rounded-2xl border bg-popover p-3 text-popover-foreground shadow-[0_12px_40px_rgb(16_24_40/0.18)] max-md:inset-x-2 max-md:bottom-[68px] max-md:w-auto"
      onKeyDown={(ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          if (picked) setPicked(null);
          else onClose();
        }
      }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Languages className="size-3.5" /> 查词
        <span className="flex-1" />
        <Button variant="ghost" size="icon-xs" title="关闭" onClick={onClose}>
          <X />
        </Button>
      </div>
      <input
        ref={input}
        className="w-full border-b bg-transparent px-0.5 py-1.5 font-serif text-[17px] outline-none focus:border-primary"
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        onKeyDown={(ev) => ev.key === "Enter" && hits[0] && setPicked(hits[0])}
        placeholder="bonjour / allions / 你好"
      />
      <div className="min-h-0 overflow-y-auto pt-2">
        {dict === undefined && <div className={note}>加载词典…</div>}
        {dict === null && <div className={note}>还没有词典数据（运行 npm run p2）。</div>}
        {dict && q.trim() && !hits.length && <div className={note}>词库里没有找到“{q.trim()}”。</div>}
        {e ? (
          <div>
            {picked && hits.length > 1 && (
              <button type="button" className="mb-1 flex items-center text-[13px] text-primary hover:underline" onClick={() => setPicked(null)}>
                <ChevronLeft className="size-3.5" /> 返回结果
              </button>
            )}
            <WordHead e={e}>
              <span className="flex-1" />
              <LevelTag level={e.level} />
            </WordHead>
            <ConjHint e={e} word={q} />
            <WordBrief e={e} />
            <WordMeanings e={e} compact />
            <div className="mt-2 flex items-center gap-2">
              {vocab.has(e.lemma) ? (
                <Button variant="ghost" size="sm" className="text-amber-600" onClick={() => void removeWord(e.lemma)}>
                  <Star className="fill-current" /> 已在生词本（移除）
                </Button>
              ) : (
                <Button size="sm" onClick={() => void addWord(e.lemma)}>
                  <Star /> 加入生词本
                </Button>
              )}
              <span className="flex-1" />
              <Link className="text-[13px] text-primary hover:underline" to={`/vocab?q=${encodeURIComponent(e.lemma)}`}>
                在单词本查看
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-0.5">
            {hits.map((h) => (
              <button
                key={h.lemma + h.pos}
                type="button"
                className="flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-muted"
                onClick={() => setPicked(h)}
              >
                <b className="font-serif">{h.lemma}</b>
                <span className="text-xs text-muted-foreground">{h.posLabel}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{briefOf(h)?.text ?? ""}</span>
                <LevelTag level={h.level} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
