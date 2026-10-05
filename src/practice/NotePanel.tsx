import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import type { Question } from "../data/types";
import { saveNote } from "../db/progress";
import { db } from "../db/schema";

/**
 * Per-question note; saved 800 ms after typing stops, on blur and when the
 * panel unmounts. Empty text deletes it. Render with key={q.id}.
 */
export function NotePanel({ q }: { q: Question }) {
  // null = no note yet, undefined = still loading
  const note = useLiveQuery(() => db.notes.get(q.id).then((n) => n ?? null), [q.id]);
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (text === null && note !== undefined) setText(note?.text ?? "");
  }, [note, text]);

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) void saveNote(q, pending.current);
    pending.current = null;
  };
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-3.5" data-no-shortcuts="">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 font-semibold">
        <span>题目笔记</span>
        {note && <span className="text-xs font-normal text-muted-foreground">最后修改 {new Date(note.updatedAt).toLocaleString()}</span>}
      </div>
      <Textarea
        className="bg-card"
        rows={4}
        autoFocus
        placeholder="记下这道题的思路、生词、陷阱…"
        value={text ?? ""}
        disabled={text === null}
        onChange={(e) => {
          setText(e.target.value);
          pending.current = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, 800);
        }}
        onBlur={flush}
      />
    </div>
  );
}
