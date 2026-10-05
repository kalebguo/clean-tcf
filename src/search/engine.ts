import MiniSearch from "minisearch";
import { summaryText, type Banks } from "../data/bank";
import type { Question } from "../data/types";
import { fold } from "./fold";
import { matchId, parseQuery } from "./parseQuery";

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  q: Question;
  score: number;
  snippet: Snippet | null;
}

interface Doc {
  id: string;
  question: string;
  options: string;
  text: string;
  analysis: string;
  lemmas: string;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");

/** Plain text a snippet is cut from: question, options, then transcript / passage. */
export function plainText(q: Question): string {
  return [q.question ?? "", ...q.options, ...(q.transcript ?? []), ...(q.passage ?? [])].filter(Boolean).join(" · ");
}

export class SearchEngine {
  private ms: MiniSearch<Doc>;
  private texts = new Map<string, string>();

  constructor(private banks: Banks, lemmas: Record<string, string[]>) {
    this.ms = new MiniSearch<Doc>({
      fields: ["question", "options", "text", "analysis", "lemmas"],
      processTerm: (t) => fold(t),
      searchOptions: {
        boost: { question: 3, options: 2, text: 1, analysis: 1, lemmas: 1 },
        prefix: true,
        fuzzy: (term) => (term.length >= 5 ? 1 : false),
        combineWith: "AND",
      },
    });
    const docs: Doc[] = [];
    for (const q of [...banks.CO.questions, ...banks.CE.questions]) {
      this.texts.set(q.id, plainText(q));
      docs.push({
        id: q.id,
        question: q.question ?? (q.transcript ?? []).slice(-1).join(" "),
        options: q.options.join(" "),
        text: [...(q.transcript ?? []), ...(q.passage ?? [])].join(" "),
        analysis: q.analysis ? stripHtml(q.analysis) : "",
        lemmas: (lemmas[q.id] ?? []).join(" "),
      });
    }
    this.ms.addAll(docs);
  }

  search(raw: string, limit = 200): SearchHit[] {
    const p = parseQuery(raw);
    if (p.kind === "empty") return [];
    const all = [...this.banks.CO.questions, ...this.banks.CE.questions];
    if (p.kind === "id") {
      return all.filter((q) => matchId(q, p)).map((q) => ({ q, score: 1, snippet: summarySnippet(q) }));
    }
    if (!p.terms) return all.filter((q) => q.section === p.section).slice(0, limit).map((q) => ({ q, score: 1, snippet: summarySnippet(q) }));
    const terms = p.terms.split(" ").filter(Boolean);
    const phrases = p.phrases.map(fold);
    return this.ms
      .search(p.terms)
      .map((r) => ({ q: this.banks.get(r.id)!, score: r.score }))
      .filter(({ q }) => q && (!p.section || q.section === p.section))
      .filter(({ q }) => phrases.every((ph) => fold(this.texts.get(q.id)!).includes(ph)))
      .slice(0, limit)
      .map(({ q, score }) => ({ q, score, snippet: makeSnippet(this.texts.get(q.id)!, phrases.length ? phrases : terms) }));
  }
}

/** Cut ±40 characters around the first occurrence of any needle (accent-insensitive). */
export function makeSnippet(text: string, needles: string[], radius = 40): Snippet | null {
  const ft = fold(text);
  let best: { i: number; len: number } | null = null;
  for (const n of needles) {
    const fn = fold(n);
    if (!fn) continue;
    const i = ft.indexOf(fn);
    if (i >= 0 && (!best || i < best.i)) best = { i, len: fn.length };
  }
  if (!best) return { before: "", match: "", after: text.slice(0, radius * 2) + (text.length > radius * 2 ? "…" : "") };
  const s = Math.max(0, best.i - radius);
  const e = Math.min(text.length, best.i + best.len + radius);
  return {
    before: (s > 0 ? "…" : "") + text.slice(s, best.i),
    match: text.slice(best.i, best.i + best.len),
    after: text.slice(best.i + best.len, e) + (e < text.length ? "…" : ""),
  };
}

function summarySnippet(q: Question): Snippet {
  const t = summaryText(q);
  return { before: "", match: "", after: t.length > 90 ? t.slice(0, 90) + "…" : t };
}

let enginePromise: Promise<SearchEngine> | null = null;

/** Built lazily on first search. */
export function getEngine(banks: Banks): Promise<SearchEngine> {
  enginePromise ??= fetch("/data/search-lemmas.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((lemmas: Record<string, string[]>) => new SearchEngine(banks, lemmas));
  return enginePromise;
}
