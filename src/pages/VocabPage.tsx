import { Download, Layers, Search as SearchIcon, Star as StarIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PageHeader, PageShell } from "../components/AppShell";
import { Chips, EmptyState, LevelTag, Pick, Seg, Toolbar } from "../components/controls";
import { PARTS } from "../components/parts";
import { MtTag, WordDetails, WordHead } from "../components/WordCard";
import { BAND_LABEL, briefOf, normalizeWord, stripAccents, useDict, type Band, type DictEntry } from "../data/dict";
import { LEVELS, type Level } from "../data/types";
import { addListWords, useWordCardIds } from "../db/cards";
import type { VocabEntry } from "../db/schema";
import { addWord, removeWord, setMastered, setNote, useVocab, vocabCsv } from "../db/vocab";
import { saveFile } from "../platform";

const PAGE = 100;
const BANDS: Band[] = ["high", "mid", "low", "rare", "function"];

function Star({ lemma, saved }: { lemma: string; saved: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="-ml-1"
      title={saved ? "从生词本移除" : "加入生词本"}
      onClick={(ev) => {
        ev.stopPropagation();
        void (saved ? removeWord(lemma) : addWord(lemma));
      }}
    >
      <StarIcon className={cn(saved && "fill-amber-400 text-amber-400")} />
    </Button>
  );
}

function WordRow({ e, saved, open, onToggle, extra }: { e: DictEntry; saved: boolean; open: boolean; onToggle(): void; extra?: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border bg-card transition-colors", open && "border-primary/40")}>
      <div className="flex cursor-pointer items-start gap-2.5 px-3 py-2" onClick={onToggle}>
        <Star lemma={e.lemma} saved={saved} />
        <div className="min-w-0 flex-1">
          <WordHead e={e}>
            <span className="flex-1" />
            <LevelTag level={e.level} />
          </WordHead>
          <div className={cn("mt-0.5 text-sm", !open && "truncate")}>
            {briefOf(e)?.text}
            {e.briefMt && <MtTag />}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs leading-snug text-muted-foreground tabular-nums">
          {e.tf} 次
          <br />
          {e.df} 题
        </div>
      </div>
      {extra}
      {open && <WordDetails e={e} className="px-3.5 pb-3 sm:pl-[52px]" />}
    </div>
  );
}

/**
 * Put the words of the current filter into the word flashcards as one group, most frequent first.
 * Function words (le, de, et…) stay out unless that band is chosen; words with a card are skipped.
 */
function GroupAdd({ list, level, band, q }: { list: DictEntry[]; level: Level | null; band: Band | null; q: string }) {
  const have = useWordCardIds();
  const [added, setAdded] = useState<number | null>(null);
  useEffect(() => setAdded(null), [level, band, q]);
  const group = list.filter((e) => e.verified !== false && (band === "function" || e.band !== "function"));
  const todo = have ? group.filter((e) => !have.has(e.lemma)) : [];
  const name = [level ?? "全部等级", band ? BAND_LABEL[band] : "全部频段", q && `“${q}”`].filter(Boolean).join(" · ");
  const add = () => {
    if (todo.length > 500 && !window.confirm(`把 ${todo.length} 个词加入单词闪卡？新词按词频从高到低出，每天不超过上限。`)) return;
    void addListWords(todo.map((e) => ({ lemma: e.lemma, level: e.level }))).then(setAdded);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-2 text-[13px]">
      <Layers className="size-4 shrink-0 text-vocab" />
      <span className="min-w-0">
        <b>{name}</b>：{group.length} 个词{band !== "function" && "（不含功能词）"}，{group.length - todo.length} 个已在闪卡里
      </span>
      <span className="flex-1" />
      {added !== null ? (
        <span>
          已加入 {added} 个 ·{" "}
          <Link className="text-primary hover:underline" to="/vocab/flashcards">
            去背单词 ›
          </Link>
        </span>
      ) : (
        <Button size="sm" disabled={!todo.length} onClick={add}>
          加入单词闪卡（{todo.length}）
        </Button>
      )}
    </div>
  );
}

/** The learner's note on a saved word: shown as text, edited in place, saved on blur. */
function NoteField({ lemma, note }: { lemma: string; note?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");
  useEffect(() => setText(note ?? ""), [note]);
  if (!editing) {
    return note ? (
      <button type="button" className="cursor-text rounded-md bg-primary/10 px-2 py-0.5 text-left text-[13px] whitespace-pre-wrap" title="编辑备注" onClick={() => setEditing(true)}>
        {note}
      </button>
    ) : (
      <button type="button" className="w-fit text-[13px] text-primary hover:underline" onClick={() => setEditing(true)}>
        写备注
      </button>
    );
  }
  const save = () => {
    setEditing(false);
    if (text.trim() !== (note ?? "")) void setNote(lemma, text);
  };
  return (
    <Textarea
      className="min-h-0 text-[13px] sm:min-w-60"
      autoFocus
      rows={2}
      value={text}
      placeholder="自己的理解、搭配、记忆方法…"
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          setText(note ?? "");
          setEditing(false);
        }
      }}
    />
  );
}

type BookSort = "added" | "oldest" | "alpha" | "level" | "freq";
const BOOK_SORT: Record<BookSort, string> = { added: "最近收录", oldest: "最早收录", alpha: "字母顺序", level: "按难度", freq: "按词频" };

function matches(e: DictEntry, q: string): boolean {
  if (!q) return true;
  const n = stripAccents(normalizeWord(q));
  const zh = (z: string) => z.includes(q.trim());
  if (!n) return e.zh.some(zh) || !!e.brief?.some(zh);
  return stripAccents(e.lemma).startsWith(n) || e.forms.some((f) => stripAccents(normalizeWord(f)).startsWith(n)) || e.zh.some(zh) || !!e.brief?.some(zh);
}

export function VocabPage() {
  const dict = useDict();
  const vocab = useVocab();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "book" ? "book" : "list";
  const level = (params.get("level") as Level | null) ?? null;
  const band = (params.get("band") as Band | null) ?? null;
  const q = params.get("q") ?? "";
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [bookFilter, setBookFilter] = useState<"todo" | "done" | "all">("todo");
  const [bookSort, setBookSort] = useState<BookSort>("added");
  const [bookLevel, setBookLevel] = useState<Level | null>(null);

  useEffect(() => {
    document.title = "单词本 · TCF";
  }, []);
  useEffect(() => setPage(1), [tab, level, band, q]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const list = useMemo(() => {
    if (!dict) return [];
    // unverified words are mostly OCR errors and names; the search box still finds them
    return dict.entries.filter((e) => (e.verified !== false || q) && (!level || e.level === level) && (!band || e.band === band) && matches(e, q));
  }, [dict, level, band, q]);

  const book = useMemo(() => {
    if (!dict) return [];
    const rows = [...vocab.values()].filter(
      (r) => (bookFilter === "all" || (bookFilter === "done") === r.mastered) && (!bookLevel || dict.byLemma.get(r.lemma)?.level === bookLevel),
    );
    const rank = (r: VocabEntry) => dict.byLemma.get(r.lemma)?.rank ?? 1e9;
    const lvl = (r: VocabEntry) => LEVELS.indexOf(dict.byLemma.get(r.lemma)?.level ?? "C2");
    const by: Record<BookSort, (a: VocabEntry, b: VocabEntry) => number> = {
      added: (a, b) => b.addedAt - a.addedAt,
      oldest: (a, b) => a.addedAt - b.addedAt,
      alpha: (a, b) => a.lemma.localeCompare(b.lemma, "fr"),
      level: (a, b) => lvl(a) - lvl(b) || rank(a) - rank(b),
      freq: (a, b) => rank(a) - rank(b),
    };
    return rows.sort(by[bookSort]);
  }, [dict, vocab, bookFilter, bookSort, bookLevel]);

  const exportCsv = () => {
    if (!dict) return;
    void saveFile(`tcf-vocab-${new Date().toISOString().slice(0, 10)}.csv`, vocabCsv([...vocab.values()], dict.byLemma), "text/csv;charset=utf-8");
  };

  const toggle = (lemma: string) => setOpen((o) => (o === lemma ? null : lemma));

  const p = PARTS.V;
  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        kicker={p.fr}
        kickerClass={p.text}
        title="单词本"
        description="题库里出现过的词，按等级和频率整理；生词本收录你标记的词。"
        actions={
          <Button asChild variant="outline">
            <Link to="/vocab/flashcards">
              <Layers /> 单词闪卡
            </Link>
          </Button>
        }
      />
      <Seg
        className="mb-4"
        value={tab}
        onChange={(v) => set({ tab: v === "book" ? "book" : null })}
        options={[
          ["list", "分级词表"],
          ["book", `生词本 ${vocab.size}`],
        ]}
      />

      {dict === undefined && <EmptyState>加载词典…</EmptyState>}
      {dict === null && (
        <EmptyState>
          还没有词典数据。运行 <code>npm run p2</code> 后刷新。
        </EmptyState>
      )}

      {dict && tab === "list" && (
        <>
          <div className="mb-3 grid gap-2.5">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-10 bg-card pl-9" value={q} onChange={(e) => set({ q: e.target.value || null })} placeholder="查词：法语（不分重音）或中文" />
            </div>
            <Chips value={level} onChange={(v) => set({ level: v })} options={[[null, "全部等级"], ...LEVELS.map((l): [Level, string] => [l, l])]} />
            <Chips value={band} onChange={(v) => set({ band: v })} options={[[null, "全部频段"], ...BANDS.map((b): [Band, string] => [b, BAND_LABEL[b]])]} />
            <div className="text-xs leading-relaxed text-muted-foreground">
              {list.length} 个词，按出现次数排序。等级是这个词在题库里最早出现的难度；频段：高频词覆盖题库 80% 的实义词出现，中频到 95%，罕见词只在一道题里出现。
            </div>
            <GroupAdd list={list} level={level} band={band} q={q} />
          </div>
          <div className="grid gap-1.5">
            {list.slice(0, page * PAGE).map((e) => (
              <WordRow key={e.lemma} e={e} saved={vocab.has(e.lemma)} open={open === e.lemma} onToggle={() => toggle(e.lemma)} />
            ))}
          </div>
          {list.length > page * PAGE && (
            <Button variant="outline" className="mt-3 w-full" onClick={() => setPage((n) => n + 1)}>
              再显示 {Math.min(PAGE, list.length - page * PAGE)} 个（共 {list.length}）
            </Button>
          )}
        </>
      )}

      {dict && tab === "book" && (
        <>
          <Toolbar className="mb-3">
            <Seg<typeof bookFilter>
              value={bookFilter}
              onChange={setBookFilter}
              options={[
                ["todo", "未掌握"],
                ["done", "已掌握"],
                ["all", "全部"],
              ]}
            />
            <Pick<BookSort> label="排序" value={bookSort} onChange={setBookSort} options={(Object.keys(BOOK_SORT) as BookSort[]).map((k) => [k, BOOK_SORT[k]])} />
            <span className="flex-1" />
            <Button variant="outline" size="sm" disabled={!vocab.size} onClick={exportCsv} title="导出为 CSV，可以导入 Anki">
              <Download /> 导出 CSV
            </Button>
          </Toolbar>
          <div className="mb-3">
            <Chips<Level> value={bookLevel} onChange={setBookLevel} options={[[null, "全部等级"], ...LEVELS.map((l): [Level, string] => [l, l])]} />
          </div>
          {book.length === 0 && <EmptyState>{vocab.size ? "这里没有词。" : "还没有生词。在词表里点 ☆，或在练习时双击原文里的词，把它加进来。"}</EmptyState>}
          <div className="grid gap-1.5">
            {book.map((r) => {
              const e = dict.byLemma.get(r.lemma);
              if (!e)
                return (
                  <div key={r.lemma} className="rounded-xl border bg-card px-4 py-2 text-sm text-muted-foreground">
                    {r.lemma}（词表里已没有这个词）
                  </div>
                );
              return (
                <WordRow
                  key={r.lemma}
                  e={e}
                  saved
                  open={open === r.lemma}
                  onToggle={() => toggle(r.lemma)}
                  extra={
                    <div className="flex items-start gap-3 px-3.5 pb-2.5 sm:pl-[52px]">
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <NoteField lemma={r.lemma} note={r.note} />
                        {r.context && <span className="truncate font-serif text-xs text-muted-foreground">“{r.context}”</span>}
                      </div>
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                        <Switch size="sm" checked={r.mastered} onCheckedChange={(v) => void setMastered(r.lemma, v)} /> 已掌握
                      </label>
                    </div>
                  }
                />
              );
            })}
          </div>
        </>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        释义、音标、发音和近义词来自维基词典（中文、法语、英语版，经 kaikki.org 整理），按 CC BY-SA 协议使用；例句来自题库。
      </p>
    </PageShell>
  );
}
