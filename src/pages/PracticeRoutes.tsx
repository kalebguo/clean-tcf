import { useEffect, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { useBanks, type Banks } from "../data/bank";
import { LEVELS, SECTION_NAME, slugToSection, type Level, type Section } from "../data/types";
import { getKV, setKV } from "../db/settings";
import { PracticePage } from "../practice/PracticePage";
import { favoriteQids, type FavScope } from "./Favorites";
import { Loading, NotFound } from "./common";
import { searchQids } from "./Search";
import { wrongQids, type WrongFilter } from "./WrongBook";

/** route that reopens this page, minus the one-off start question */
function useRoute() {
  const loc = useLocation();
  const sp = new URLSearchParams(loc.search);
  sp.delete("start");
  sp.delete("q");
  const rest = sp.toString();
  return loc.pathname + (rest ? `?${rest}` : "");
}

export function DedupeRoute() {
  const { section: slug } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  const [sp] = useSearchParams();
  const [lastLevel, setLastLevel] = useState<Level | null>(null);
  useEffect(() => {
    if (section) getKV<Level>(`lastLevel:${section}`, "A1").then(setLastLevel);
  }, [section]);
  if (!section) return <NotFound />;
  if (!banks || !lastLevel) return <Loading />;
  const bank = banks[section];
  const levelParam = sp.get("level") as Level | null;
  const level = levelParam && LEVELS.includes(levelParam) ? levelParam : lastLevel;
  const n = Number(sp.get("n"));
  const start = sp.get("q") ?? (n ? bank.questions.find((q) => q.level === level && q.bankNo === n)?.id : undefined);
  const name = SECTION_NAME[section];
  return (
    <PracticePage
      key={section}
      banks={banks}
      mode="dedupe"
      section={section}
      scopeKey={`dedupe:${section}`}
      scope={{ route: `/${slug}/dedupe`, label: `${name}去重练习` }}
      title={`去重题库 - ${name}`}
      pageTitle={`${name}去重练习`}
      qids={bank.questions.map((q) => q.id)}
      levelTabs
      initialLevel={level}
      onLevelChange={(l) => void setKV(`lastLevel:${section}`, l)}
      startQid={start}
      back={{ to: `/${slug}` }}
      wrongLink={`/wrong?section=${section}&state=open`}
    />
  );
}

/** Review mode: the whole bank with answers shown; reopens at the question last looked at. */
export function ReviewRoute() {
  const { section: slug } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  const [sp] = useSearchParams();
  const [saved, setSaved] = useState<{ qid?: string } | null>(null);
  useEffect(() => {
    if (section) getKV<{ qid?: string }>(`review:${section}`, {}).then(setSaved);
  }, [section]);
  if (!section) return <NotFound />;
  if (!banks || !saved) return <Loading />;
  const bank = banks[section];
  const levelParam = sp.get("level") as Level | null;
  const level = levelParam && LEVELS.includes(levelParam) ? levelParam : undefined;
  const start = sp.get("q") ?? (level ? undefined : saved.qid);
  const name = SECTION_NAME[section];
  return (
    <PracticePage
      key={`review:${section}`}
      banks={banks}
      mode="review"
      section={section}
      scopeKey={`review:${section}`}
      title={`复习模式 - ${name}`}
      pageTitle={`${name}复习`}
      qids={bank.questions.map((q) => q.id)}
      levelTabs
      initialLevel={level ?? (start ? banks.get(start)?.level : undefined) ?? "A1"}
      startQid={start}
      back={{ to: `/${slug}` }}
      onCurrentChange={(qid) => void setKV(`review:${section}`, { qid })}
    />
  );
}

export function SetPracticeRoute() {
  const { section: slug, setId } = useParams();
  const section = slugToSection(slug);
  const banks = useBanks();
  const [sp] = useSearchParams();
  if (!section) return <NotFound />;
  if (!banks) return <Loading />;
  const set = banks[section].sets.find((s) => s.id === setId);
  if (!set) return <NotFound />;
  const qids = [...new Set(set.questionIds)];
  const n = Number(sp.get("n"));
  const label = `${SECTION_NAME[section]} ${set.label}`;
  return (
    <PracticePage
      key={`${section}:${set.id}`}
      banks={banks}
      mode="set"
      section={section}
      scopeKey={`set:${section}:${set.id}`}
      scope={{ route: `/${slug}/sets/${set.id}`, label }}
      title={label + (set.series.length ? `（${set.series.join("/")}）` : "")}
      pageTitle={label}
      qids={qids}
      startQid={n ? qids[n - 1] : undefined}
      back={{ to: `/${slug}/sets`, label: "套题列表" }}
      wrongLink={`/wrong?section=${section}&state=open`}
    />
  );
}

function FilterPractice({
  banks, mode, scopeKey, label, list, back,
}: {
  banks: Banks;
  mode: "wrong" | "favorites" | "search";
  scopeKey: string;
  label: string;
  list: () => Promise<string[]>;
  back: { to: string; label: string };
}) {
  const [sp] = useSearchParams();
  const route = useRoute();
  const [qids, setQids] = useState<string[] | null>(null);
  useEffect(() => {
    list().then(setQids);
  }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!qids) return <Loading text="准备题目…" />;
  const sections = new Set(qids.map((id) => banks.get(id)?.section));
  const section: Section | "ALL" = sections.size === 1 ? ([...sections][0] as Section) : "ALL";
  return (
    <PracticePage
      key={scopeKey}
      banks={banks}
      mode={mode}
      section={section}
      scopeKey={scopeKey}
      scope={{ route: mode === "search" ? `${route}${route.includes("?") ? "&" : "?"}q=${encodeURIComponent(sp.get("q") ?? "")}` : route, label }}
      title={label}
      pageTitle={label}
      qids={qids}
      startQid={sp.get("start") ?? undefined}
      refresh={mode === "search" ? undefined : list}
      back={back}
      wrongLink={`/wrong?state=open`}
    />
  );
}

export function WrongPracticeRoute() {
  const banks = useBanks();
  const [sp] = useSearchParams();
  if (!banks) return <Loading />;
  const f: WrongFilter = {
    section: (sp.get("section") as Section | "ALL") || "ALL",
    level: (sp.get("level") as Level | "ALL") || "ALL",
    state: (sp.get("state") as WrongFilter["state"]) || "open",
    sort: (sp.get("sort") as WrongFilter["sort"]) || "recent",
  };
  const key = `wrong:${f.section}:${f.level}:${f.state}`;
  return (
    <FilterPractice
      banks={banks}
      mode="wrong"
      scopeKey={key}
      label="错题订正"
      list={() => wrongQids(banks, f)}
      back={{ to: `/wrong?${sp.toString().replace(/&?start=[^&]*/, "")}`, label: "错题本" }}
    />
  );
}

export function FavoritesPracticeRoute() {
  const banks = useBanks();
  const [sp] = useSearchParams();
  if (!banks) return <Loading />;
  const section = (sp.get("section") as Section | "ALL") || "ALL";
  const level = (sp.get("level") as Level | "ALL") || "ALL";
  const scope = (sp.get("scope") as FavScope) || "all";
  return (
    <FilterPractice
      banks={banks}
      mode="favorites"
      scopeKey={`favorites:${section}:${level}:${scope}`}
      label="收藏练习"
      list={() => favoriteQids(banks, section, level, scope)}
      back={{ to: "/favorites", label: "收藏夹" }}
    />
  );
}

export function SearchPracticeRoute() {
  const banks = useBanks();
  const [sp] = useSearchParams();
  if (!banks) return <Loading />;
  const query = sp.get("q") ?? "";
  const filters = { section: sp.get("section") ?? "ALL", level: sp.get("level") ?? "ALL", status: sp.get("status") ?? "all" };
  return (
    <FilterPractice
      banks={banks}
      mode="search"
      scopeKey={`search:${query}|${filters.section}|${filters.level}|${filters.status}`}
      label={`搜索：${query}`}
      list={() => searchQids(banks, query, filters)}
      back={{ to: `/search?${sp.toString().replace(/&?start=[^&]*/, "")}`, label: "搜索结果" }}
    />
  );
}
