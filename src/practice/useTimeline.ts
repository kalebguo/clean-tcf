import { useEffect, useMemo, type RefObject } from "react";
import { blockStarts, timedWordAt, type TimedWord } from "../data/timed";
import type { AudioHandle } from "./AudioBar";

const HL = "tl-word";
const supported = typeof CSS !== "undefined" && "highlights" in CSS;

/** A DOM range over characters s..e of a text block (its text nodes taken in order). */
function rangeIn(block: Element, s: number, e: number): Range | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0;
  let started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (!started && s < pos + len) {
      r.setStart(n, s - pos);
      started = true;
    }
    if (started && e <= pos + len) {
      r.setEnd(n, e - pos);
      return r;
    }
    pos += len;
  }
  return null;
}

/** Character offset inside `block` of the point clicked. */
function offsetAtPoint(block: Element, x: number, y: number): number | null {
  const d = document as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) [node, offset] = [p.offsetNode, p.offset];
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  if (!node || !block.contains(node)) return null;
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setEnd(node, offset);
  return r.toString().length;
}

const blockOf = (root: HTMLElement | null, w: TimedWord) =>
  root?.querySelector(`[data-hl-field="${w[0]}"][data-hl-index="${w[1]}"]`) ?? null;

/**
 * Follow a recording on its text (SPEC §5.B listening timeline, §5.A reading aloud): the word being
 * said is marked (CSS Custom Highlight, so the text is not re-rendered), a single click on a word plays
 * from it, and [ / ] go to the previous / next line or paragraph. `follow` is off while the text is
 * hidden or translated; `shortcuts` turns the [ / ] keys on.
 */
export function useTimeline(
  root: RefObject<HTMLElement | null>,
  words: TimedWord[] | null,
  audio: RefObject<AudioHandle | null>,
  follow: boolean,
  shortcuts: boolean,
) {
  // the word being said
  useEffect(() => {
    const el = audio.current?.element();
    if (!supported) return;
    if (!words || !follow || !el) {
      CSS.highlights.delete(HL);
      return;
    }
    // one registered Highlight whose range changes: WebKit does not repaint the old word when
    // CSS.highlights.set replaces the Highlight, so every word said stayed marked (iOS app)
    const hl = new Highlight();
    CSS.highlights.set(HL, hl);
    let raf = 0;
    let shown = -2;
    const update = () => {
      const k = timedWordAt(words, el.currentTime);
      if (k === shown) return;
      shown = k;
      const w = words[k];
      const block = w && blockOf(root.current, w);
      const r = block && rangeIn(block, w[2], w[3]);
      hl.clear();
      if (r) hl.add(r);
    };
    const loop = () => {
      update();
      if (!el.paused) raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("seeked", update);
    el.addEventListener("pause", update);
    if (!el.paused) onPlay();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("seeked", update);
      el.removeEventListener("pause", update);
      hl.clear();
      CSS.highlights.delete(HL);
    };
  }, [words, follow, audio, root]);

  // single click on a word: play from it (a double click looks the word up instead)
  const byBlock = useMemo(() => {
    const m = new Map<string, TimedWord[]>();
    for (const w of words ?? []) {
      const k = `${w[0]}:${w[1]}`;
      m.set(k, [...(m.get(k) ?? []), w]);
    }
    return m;
  }, [words]);
  useEffect(() => {
    const el = root.current;
    if (!words || !follow || !el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.detail !== 1 || window.getSelection()?.toString()) return;
      const block = (e.target as Element).closest?.("[data-hl-field]");
      const inBlock = block && byBlock.get(`${block.getAttribute("data-hl-field")}:${block.getAttribute("data-hl-index")}`);
      if (!block || !inBlock) return;
      const off = offsetAtPoint(block, e.clientX, e.clientY);
      if (off === null) return;
      const w = inBlock.find((w) => off >= w[2] && off <= w[3]) ?? inBlock.filter((w) => w[2] <= off).pop() ?? inBlock[0];
      clearTimeout(timer);
      timer = setTimeout(() => audio.current?.playRange(w[4]), 250);
    };
    const onDbl = () => clearTimeout(timer);
    el.addEventListener("click", onClick);
    el.addEventListener("dblclick", onDbl);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("click", onClick);
      el.removeEventListener("dblclick", onDbl);
    };
  }, [words, byBlock, follow, audio, root]);

  // [ / ]: start of the previous / next line or paragraph
  useEffect(() => {
    const starts = words ? blockStarts(words) : [];
    if (!shortcuts || !starts.length) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "[" && e.key !== "]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable=true], [data-no-shortcuts]")) return;
      const el = audio.current?.element();
      if (!el) return;
      e.preventDefault();
      const now = el.currentTime;
      let target: number | undefined;
      if (e.key === "]") target = starts.find((s) => s > now + 0.05);
      else target = starts.filter((s) => s < now - 0.8).pop() ?? starts[0]; // within 0.8 s of a line's start: the one before
      if (target !== undefined) audio.current?.playRange(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [words, shortcuts, audio]);
}
