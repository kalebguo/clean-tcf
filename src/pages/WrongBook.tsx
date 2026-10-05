import { Eraser, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "../components/AppShell";
import { EmptyState, LevelTag, LEVEL_OPTIONS, Pick, ROW, SECTION_OPTIONS, Seg, Toolbar } from "../components/controls";
import { Modal, ModalActions } from "../components/Modal";
import { displayNo, summaryText, useBanks, type Banks } from "../data/bank";
import { SECTION_NAME, type Level, type Section } from "../data/types";
import { removeFromWrong, resetWrong, useQStates } from "../db/progress";
import { db, type QState } from "../db/schema";
import { fmtDate, Loading } from "./common";

export interface WrongFilter {
  section: Section | "ALL";
  level: Level | "ALL";
  state: "all" | "open" | "fixed";
  sort: "recent" | "count";
}

function matches(s: QState, f: WrongFilter, banks: Banks) {
  return (
    s.wrong !== "none" &&
    banks.get(s.qid) !== undefined &&
    (f.section === "ALL" || s.section === f.section) &&
    (f.level === "ALL" || s.level === f.level) &&
    (f.state === "all" || s.wrong === f.state)
  );
}

function sortRows(rows: QState[], sort: WrongFilter["sort"]) {
  return [...rows].sort((a, b) =>
    sort === "count" ? b.wrongCount - a.wrongCount || (b.wrongAt ?? 0) - (a.wrongAt ?? 0) : (b.wrongAt ?? 0) - (a.wrongAt ?? 0),
  );
}

/** Current wrong-book list for a filter (used to start and to refresh a correction round). */
export async function wrongQids(banks: Banks, f: WrongFilter): Promise<string[]> {
  const rows = await db.qstate.filter((s) => matches(s, f, banks)).toArray();
  return sortRows(rows, f.sort).map((s) => s.qid);
}

export function WrongBook() {
  const banks = useBanks();
  const states = useQStates();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const [resetOpen, setResetOpen] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    document.title = "错题本 · TCF";
  }, []);
  if (!banks) return <Loading />;

  const f: WrongFilter = {
    section: (sp.get("section") as Section | "ALL") || "ALL",
    level: (sp.get("level") as Level | "ALL") || "ALL",
    state: (sp.get("state") as WrongFilter["state"]) || "open",
    sort: (sp.get("sort") as WrongFilter["sort"]) || "recent",
  };
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const all = [...states.values()];
  const count = (state: WrongFilter["state"]) => all.filter((s) => matches(s, { ...f, state }, banks)).length;
  const rows = sortRows(all.filter((s) => matches(s, f, banks)), f.sort);
  const query = (extra = "") =>
    `/wrong/practice?section=${f.section}&level=${f.level}&state=${f.state}&sort=${f.sort}${extra}`;

  return (
    <PageShell>
      <PageHeader
        title="错题本"
        description="做错的题自动进来；在订正练习里答对一次，就算已订正。"
        actions={
          <>
            <Button variant="outline" onClick={() => setResetOpen(true)}>
              <Eraser /> 重置
            </Button>
            <Button disabled={!rows.length} onClick={() => navigate(query())}>
              <Play /> 开始订正
            </Button>
          </>
        }
      />
      <Toolbar>
        <Seg
          value={f.state}
          onChange={(v) => set("state", v)}
          options={(["open", "fixed", "all"] as const).map((st) => [
            st,
            <>
              {{ all: "全部", open: "未订正", fixed: "已订正" }[st]} <span className="tabular-nums opacity-70">{count(st)}</span>
            </>,
          ])}
        />
        <Pick label="部分" value={f.section} onChange={(v) => set("section", v)} options={SECTION_OPTIONS} />
        <Pick label="难度" value={f.level} onChange={(v) => set("level", v)} options={LEVEL_OPTIONS} />
        <Pick
          label="排序"
          value={f.sort}
          onChange={(v) => set("sort", v)}
          options={[
            ["recent", "最近做错在前"],
            ["count", "错得最多在前"],
          ]}
        />
      </Toolbar>
      {msg && <div className="mb-3 text-sm text-muted-foreground">{msg}</div>}

      {rows.length === 0 ? (
        <EmptyState>
          {f.state === "open" ? "没有待订正的错题。" : "这里还没有题目。"}
          <div className="mt-2">
            <Link to="/" className="text-primary hover:underline">
              去练习
            </Link>
          </div>
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {rows.map((s) => {
            const q = banks.get(s.qid)!;
            return (
              <div key={s.qid} role="link" tabIndex={0} className={cn(ROW, "cursor-pointer")} onClick={() => navigate(query(`&start=${s.qid}`))}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <LevelTag level={q.level} />
                    <b className="text-sm">{displayNo(q)}</b>
                    <Badge className={s.wrong === "fixed" ? "bg-correct/10 text-correct" : "bg-wrong/10 text-wrong"}>
                      {s.wrong === "open" ? "未订正" : "已订正"}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{summaryText(q)}</div>
                </div>
                <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                  错 {s.wrongCount} 次<br />
                  {fmtDate(s.wrongAt)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeFromWrong(s.qid);
                  }}
                >
                  移出
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {resetOpen && (
        <Modal
          title="重置错题本"
          description={`范围：${f.section === "ALL" ? "听力 + 阅读" : SECTION_NAME[f.section]}。重置只会把题目移出错题本，作答记录仍然保留。`}
          onClose={() => setResetOpen(false)}
        >
          <ModalActions>
            {(["open", "fixed", "all"] as const).map((w) => (
              <Button
                key={w}
                variant={w === "all" ? "destructive" : "outline"}
                onClick={async () => {
                  const n = await resetWrong(f.section, w);
                  setResetOpen(false);
                  setMsg(`已移出 ${n} 题。`);
                }}
              >
                {{ open: "清除未订正", fixed: "清除已订正", all: "全部清除" }[w]}
              </Button>
            ))}
          </ModalActions>
        </Modal>
      )}
    </PageShell>
  );
}
