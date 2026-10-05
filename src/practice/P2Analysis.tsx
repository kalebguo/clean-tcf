import { Check, Flag, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DisputedBadge, NATIVE_SELECT } from "../components/controls";
import type { P2Question } from "../data/p2";
import { LETTERS, type Question } from "../data/types";
import { db, type P2FlagKind } from "../db/schema";
import { displayLetter } from "./shuffle";

const FLAG_KINDS: [P2FlagKind, string][] = [
  ["analysis", "解析有误"],
  ["translation", "译文有误"],
  ["evidence", "出处不对"],
  ["answer", "标准答案有误"],
  ["other", "其他"],
];

/** Classes for the HTML analyses of the Anki decks (div, br, b, u). */
export const ANALYSIS_HTML = "leading-[1.8] [&_div]:mb-1";

function ReportForm({ qid, onDone }: { qid: string; onDone(msg: string): void }) {
  const [kind, setKind] = useState<P2FlagKind>("analysis");
  const [note, setNote] = useState("");
  return (
    <form
      className="mt-1.5 grid gap-1.5"
      data-no-shortcuts=""
      onSubmit={async (e) => {
        e.preventDefault();
        await db.p2flags.add({ qid, kind, note: note.trim(), createdAt: Date.now() });
        onDone("已记录。可以在「数据备份」页只导出报错记录。");
      }}
    >
      <select className={cn(NATIVE_SELECT, "justify-self-start")} value={kind} onChange={(e) => setKind(e.target.value as P2FlagKind)}>
        {FLAG_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <Textarea rows={2} autoFocus placeholder="哪里不对？（可以不填）" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone("")}>取消</Button>
        <Button size="sm">提交</Button>
      </div>
    </form>
  );
}

/** Answer analysis panel: per-option AI analysis when the question has P2 content, else the P1 human analysis. */
export function AnalysisPanel({ q, p2, order }: { q: Question; p2: P2Question | null; order: number[] }) {
  const [reporting, setReporting] = useState(false);
  const [msg, setMsg] = useState("");
  const shown = displayLetter(order, q.answer);
  const shuffled = order.some((v, i) => v !== i);
  const an = p2?.analysis;
  const doubt = p2?.check && !p2.check.agree;

  return (
    <div className="mt-3.5 rounded-xl border bg-card px-4 py-3.5 md:px-4.5">
      <div className="mb-2 flex flex-wrap items-center gap-2 font-semibold">
        <span>
          正确答案：<b className="text-correct">{shown}</b>
        </span>
        {shown !== q.answer && <span className="font-normal text-muted-foreground">（原题 {q.answer}）</span>}
        {(q.disputed || doubt) && <DisputedBadge />}
      </div>
      {!an ? (
        q.analysis ? <div className={ANALYSIS_HTML} dangerouslySetInnerHTML={{ __html: q.analysis }} /> : <div className="text-muted-foreground">暂无解析</div>
      ) : (
        <>
          <p className="mb-2.5 leading-[1.75]">{an.summary}</p>
          <div>
            {order.map((orig, pos) => {
              const original = LETTERS[orig];
              const item = an.options[original];
              const Mark = item.correct ? Check : X;
              return (
                <div key={original} className="flex items-baseline gap-2.5 border-t py-1.5 leading-[1.7]">
                  <span className={cn("min-w-[22px] font-bold", item.correct ? "text-correct" : "text-muted-foreground")}>
                    {LETTERS[pos]}
                    {shuffled && <small className="block text-[11px] font-normal">原{original}</small>}
                  </span>
                  <Mark className={cn("size-4 shrink-0 translate-y-0.5", item.correct ? "text-correct" : "text-wrong")} strokeWidth={2.75} />
                  <span className="flex-1">{item.why}</span>
                </div>
              );
            })}
          </div>
          {doubt && (
            <div className="mt-2.5 rounded-lg bg-amber-100 px-3 py-2 leading-[1.7] text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              <b>AI 复核：</b>认为标准答案可能有误。{p2!.check!.note}
            </div>
          )}
          {q.analysis && (
            <details className="mt-2.5 border-t pt-2">
              <summary className="cursor-pointer text-muted-foreground">原有解析</summary>
              <div className={cn(ANALYSIS_HTML, "mt-1")} dangerouslySetInnerHTML={{ __html: q.analysis }} />
            </details>
          )}
          <div className="mt-2.5 flex items-center text-[12.5px] text-muted-foreground">
            <span>{p2!.reviewed ? "AI 生成，已人工复核" : "AI 生成，可能有误"}</span>
            <span className="flex-1" />
            {!reporting && (
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => { setReporting(true); setMsg(""); }}>
                <Flag /> 报错
              </Button>
            )}
          </div>
          {reporting && (
            <ReportForm
              qid={q.id}
              onDone={(m) => {
                setReporting(false);
                setMsg(m);
              }}
            />
          )}
          {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
        </>
      )}
    </div>
  );
}
