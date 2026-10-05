import { Button } from "@/components/ui/button";
import { Bar } from "../components/AppShell";
import { LevelTag, StatTiles } from "../components/controls";
import { Modal, ModalActions } from "../components/Modal";
import { LEVEL_BG } from "../components/parts";
import type { Banks } from "../data/bank";
import { LEVELS, SECTION_NAME, type Section } from "../data/types";
import { countDone } from "../db/progress";
import type { QState } from "../db/schema";
import type { SubmitResult } from "../db/sessions";
import { fmtElapsed } from "./Sidebar";

interface Props {
  result: SubmitResult;
  banks: Banks;
  states: Map<string, QState>;
  sections: Section[];
  onReview(qid?: string): void;
  onNewRound(): void;
  onGoWrong(): void;
}

/** Bank progress of one section, one bar per level. */
export function LevelProgress({ banks, section, states }: { banks: Banks; section: Section; states: Map<string, QState> }) {
  return (
    <div className="grid gap-1">
      {LEVELS.map((l) => {
        const ids = banks[section].questions.filter((q) => q.level === l).map((q) => q.id);
        const done = countDone(ids, states);
        return (
          <div key={l} className="grid grid-cols-[2.25rem_1fr_4.5rem] items-center gap-3">
            <LevelTag level={l} />
            <Bar value={done / ids.length} fill={LEVEL_BG[l]} />
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {done}/{ids.length}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const H3 = "mt-2 mb-1.5 text-sm font-semibold";

export function SessionSummary({ result: r, banks, states, sections, onReview, onNewRound, onGoWrong }: Props) {
  const rate = r.answered ? Math.round((r.correct / r.answered) * 100) : 0;
  const stats: [string | number, string][] = [
    [fmtElapsed(r.elapsedMs), "用时"],
    [r.answered, "作答"],
    [r.correct, "正确"],
    [`${rate}%`, "正确率"],
    [r.newCount, "新题"],
    [r.redoCount, "重做"],
  ];
  if (r.fixedQids.length > 0) stats.push([r.fixedQids.length, "本轮订正"]);
  return (
    <Modal title="本轮小结" wide>
      {r.alreadySubmitted ? <p className="text-sm text-muted-foreground">这一轮已经在其他页面提交过了，没有重复记录。</p> : <StatTiles items={stats} />}
      {r.wrongQids.length > 0 && (
        <div>
          <h3 className={H3}>本轮做错 {r.wrongQids.length} 题</h3>
          <div className="flex flex-wrap gap-1.5">
            {r.wrongQids.map((qid) => {
              const q = banks.get(qid);
              return (
                <button
                  key={qid}
                  type="button"
                  className="h-7 rounded-full border border-wrong/40 bg-wrong/5 px-3 text-[13px] text-wrong transition-colors hover:bg-wrong/10"
                  onClick={() => onReview(qid)}
                >
                  {q ? `${q.level} · ${q.appearances[0].set}-${q.appearances[0].num}` : qid}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {sections.map((sec) => (
        <div key={sec}>
          <h3 className={H3}>{SECTION_NAME[sec]}题库进度</h3>
          <LevelProgress banks={banks} section={sec} states={states} />
        </div>
      ))}
      <ModalActions>
        <Button variant="outline" onClick={() => onReview()}>
          查看本轮作答
        </Button>
        {r.wrongQids.length > 0 && (
          <Button variant="outline" onClick={onGoWrong}>
            去错题本订正
          </Button>
        )}
        <Button onClick={onNewRound}>开始新一轮</Button>
      </ModalActions>
    </Modal>
  );
}
