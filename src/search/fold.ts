/**
 * Lowercase and strip accents character by character, keeping a 1:1 mapping
 * with the input so match positions in the folded string are valid in the
 * original (é → e, À → a; œ stays œ).
 */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === ch.length ? f : ch.toLowerCase().slice(0, ch.length);
  }
  return out;
}
