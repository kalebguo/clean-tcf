import { useEffect, useRef } from "react";

export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

/** Keys whose action toggles something: auto-repeat from a held key is ignored. */
const NO_REPEAT = new Set([" ", "s", "t", "r", "f", "n", "h", "enter", "a", "b", "c", "d", "1", "2", "3", "4", "q", "w", "e"]);

export function keyName(e: KeyboardEvent): string {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
}

/**
 * Practice-page shortcuts (SPEC §4.7). Ignored when typing in a field, inside
 * elements marked data-no-shortcuts, with Ctrl/Cmd/Alt held, and for
 * Space/Enter on a focused button or link (that key activates the control).
 */
export function useShortcuts(map: ShortcutMap, enabled: boolean) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=''], [contenteditable=true], [data-no-shortcuts]")) return;
      const k = keyName(e);
      if ((k === " " || k === "enter") && t?.closest("button, a, [role=button]")) return;
      const fn = ref.current[k];
      if (!fn) return;
      e.preventDefault();
      if (e.repeat && NO_REPEAT.has(k)) return;
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
