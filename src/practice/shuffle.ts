import { LETTERS, type Letter } from "../data/types";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Display order of the four options: order[displayPos] = original index.
 * Deterministic per (seed, qid) so a reload shows the same order.
 */
export function optionOrder(seed: string, qid: string, shuffle: boolean): number[] {
  const order = [0, 1, 2, 3];
  if (!shuffle) return order;
  let x = hash(seed + "|" + qid) || 1;
  for (let i = 3; i > 0; i--) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const j = (x >>> 0) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Original letter shown at a display position. */
export function originalLetter(order: number[], displayPos: number): Letter {
  return LETTERS[order[displayPos]];
}

/** Display position of an original letter. */
export function displayLetter(order: number[], original: Letter): Letter {
  return LETTERS[order.indexOf(LETTERS.indexOf(original))];
}
