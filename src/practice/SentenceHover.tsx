import { useEffect, useState, type RefObject } from "react";
import type { P2Question } from "../data/p2";

interface Tip {
  text: string;
  top: number;
  left: number;
  below: boolean;
}

/**
 * Hover translation (SPEC-P2 §9.2): hovering a sentence of the original text
 * shades every piece of it, across lines, and floats its translation above.
 * Works on the data-sid attributes HighlightableText puts on sentence pieces,
 * by toggling a class directly so the text is not re-rendered on every move.
 */
export function SentenceHover({ root, p2, lang }: { root: RefObject<HTMLElement | null>; p2: P2Question | null; lang: "zh" | "en" | null }) {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const el = root.current;
    const segs = p2?.segments;
    if (!el || !segs || !lang) return;
    let sid: number | null = null;
    const clear = () => {
      el.querySelectorAll(".sent-hover").forEach((n) => n.classList.remove("sent-hover"));
      sid = null;
      setTip(null);
    };
    const pieceOf = (t: EventTarget | null) => {
      const n = (t as Element | null)?.closest?.("[data-sid]");
      // ignore text that is blurred or hidden (listening transcript before it is shown)
      return n && el.contains(n) && !n.closest(".blurred") ? n : null;
    };
    const onOver = (e: MouseEvent) => {
      const n = pieceOf(e.target);
      if (!n) return;
      const next = Number(n.getAttribute("data-sid"));
      if (next === sid) return;
      clear();
      const seg = segs[next];
      if (!seg) return;
      sid = next;
      el.querySelectorAll(`[data-sid="${next}"]`).forEach((p) => p.classList.add("sent-hover"));
      const r = n.getBoundingClientRect();
      const below = r.top < 90;
      setTip({ text: seg[lang], top: below ? r.bottom + 6 : r.top - 6, left: Math.max(8, Math.min(window.innerWidth - 428, r.left)), below });
    };
    const onOut = (e: MouseEvent) => {
      if (sid === null) return;
      const to = pieceOf(e.relatedTarget);
      if (!to || Number(to.getAttribute("data-sid")) !== sid) clear();
    };
    el.addEventListener("mouseover", onOver);
    el.addEventListener("mouseout", onOut);
    window.addEventListener("scroll", clear, true);
    return () => {
      el.removeEventListener("mouseover", onOver);
      el.removeEventListener("mouseout", onOut);
      window.removeEventListener("scroll", clear, true);
      clear();
    };
  }, [root, p2, lang]);

  if (!tip) return null;
  return (
    <div
      className={
        "pointer-events-none fixed z-[60] max-w-[420px] rounded-lg bg-foreground px-2.5 py-1.5 text-sm leading-[1.55] text-background shadow-lg" +
        (tip.below ? "" : " -translate-y-full")
      }
      style={{ top: tip.top, left: tip.left }}
    >
      {tip.text}
    </div>
  );
}
