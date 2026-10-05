import { ChevronLeft, ChevronRight, Mic, PenLine } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { PARTS } from "../components/parts";
import { fmtYm, TACHE_INFO, TOPIC, type OralBank, type OralSet, type Subject, type TopicCat } from "./data";

/** Small label with the topic's icon and name. */
export function TopicTag({ cat, className }: { cat: TopicCat; className?: string }) {
  const t = TOPIC.get(cat);
  if (!t) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground", className)}>
      <t.icon className="size-3" />
      {t.zh}
    </span>
  );
}

function Prompt({ s, kind }: { s: Subject; kind: OralBank["kind"] }) {
  if (kind === "writing" && s.tache === 3 && s.docs) {
    return (
      <div className="flex flex-col gap-3">
        <div className="font-serif text-xl leading-snug font-semibold">{s.intro}</div>
        {s.docs.map((d, i) => (
          <div key={i} className="rounded-xl border bg-muted/40 p-4">
            <div className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Document {i + 1}</div>
            <p className="font-serif text-[16px] leading-relaxed whitespace-pre-line">{d}</p>
          </div>
        ))}
      </div>
    );
  }
  return <p className="font-serif text-[17px] leading-relaxed whitespace-pre-line">{s.text}</p>;
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function setLabel(b: OralBank, set: OralSet): string {
  return `${fmtYm(set.ym, true)} · ${b.kind === "writing" ? `第 ${set.no} 套` : `组合 ${set.no}`}`;
}

/** The other prompts that came with this one: the whole writing set, or the speaking combinaison. */
function SetCard({ b, set, current, onOpen }: { b: OralBank; set: OralSet; current: string; onOpen(id: string): void }) {
  const p = PARTS[b.kind === "writing" ? "EE" : "EO"];
  const same = set.sameAs ? b.set.get(set.sameAs) : undefined;
  return (
    <div className="rounded-xl border">
      <div className="flex items-center justify-between border-b px-3 py-2 text-[13px] font-semibold">
        {setLabel(b, set)}
        {same && <span className="text-xs font-normal text-muted-foreground">和 {setLabel(b, same)} 相同</span>}
      </div>
      <ol className="flex flex-col">
        {set.subjects.map((sid, i) => {
          const s = b.subject.get(sid);
          if (!s) return null;
          const on = sid === current;
          return (
            <li key={sid + i}>
              <button
                type="button"
                disabled={on}
                onClick={() => onOpen(sid)}
                className={cn(
                  "flex w-full gap-2.5 px-3 py-2 text-left text-[13px] leading-snug transition-colors",
                  on ? [p.soft, "cursor-default"] : "hover:bg-muted",
                )}
              >
                <span className={cn("mt-px w-6 shrink-0 font-semibold tabular-nums", on ? p.text : "text-muted-foreground")}>
                  {b.kind === "writing" ? `T${s.tache}` : i + 1}
                </span>
                <span className={cn("line-clamp-2", !on && "text-muted-foreground")} title={s.zh ? s.intro ?? s.text : undefined}>
                  {s.zh ?? s.intro ?? s.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function TopicDetail({
  bank: b,
  subjectId,
  onOpen,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  bank: OralBank;
  subjectId: string | null;
  onOpen(id: string): void;
  onClose(): void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
}) {
  const s = subjectId ? b.subject.get(subjectId) : undefined;
  const p = PARTS[b.kind === "writing" ? "EE" : "EO"];
  const info = s ? TACHE_INFO[b.kind][s.tache] : undefined;
  const sets = s ? s.sets.map((id) => b.set.get(id)).filter((x): x is OralSet => !!x).reverse() : [];
  const Icon = b.kind === "writing" ? PenLine : Mic;
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-xl">
        {s && info && (
          <>
            <SheetHeader className="border-b px-5 pt-5 pb-4">
              <div className={cn("text-xs font-semibold tracking-[0.14em] uppercase", p.text)}>
                Tâche {s.tache} · {info.fr}
              </div>
              <SheetTitle className="text-lg font-bold">
                {info.zh} · {info.limit}
              </SheetTitle>
              <SheetDescription>{info.note ?? info.desc}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
              <div className="flex flex-col gap-3">
                {s.zh && (
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold">{s.zh}</h2>
                    {s.cat && <TopicTag cat={s.cat} />}
                  </div>
                )}
                <Prompt s={s} kind={b.kind} />
              </div>
              <Section title={`出现 ${s.months.length} 个月`}>
                <div className="flex flex-wrap gap-1.5">
                  {s.months.map((m) => (
                    <Badge key={m} variant="secondary">
                      {fmtYm(m, true)}
                    </Badge>
                  ))}
                </div>
              </Section>
              <Section title={b.kind === "writing" ? "所在套题" : "同组的题"}>
                {sets.map((set) => (
                  <SetCard key={set.id} b={b} set={set} current={s.id} onOpen={onOpen} />
                ))}
              </Section>
              <div className="flex items-start gap-3 rounded-xl border border-dashed p-4 text-muted-foreground">
                <Icon className="mt-0.5 size-5 shrink-0" />
                <div className="text-[13px] leading-relaxed">
                  <div className="font-semibold text-foreground">{b.kind === "writing" ? "作答和批改" : "录音练习和评分"}（以后做）</div>
                  {b.kind === "writing" ? "在这里写作答，自动计字数和计时，以后接 AI 批改。" : "在这里计时、录音、回放，以后接 AI 评分。"}
                </div>
              </div>
            </div>
            {(onPrev || onNext) && (
              <div className="flex items-center justify-between border-t px-5 py-3">
                <Button variant="outline" size="sm" disabled={!onPrev} onClick={onPrev}>
                  <ChevronLeft /> 上一题
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">{position}</span>
                <Button variant="outline" size="sm" disabled={!onNext} onClick={onNext}>
                  下一题 <ChevronRight />
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
