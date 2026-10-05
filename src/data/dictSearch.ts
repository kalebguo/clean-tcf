import type { Conjugations } from "./conj";
import { lookup, normalizeWord, stripAccents, type Dict, type DictEntry } from "./dict";

const HAN = /\p{Script=Han}/u;

/**
 * Words for the lookup box. French: the word itself or any inflected form (also one the
 * bank never uses, through the conjugation tables), then words starting with it, then
 * English meanings. Chinese: words whose Chinese meaning is it, starts with it, contains it.
 */
export function searchDict(dict: Dict, conj: Conjugations | null | undefined, query: string, limit = 12): DictEntry[] {
  const q = query.trim();
  if (!q) return [];
  const out: DictEntry[] = [];
  const push = (e: DictEntry | undefined) => {
    if (e && !out.includes(e)) out.push(e);
  };

  if (HAN.test(q)) {
    // 0: it is the first meaning; 1: one of the meanings; 2: a meaning starts with it; 3: contains it
    const score = (e: DictEntry) => {
      let best = e.brief?.[0] === q ? 0 : e.brief?.includes(q) ? 1 : 9;
      e.zh.forEach((z, i) => {
        const parts = z.split(/[，,、]/).map((s) => s.replace(/^[（(][^）)]*[）)]/, "").trim());
        best = Math.min(best, parts.includes(q) ? (i === 0 ? 0 : 1) : z.startsWith(q) ? 2 : z.includes(q) ? 3 : 9);
      });
      return best;
    };
    return dict.entries
      .map((e) => [score(e), e] as const)
      .filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0] || a[1].rank - b[1].rank)
      .slice(0, limit)
      .map(([, e]) => e);
  }

  lookup(dict, q).forEach(push);
  const n = normalizeWord(q);
  for (const h of conj?.index.get(n) ?? conj?.index.get(stripAccents(n)) ?? []) push(dict.byLemma.get(h.lemma));
  const prefix = stripAccents(n);
  if (prefix) {
    dict.entries
      .filter((e) => e.verified !== false && stripAccents(e.lemma).startsWith(prefix))
      .sort((a, b) => a.lemma.length - b.lemma.length || a.rank - b.rank)
      .slice(0, limit)
      .forEach(push);
  }
  if (out.length < limit && /^[a-z][a-z' -]+$/i.test(q)) {
    const word = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    dict.entries.filter((e) => e.en?.some((g) => word.test(g))).slice(0, limit).forEach(push);
  }
  return out.slice(0, limit);
}
