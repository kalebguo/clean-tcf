import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteHighlight, updateHighlightNote } from "../db/highlights";
import { db } from "../db/schema";

/** Classes of the floating boxes over the question (highlight note, bubble dictionary). */
export const BUBBLE = "fixed z-[45] rounded-xl border bg-popover p-2.5 text-popover-foreground shadow-[0_12px_40px_rgb(16_24_40/0.18)]";

/** Note editor for one highlight, floating under its <mark>. Enter saves, Shift+Enter breaks a line. */
export function HighlightBubble({ id, onClose }: { id: string; onClose(): void }) {
  const h = useLiveQuery(() => db.highlights.get(id), [id]);
  const [text, setText] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (h && text === null) setText(h.note);
  }, [h, text]);

  useLayoutEffect(() => {
    const place = () => {
      const el = document.querySelector(`[data-hl-id="${id}"]`);
      if (!el) return setPos(null);
      const r = el.getBoundingClientRect();
      const width = 320;
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(window.innerWidth - width - 8, r.left)) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [id, h]);

  useEffect(() => {
    area.current?.focus();
  }, [pos !== null]);

  const save = async () => {
    if (h && text !== null && text !== h.note) await updateHighlightNote(id, text);
    onClose();
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) void save();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  if (!h || !pos) return null;
  return (
    <div className={BUBBLE + " w-80"} ref={box} style={{ top: pos.top, left: pos.left }} data-no-shortcuts="">
      <div className="mb-1.5 max-h-[60px] overflow-hidden font-serif text-sm text-muted-foreground">“{h.text}”</div>
      <Textarea
        ref={area}
        rows={3}
        placeholder="写点笔记…（回车保存，Shift+回车换行）"
        value={text ?? ""}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div className="mt-1.5 flex items-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={async () => {
            await deleteHighlight(id);
            onClose();
          }}
        >
          <Trash2 /> 删除高亮
        </Button>
        <span className="flex-1" />
        <Button size="sm" onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  );
}
