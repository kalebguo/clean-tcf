import {
  Briefcase, GraduationCap, HeartPulse, House, Landmark, Leaf, Palette, Plane, ShoppingBag, Smartphone, Users, type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Speaking / writing prompts (SPEC §5.J), built by scripts/oral_writing/build_site.py.
 * A subject is one distinct prompt of a tâche; a set is what one exam session got:
 * speaking = one tâche, five subjects ("combinaison"); writing = one subject per tâche.
 */
export type OralKind = "writing" | "speaking";

export interface Subject {
  id: string;
  tache: number;
  text: string;
  /** writing Tâche 3: title and the two documents */
  intro?: string;
  docs?: [string, string];
  /** "2026.01", oldest first */
  months: string[];
  sets: string[];
  /** Chinese title and topic, written by Opus (scripts/oral_writing/labels.py); missing for new prompts not labelled yet */
  zh?: string;
  cat?: TopicCat;
}

/** Topic categories of the prompts; the same 11 ids as data/oral-writing/LABEL_GUIDE.md. */
export type TopicCat =
  | "work" | "study" | "tech" | "environment" | "health" | "travel" | "housing" | "family" | "leisure" | "consumption" | "society";

export const TOPICS: { id: TopicCat; zh: string; icon: LucideIcon }[] = [
  { id: "work", zh: "工作职业", icon: Briefcase },
  { id: "study", zh: "教育学习", icon: GraduationCap },
  { id: "tech", zh: "科技媒体", icon: Smartphone },
  { id: "environment", zh: "环境自然", icon: Leaf },
  { id: "health", zh: "健康运动", icon: HeartPulse },
  { id: "travel", zh: "旅行交通", icon: Plane },
  { id: "housing", zh: "住房城市", icon: House },
  { id: "family", zh: "家庭人际", icon: Users },
  { id: "leisure", zh: "文化休闲", icon: Palette },
  { id: "consumption", zh: "消费服务", icon: ShoppingBag },
  { id: "society", zh: "社会公共", icon: Landmark },
];
export const TOPIC = new Map(TOPICS.map((t) => [t.id, t]));

export function isTopic(v: string | null): v is TopicCat {
  return v !== null && TOPIC.has(v as TopicCat);
}

export interface OralSet {
  id: string;
  ym: string;
  /** speaking: the tâche; writing: undefined (a writing set has all three) */
  tache?: number;
  /** number of the set or combinaison within its month */
  no: number;
  /** speaking: the five subjects; writing: [t1, t2, t3] */
  subjects: string[];
  /** writing: an earlier set with the same three tâches */
  sameAs?: string | null;
}

export interface OralBank {
  kind: OralKind;
  subjects: Subject[];
  sets: OralSet[];
  subject: Map<string, Subject>;
  set: Map<string, OralSet>;
  /** months that have sets, oldest first */
  months: string[];
}

export interface OralData {
  writing: OralBank;
  speaking: OralBank;
}

interface RawFile {
  speaking: { sets: { id: string; ym: string; tache: number; combo: number; subjects: string[] }[]; subjects: Subject[] };
  writing: {
    sets: { id: string; ym: string; set: number; sameAs: string | null; t1: string; t2: string; t3: string }[];
    subjects: Subject[];
  };
}

function bank(kind: OralKind, subjects: Subject[], sets: OralSet[]): OralBank {
  return {
    kind,
    subjects,
    sets,
    subject: new Map(subjects.map((s) => [s.id, s])),
    set: new Map(sets.map((s) => [s.id, s])),
    months: [...new Set(sets.map((s) => s.ym))].sort(),
  };
}

export function buildOral(raw: RawFile): OralData {
  return {
    speaking: bank(
      "speaking",
      raw.speaking.subjects,
      raw.speaking.sets.map((s) => ({ id: s.id, ym: s.ym, tache: s.tache, no: s.combo, subjects: s.subjects })),
    ),
    writing: bank(
      "writing",
      raw.writing.subjects,
      raw.writing.sets.map((s) => ({ id: s.id, ym: s.ym, no: s.set, subjects: [s.t1, s.t2, s.t3], sameAs: s.sameAs })),
    ),
  };
}

let cache: Promise<OralData | null> | null = null;
/** Set when loaded, so later pages render at once (and back / forward can restore the scroll position). */
let loaded: OralData | null | undefined;

export function loadOral(): Promise<OralData | null> {
  cache ??= fetch("/data/oral-writing.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((raw: RawFile | null) => (loaded = raw ? buildOral(raw) : null))
    .catch(() => (loaded = null));
  return cache;
}

/** undefined while loading, null when the data file is missing */
export function useOral(): OralData | null | undefined {
  const [d, setD] = useState<OralData | null | undefined>(loaded);
  useEffect(() => {
    let live = true;
    void loadOral().then((x) => live && setD(x));
    return () => {
      live = false;
    };
  }, []);
  return d;
}

export const TACHES: Record<OralKind, number[]> = { writing: [1, 2, 3], speaking: [2, 3] };

export interface TacheInfo {
  fr: string;
  zh: string;
  /** writing: word limits; speaking: duration */
  limit: string;
  note?: string;
  desc: string;
}

export const TACHE_INFO: Record<OralKind, Record<number, TacheInfo>> = {
  writing: {
    1: { fr: "Message", zh: "短消息", limit: "60–120 词", desc: "给朋友、同事或邻居写短信或邮件：邀请、介绍、请求帮忙。" },
    2: { fr: "Article / blog", zh: "文章", limit: "120–150 词", desc: "写博客、文章或评论：讲述经历，描述事物，说明理由。" },
    3: {
      fr: "Comparaison de deux documents",
      zh: "对比论证",
      limit: "120–180 词",
      note: "第一部分 40–60 词概括两篇文档，第二部分 80–120 词表达自己的观点",
      desc: "读两篇观点相反的短文，先概括，再表明并论证自己的立场。",
    },
  },
  speaking: {
    1: { fr: "Entretien dirigé", zh: "自我介绍", limit: "2 分钟", note: "没有准备时间", desc: "回答考官关于你自己的问题：家庭、工作、学习、爱好。没有固定题目。" },
    2: { fr: "Exercice en interaction", zh: "情景提问", limit: "5 分 30 秒", note: "含 2 分钟准备", desc: "考官扮演题目里的角色，你向他提问，获取信息。" },
    3: { fr: "Expression d'un point de vue", zh: "观点论述", limit: "4 分 30 秒", note: "没有准备时间", desc: "就一个社会话题表明立场，并用理由和例子论证。" },
  },
};

export const KIND_FR: Record<OralKind, string> = { writing: "Expression écrite", speaking: "Expression orale" };
export const KIND_ZH: Record<OralKind, string> = { writing: "写作", speaking: "口语" };

/** "2026.03" → "3 月"; with year → "2026 年 3 月" */
export function fmtYm(ym: string, withYear = false): string {
  const [y, m] = ym.split(".");
  return withYear ? `${y} 年 ${Number(m)} 月` : `${Number(m)} 月`;
}

/** Subjects of one tâche, newest appearance first. */
export function subjectsOf(b: OralBank, tache: number): Subject[] {
  return b.subjects.filter((s) => s.tache === tache);
}

export function lastMonth(s: Subject): string {
  return s.months[s.months.length - 1];
}
