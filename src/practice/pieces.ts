import type { EvidenceRange, SentenceRange } from "../data/p2";

export interface Range {
  start: number;
  end: number;
}

/**
 * A run of text whose marks are all the same. Rendering one element per piece,
 * with the text unchanged, keeps DOM character offsets equal to data offsets.
 */
export interface Piece {
  s: number;
  e: number;
  /** highlight id covering this piece */
  hl?: string;
  /** sentence (segment) index covering this piece */
  sid?: number;
  /** evidence style: the shortest quote covering the piece wins, so a trap inside an answer sentence stays visible */
  ev?: "answer" | "trap";
  /** labels of the quotes that end at this piece, e.g. "B" or "A·D" */
  evEnd?: string;
  evEndAnswer?: boolean;
}

/**
 * Cut [0, len) into pieces at every boundary of every mark.
 * Highlights are taken in start order and an overlapping one is skipped, as P1 did;
 * sentences never overlap; evidence quotes may overlap each other.
 */
export function cutPieces(
  len: number,
  highlights: { id: string; r: Range }[],
  sentences: SentenceRange[] = [],
  evidence: EvidenceRange[] = [],
): Piece[] {
  const clamp = (n: number) => Math.max(0, Math.min(len, n));
  const hls: { id: string; s: number; e: number }[] = [];
  let pos = 0;
  for (const { id, r } of [...highlights].sort((a, b) => a.r.start - b.r.start)) {
    const s = clamp(r.start), e = clamp(r.end);
    if (s < pos || e <= s) continue;
    hls.push({ id, s, e });
    pos = e;
  }
  const sents = sentences.map((x) => ({ ...x, s: clamp(x.s), e: clamp(x.e) })).filter((x) => x.e > x.s);
  const evs = evidence.map((x) => ({ ...x, s: clamp(x.s), e: clamp(x.e) })).filter((x) => x.e > x.s);

  const cuts = new Set([0, len]);
  for (const x of [...hls, ...sents, ...evs]) {
    cuts.add(x.s);
    cuts.add(x.e);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const pieces: Piece[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const s = points[i], e = points[i + 1];
    if (e <= s) continue;
    const p: Piece = { s, e };
    const h = hls.find((x) => x.s <= s && e <= x.e);
    if (h) p.hl = h.id;
    const st = sents.find((x) => x.s <= s && e <= x.e);
    if (st) p.sid = st.sid;
    const covering = evs.filter((x) => x.s <= s && e <= x.e).sort((a, b) => a.e - a.s - (b.e - b.s));
    if (covering.length) p.ev = covering[0].answer ? "answer" : "trap";
    const ending = evs.filter((x) => x.e === e && x.s <= s);
    if (ending.length) {
      p.evEnd = [...new Set(ending.map((x) => x.label))].sort().join("·");
      p.evEndAnswer = ending.some((x) => x.answer);
    }
    pieces.push(p);
  }
  return pieces;
}
