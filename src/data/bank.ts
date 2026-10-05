import { useEffect, useState } from "react";
import { SECTION_SLUG, type Bank, type Question, type Section } from "./types";

const cache = new Map<Section, Promise<Bank>>();

export function loadBank(section: Section): Promise<Bank> {
  let p = cache.get(section);
  if (!p) {
    p = fetch(`/data/${SECTION_SLUG[section]}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`无法加载题库 ${section}: ${r.status}`);
        return r.json();
      })
      .then((raw: { questions: Question[]; sets: Bank["sets"] }) => ({
        section,
        questions: raw.questions,
        sets: raw.sets,
        byId: new Map(raw.questions.map((q) => [q.id, q])),
      }));
    cache.set(section, p);
  }
  return p;
}

export interface Banks {
  CO: Bank;
  CE: Bank;
  get(qid: string): Question | undefined;
}

let banksPromise: Promise<Banks> | null = null;
/** Set when loaded, so later pages render at once (and back / forward can restore the scroll position). */
let banksLoaded: Banks | null = null;

export function loadBanks(): Promise<Banks> {
  banksPromise ??= Promise.all([loadBank("CO"), loadBank("CE")]).then(([CO, CE]) => {
    banksLoaded = { CO, CE, get: (qid: string) => (qid.startsWith("CO-") ? CO : CE).byId.get(qid) };
    return banksLoaded;
  });
  return banksPromise;
}

/** Both question banks (about 2.7 MB of JSON); null while loading. */
export function useBanks(): Banks | null {
  const [banks, setBanks] = useState<Banks | null>(banksLoaded);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    loadBanks().then(setBanks, setError);
  }, []);
  if (error) throw error;
  return banks;
}

export function formatAppearances(q: Question): string {
  return q.appearances
    .flatMap((a) => (a.series ? [`${a.set}-${a.num}`, `${a.series}-${a.num}`] : [`${a.set}-${a.num}`]))
    .join(", ");
}

/** Listening items 1–4 read the options aloud and show only "Proposition A–D". */
export function isPictureItem(q: Question): boolean {
  return q.section === "CO" && q.options.every((o) => !o);
}

/** One-line summary for list pages. */
export function summaryText(q: Question): string {
  if (q.section === "CE") return q.question || q.passage?.[0] || "";
  if (isPictureItem(q)) return "看图题：" + (q.transcript ?? []).join(" ");
  const t = q.transcript ?? [];
  return t[t.length - 1] ?? "";
}

export function displayNo(q: Question): string {
  const a = q.appearances[0];
  return `${q.section === "CO" ? "听力" : "阅读"} ${a.set}-${a.num}`;
}
