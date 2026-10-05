import { CircleCheck, ClipboardCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Bar, PageHeader, PageShell } from "../components/AppShell";
import { Toolbar } from "../components/controls";
import { PARTS } from "../components/parts";
import { useBanks } from "../data/bank";
import { SECTION_NAME, slugToSection } from "../data/types";
import { useExamHistory, type ExamRecord } from "../db/exams";
import { accuracy, countDone, useQStates } from "../db/progress";
import { Loading, NotFound } from "./common";

export function SetList() {
  const { section: slug } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  const states = useQStates();
  const history = useExamHistory(banks, section ?? "CO");
  const [onlyComplete, setOnlyComplete] = useState(false);
  useEffect(() => {
    if (section) document.title = `${SECTION_NAME[section]}套题 · TCF`;
  }, [section]);
  if (!section) return <NotFound />;
  if (!banks) return <Loading />;
  const p = PARTS[section];
  const all = banks[section].sets;
  const sets = all.filter((s) => !onlyComplete || s.complete);
  // latest set test of each set
  const lastTest = new Map<string, ExamRecord>();
  for (const r of history ?? []) if (r.kind === "set" && r.setId) lastTest.set(r.setId, r);

  return (
    <PageShell>
      <PageHeader
        back={{ to: p.path, label: p.name }}
        kicker={p.fr}
        kickerClass={p.text}
        title="按套练习"
        description={`${all.length} 套真题。卡组作者已去掉重复题，所以大多数套不满 39 题。`}
      />
      <Toolbar>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={onlyComplete} onCheckedChange={setOnlyComplete} />
          只看完整套（39 题）
        </label>
      </Toolbar>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sets.map((s) => {
          const ids = [...new Set(s.questionIds)];
          const done = countDone(ids, states);
          const acc = accuracy(ids, states);
          const test = lastTest.get(s.id);
          return (
            <div key={s.id} className="flex flex-col rounded-2xl border bg-card transition-shadow hover:shadow-[0_6px_18px_rgb(16_24_40/0.07)]">
              <Link to={`/${slug}/sets/${s.id}`} className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold">{s.label}</span>
                  {s.complete && <span className={cn("text-[11px] font-semibold", p.text)}>完整</span>}
                </div>
                <div className="text-xs text-muted-foreground">{s.series.length ? `系列 ${s.series.join(" / ")}` : " "}</div>
                <Bar value={done / ids.length} fill={p.bg} className="mt-auto" />
                <div className="text-xs text-muted-foreground tabular-nums">
                  {done}/{ids.length} 题{acc !== null && ` · 正确率 ${Math.round(acc * 100)}%`}
                </div>
              </Link>
              <div className="flex items-center gap-2 border-t border-dashed px-4 py-2">
                {test ? (
                  <Link className="flex items-center gap-1 text-xs font-medium text-correct" to={`/${slug}/sets/${s.id}/exam?report=${test.id}`} title="最近一次测试成绩">
                    <CircleCheck className="size-3.5" /> {test.result.score}/{test.result.max}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">未测试</span>
                )}
                <span className="flex-1" />
                <Button asChild variant="outline" size="xs">
                  <Link to={`/${slug}/sets/${s.id}/exam`}>
                    <ClipboardCheck /> 测试
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
