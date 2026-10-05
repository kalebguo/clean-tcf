import { ChevronDown, Play, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "../components/AppShell";
import { EmptyState, LevelTag, LEVEL_OPTIONS, Pick, SECTION_OPTIONS, Seg, Toolbar } from "../components/controls";
import { displayNo, summaryText, useBanks, type Banks } from "../data/bank";
import type { Level, Section } from "../data/types";
import { blockText, deleteHighlight, locate } from "../db/highlights";
import { toggleFavorite, useAllHighlights, useFavorites, useNotes } from "../db/progress";
import { db } from "../db/schema";
import { useSettings } from "../db/settings";
import { fmtDate, Loading } from "./common";

export type FavScope = "all" | "fav" | "notes";

/** Questions in the favorites/notebook for a filter, most recently touched first. */
export async function favoriteQids(banks: Banks, section: Section | "ALL", level: Level | "ALL", scope: FavScope): Promise<string[]> {
  const [favs, notes, hls] = await Promise.all([db.favorites.toArray(), db.notes.toArray(), db.highlights.toArray()]);
  const touched = new Map<string, number>();
  const bump = (qid: string, t: number) => touched.set(qid, Math.max(touched.get(qid) ?? 0, t));
  if (scope !== "notes") favs.forEach((f) => bump(f.qid, f.createdAt));
  if (scope !== "fav") {
    notes.forEach((n) => bump(n.qid, n.updatedAt));
    hls.forEach((h) => bump(h.qid, h.updatedAt));
  }
  return [...touched.entries()]
    .filter(([qid]) => {
      const q = banks.get(qid);
      return q && (section === "ALL" || q.section === section) && (level === "ALL" || q.level === level);
    })
    .sort((a, b) => b[1] - a[1])
    .map(([qid]) => qid);
}

export function Favorites() {
  const banks = useBanks();
  const favorites = useFavorites();
  const notes = useNotes();
  const highlights = useAllHighlights();
  const [settings, setSettings] = useSettings();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);

  const section = (sp.get("section") as Section | "ALL") || "ALL";
  const level = (sp.get("level") as Level | "ALL") || "ALL";
  const scope = (sp.get("scope") as FavScope) || "all";

  useEffect(() => {
    document.title = "收藏夹和笔记本 · TCF";
  }, []);
  useEffect(() => {
    if (banks) favoriteQids(banks, section, level, scope).then(setIds);
  }, [banks, section, level, scope, favorites, notes, highlights]);
  if (!banks) return <Loading />;

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const query = (extra = "") => `/favorites/practice?section=${section}&level=${level}&scope=${scope}${extra}`;

  return (
    <PageShell>
      <PageHeader
        title="收藏夹和笔记本"
        description="收藏的题、题目笔记和划词高亮。"
        actions={
          <Button disabled={!ids.length} onClick={() => navigate(query())}>
            <Play /> 开始练习
          </Button>
        }
      />
      <Toolbar>
        <Seg
          value={scope}
          onChange={(v) => set("scope", v)}
          options={[
            ["all", "全部"],
            ["fav", "仅收藏"],
            ["notes", "仅笔记"],
          ]}
        />
        <Pick label="部分" value={section} onChange={(v) => set("section", v)} options={SECTION_OPTIONS} />
        <Pick label="难度" value={level} onChange={(v) => set("level", v)} options={LEVEL_OPTIONS} />
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={settings.hideHighlights} onCheckedChange={(v) => setSettings({ hideHighlights: v })} />
          隐藏高亮
        </label>
      </Toolbar>

      {ids.length === 0 ? (
        <EmptyState>还没有收藏或笔记。做题时点 ☆ 收藏、✎ 写笔记，或选中文字高亮。</EmptyState>
      ) : (
        <div className="grid gap-2">
          {ids.map((qid) => {
            const q = banks.get(qid)!;
            const note = notes.get(qid);
            const hls = highlights.get(qid) ?? [];
            const updated = Math.max(note?.updatedAt ?? 0, favorites.get(qid)?.createdAt ?? 0, ...hls.map((h) => h.updatedAt));
            const expanded = open === qid;
            return (
              <div key={qid} className={cn("rounded-xl border bg-card transition-colors", expanded && "border-primary/40")}>
                <div role="link" tabIndex={0} className="flex cursor-pointer items-center gap-3 px-4 py-3" onClick={() => navigate(query(`&start=${qid}`))}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <LevelTag level={q.level} />
                      <b className="text-sm">{displayNo(q)}</b>
                      {favorites.has(qid) && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                      {hls.length > 0 && <Badge variant="secondary">高亮 {hls.length}</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{note ? note.text.slice(0, 60) : summaryText(q)}</div>
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{fmtDate(updated)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={expanded ? "收起" : "展开"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(expanded ? null : qid);
                    }}
                  >
                    <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
                  </Button>
                </div>
                {expanded && (
                  <div className="grid gap-2 border-t border-dashed px-4 pt-3 pb-4">
                    <div>
                      <Button variant="outline" size="xs" onClick={() => void toggleFavorite(q)}>
                        <Star className={cn(favorites.has(qid) && "fill-amber-400 text-amber-400")} />
                        {favorites.has(qid) ? "取消收藏" : "加入收藏"}
                      </Button>
                    </div>
                    {note && <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap">{note.text}</div>}
                    {!settings.hideHighlights &&
                      hls.map((h) => {
                        const text = blockText(q, h.field, h.index);
                        const lost = !text || !locate(h, text);
                        return (
                          <div key={h.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                            <mark className="hl">{h.text}</mark>
                            {lost && <Badge className="bg-wrong/10 text-wrong">失效高亮</Badge>}
                            {h.note && <span className="text-xs text-muted-foreground">{h.note}</span>}
                            <button type="button" className="text-xs text-wrong hover:underline" onClick={() => void deleteHighlight(h.id)}>
                              删除
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
