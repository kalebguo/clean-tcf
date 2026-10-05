import { useEffect, useMemo, useState } from "react";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration, useNavigate } from "react-router-dom";
import { CloudBanners } from "./cloud/CloudUI";
import { DictPanel } from "./components/DictPanel";
import { SettingsModal } from "./components/SettingsModal";
import { UIContext } from "./components/ui";
import { displayNo, useBanks } from "./data/bank";
import { DB_UPGRADED_EVENT } from "./db/schema";
import { useSettings } from "./db/settings";
import { MockExamRoute, SetExamRoute } from "./exam/ExamPage";
import { FlashcardsRoute } from "./flashcards/FlashcardsPage";
import { DataPage } from "./pages/DataPage";
import { Favorites } from "./pages/Favorites";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/common";
import { ProgressPage } from "./pages/ProgressPage";
import {
  DedupeRoute, FavoritesPracticeRoute, ReviewRoute, SearchPracticeRoute, SetPracticeRoute, WrongPracticeRoute,
} from "./pages/PracticeRoutes";
import { Search } from "./pages/Search";
import { SectionHub } from "./pages/SectionHub";
import { SetList } from "./pages/SetList";
import { VocabPage } from "./pages/VocabPage";
import { WrongBook } from "./pages/WrongBook";
import { getEngine, type SearchHit } from "./search/engine";
import { OralHub } from "./oral/OralHub";
import { TopicBank } from "./oral/TopicBank";
import { Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LevelTag, MARK } from "./components/controls";

function SearchDialog({ initial, onClose }: { initial: string; onClose(): void }) {
  const banks = useBanks();
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!banks) return;
    const t = setTimeout(() => getEngine(banks).then((e) => setHits(e.search(q, 8))), 150);
    return () => clearTimeout(t);
  }, [q, banks]);
  const go = (url: string) => {
    onClose();
    navigate(url);
  };
  return (
    <CommandDialog open onOpenChange={(o) => !o && onClose()} title="搜索题目" description="单词、短语或题号" className="sm:max-w-xl">
      <Command shouldFilter={false} data-no-shortcuts="">
        <CommandInput value={q} onValueChange={setQ} placeholder="搜索题目：单词、短语、题号…" />
        <CommandList className="max-h-[60vh]">
          {q.trim() && (
            // first, so that Enter opens all the results (as before)
            <CommandGroup>
              <CommandItem value="*all" onSelect={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}>
                <SearchIcon />
                查看全部结果：<b>{q.trim()}</b>
              </CommandItem>
            </CommandGroup>
          )}
          {hits.length > 0 && (
            <CommandGroup heading="题目">
              {hits.map(({ q: hq, snippet }) => (
                <CommandItem key={hq.id} value={hq.id} onSelect={() => go(`/search/practice?q=${encodeURIComponent(q)}&start=${hq.id}`)} className="items-baseline">
                  <LevelTag level={hq.level} className="w-6 shrink-0" />
                  <b className="shrink-0">{displayNo(hq)}</b>
                  {snippet && (
                    <span className="truncate text-muted-foreground">
                      {snippet.before}
                      {snippet.match && <mark className={MARK}>{snippet.match}</mark>}
                      {snippet.after}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!q.trim() && <div className="px-3 py-6 text-center text-sm text-muted-foreground">输入法语单词、短语（"à cause de"）、原形（aller）或题号（5-8）</div>}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function Shell() {
  const [settings] = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [upgraded, setUpgraded] = useState(false);
  const [dictOpen, setDictOpen] = useState(false);
  const ui = useMemo(
    () => ({ openSettings: () => setSettingsOpen(true), openSearch: (s = "") => setSearch(s), toggleDict: () => setDictOpen((o) => !o), closeDict: () => setDictOpen(false) }),
    [],
  );

  // theme
  useEffect(() => {
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme]);

  // a newer version of the site, opened in another tab, took over the database
  useEffect(() => {
    const on = () => setUpgraded(true);
    window.addEventListener(DB_UPGRADED_EVENT, on);
    return () => window.removeEventListener(DB_UPGRADED_EVENT, on);
  }, []);

  // global: "/" or ⌘K opens search; a mouse click never leaves focus on a button,
  // so Space / Enter keep working as practice shortcuts afterwards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, select, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setSearch("");
      }
    };
    const onClick = (e: MouseEvent) => {
      if (e.detail > 0) (e.target as HTMLElement).closest?.("button")?.blur();
    };
    // only one audio plays at a time
    const onPlay = (e: Event) => {
      document.querySelectorAll("audio").forEach((a) => a !== e.target && a.pause());
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    document.addEventListener("play", onPlay, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      document.removeEventListener("play", onPlay, true);
    };
  }, []);

  return (
    <UIContext.Provider value={ui}>
      <TooltipProvider delayDuration={300}>
      {upgraded && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 border-b bg-wrong/10 px-4 py-2 text-sm text-wrong backdrop-blur-md">
          网站已更新，这个页面不能再保存数据，请刷新。
          <Button size="sm" onClick={() => window.location.reload()}>
            刷新
          </Button>
        </div>
      )}
      <CloudBanners />
      <Outlet />
      {/* a new page starts at the top, back / forward restores; keyed by path so filters in the query keep the position */}
      <ScrollRestoration getKey={(loc) => loc.pathname} />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {search !== null && <SearchDialog initial={search} onClose={() => setSearch(null)} />}
      {dictOpen && <DictPanel onClose={() => setDictOpen(false)} />}
      </TooltipProvider>
    </UIContext.Provider>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/writing", element: <OralHub kind="writing" /> },
      { path: "/writing/bank", element: <TopicBank kind="writing" /> },
      { path: "/speaking", element: <OralHub kind="speaking" /> },
      { path: "/speaking/bank", element: <TopicBank kind="speaking" /> },
      { path: "/:section", element: <SectionHub /> },
      { path: "/:section/dedupe", element: <DedupeRoute /> },
      { path: "/:section/review", element: <ReviewRoute /> },
      { path: "/:section/sets", element: <SetList /> },
      { path: "/:section/sets/:setId", element: <SetPracticeRoute /> },
      { path: "/:section/sets/:setId/exam", element: <SetExamRoute /> },
      { path: "/:section/exam", element: <MockExamRoute /> },
      { path: "/:section/progress", element: <ProgressPage /> },
      { path: "/:section/flashcards", element: <FlashcardsRoute /> },
      { path: "/wrong", element: <WrongBook /> },
      { path: "/wrong/practice", element: <WrongPracticeRoute /> },
      { path: "/favorites", element: <Favorites /> },
      { path: "/favorites/practice", element: <FavoritesPracticeRoute /> },
      { path: "/search", element: <Search /> },
      { path: "/search/practice", element: <SearchPracticeRoute /> },
      { path: "/data", element: <DataPage /> },
      { path: "/vocab", element: <VocabPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
