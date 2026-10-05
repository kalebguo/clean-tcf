import type { HighlightField } from "../db/schema";

export interface BlockSelection {
  field: HighlightField;
  index: number;
  start: number;
  end: number;
}

/** Character offset of (node, offset) inside `root`. */
function offsetIn(root: Element, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Split the current selection into per-block ranges inside `container`. */
export function readSelection(container: Element): { blocks: BlockSelection[]; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const blocks: BlockSelection[] = [];
  container.querySelectorAll("[data-hl-block]").forEach((el) => {
    if (!range.intersectsNode(el)) return;
    const len = el.textContent?.length ?? 0;
    const start = el.contains(range.startContainer) ? offsetIn(el, range.startContainer, range.startOffset) : 0;
    const end = el.contains(range.endContainer) ? offsetIn(el, range.endContainer, range.endOffset) : len;
    // trim surrounding whitespace so a sloppy drag still gives a clean highlight
    const text = el.textContent ?? "";
    let s = Math.max(0, Math.min(start, len));
    let e = Math.max(0, Math.min(end, len));
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) {
      blocks.push({
        field: el.getAttribute("data-hl-field") as HighlightField,
        index: Number(el.getAttribute("data-hl-index")),
        start: s,
        end: e,
      });
    }
  });
  return blocks.length ? { blocks, rect: range.getBoundingClientRect() } : null;
}
