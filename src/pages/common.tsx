import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { PageShell } from "../components/AppShell";
import { hasChoices } from "../db/rules";
import { db } from "../db/schema";

export function Loading({ text = "加载题库…" }: { text?: string }) {
  return (
    <PageShell>
      <div className="py-20 text-center text-muted-foreground">{text}</div>
    </PageShell>
  );
}

export function NotFound() {
  return (
    <PageShell>
      <div className="py-20 text-center text-muted-foreground">
        页面不存在。
        <Link to="/" className="text-primary">
          回首页
        </Link>
      </div>
    </PageShell>
  );
}

const MODE_NAME = { dedupe: "去重练习", set: "按套练习", wrong: "错题订正", favorites: "收藏练习", search: "搜索结果练习", review: "复习模式", exam: "模拟考试" } as const;

/** Unsubmitted rounds with answers, newest first, each with the route that reopens it. */
export function useOpenRounds() {
  return (
    useLiveQuery(async () => {
      const open = await db.sessions.where("status").equals("open").toArray();
      return open
        .filter((s) => hasChoices(s.draft) && s.scope.route)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((s) => ({
          id: s.id,
          route: s.scope.route!,
          label: `${s.scope.label ?? MODE_NAME[s.mode]}`,
          answered: Object.values(s.draft).filter((d) => d.choice).length,
          updatedAt: s.updatedAt,
        }));
    }, []) ?? []
  );
}

export function fmtDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
