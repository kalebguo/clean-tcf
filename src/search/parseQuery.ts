import type { Question, Section } from "../data/types";

export type ParsedQuery =
  | { kind: "empty" }
  | { kind: "id"; section?: Section; ref: string; num?: number }
  | { kind: "text"; section?: Section; terms: string; phrases: string[] };

const SECTION_PREFIX = /^(CO|CE|听力|阅读)(?:\s*[-:：]?\s*)(?=\S)/i;

/**
 * Question-number syntax (SPEC §7):
 *   5-8       set 5, question 8          155-8   series 155, question 8
 *   GR01-3    free set 1, question 3     5       every question of set / series 5
 *   CO-5-8 / 听力 5-8                    restrict to a section
 * Anything else is a text query; "double-quoted" parts are exact phrases.
 */
export function parseQuery(raw: string): ParsedQuery {
  let s = raw.trim();
  if (!s) return { kind: "empty" };
  let section: Section | undefined;
  const m = s.match(SECTION_PREFIX);
  if (m) {
    const p = m[1].toUpperCase();
    section = p === "CO" || p === "听力" ? "CO" : "CE";
    s = s.slice(m[0].length).trim();
  }
  const id = s.match(/^((?:GR|F)?\d{1,3})(?:-(\d{1,2}))?$/i);
  if (id) return { kind: "id", section, ref: id[1].toUpperCase(), num: id[2] ? Number(id[2]) : undefined };
  if (!s && section) return { kind: "text", section, terms: "", phrases: [] };
  const phrases: string[] = [];
  const terms = s.replace(/"([^"]+)"/g, (_, p: string) => {
    phrases.push(p.trim());
    return " " + p + " ";
  });
  return { kind: "text", section, terms: terms.replace(/\s+/g, " ").trim(), phrases: phrases.filter(Boolean) };
}

/** Questions matching a parsed id query. Sets are compared without leading zeros (GR01 = GR1). */
export function matchId(q: Question, p: Extract<ParsedQuery, { kind: "id" }>): boolean {
  if (p.section && q.section !== p.section) return false;
  const norm = (x: string) => x.toUpperCase().replace(/^(GR|F)?0*(\d)/, "$1$2");
  const ref = norm(p.ref);
  return q.appearances.some(
    (a) => (norm(a.set) === ref || (a.series !== undefined && norm(a.series) === ref)) && (p.num === undefined || a.num === p.num),
  );
}
