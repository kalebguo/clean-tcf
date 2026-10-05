import { Check, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LevelTag } from "../components/controls";
import { WordDetails, WordHead } from "../components/WordCard";
import { briefOf, sayWord, type DictEntry } from "../data/dict";
import { postponeCard, rateCard, type Grade } from "../db/cards";
import type { FlashCard } from "../db/schema";
import { useShortcuts } from "../practice/useShortcuts";
import { RatingBar } from "./RatingBar";
import { CHECK_TEXT, checkTyped, choicesOf, clozeOf, hash, MODE_OF, type WordMode } from "./wordModes";

const GENDER: Record<string, string> = { m: "阳性", f: "阴性", "m/f": "阴阳同形" };

interface Props {
  entry: DictEntry | undefined;
  lemma: string;
  card: FlashCard;
  mode: WordMode;
  /** the whole word list, for the wrong options of the choice mode */
  entries: DictEntry[] | undefined;
  onDone(after: FlashCard | undefined, grade?: Grade): void;
  /** "已掌握": take the word out of the deck */
  onKnown(): void;
}

const PLACEHOLDER: Partial<Record<WordMode, string>> = {
  cloze: "填入句子里的形式，回车检查",
  spell: "写出法语原形，回车检查",
  dictation: "写出听到的词，回车检查",
};

const LETTERS = ["A", "B", "C", "D"];

/**
 * One word card in one of the seven modes (wordModes.ts). The front asks; the back always shows
 * the word, its short meaning and the full dictionary entry. Typed modes check the answer
 * before the back shows; giving up rates the card "again".
 */
export function WordFlashcard({ entry: e, lemma, card, mode: wanted, entries, onDone, onKnown }: Props) {
  const choice = useMemo(
    () => (wanted === "choice" && e && entries ? choicesOf(e, entries, hash(card.id) + card.reps) : null),
    [wanted, e, entries, card.id, card.reps],
  );
  const mode: WordMode = wanted === "choice" && !choice ? "recognize" : wanted;
  const typed = MODE_OF[mode].typed;
  const cloze = useMemo(() => (mode === "cloze" && e ? clozeOf(e, card.reps) : null), [mode, e, card.reps]);
  const answer = cloze?.answer ?? lemma;
  const [revealed, setRevealed] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [forced, setForced] = useState<FlashCard | null>(null);
  const forcedRating = useRef<Promise<FlashCard | undefined> | null>(null);
  const busy = useRef(false);
  const played = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const say = () => sayWord(e ?? { lemma });
  // sound first for the French and listening modes; for the others, when the answer shows
  const soundFirst = mode === "recognize" || mode === "choice" || mode === "listen" || mode === "dictation";
  useEffect(() => {
    if (played.current || (!soundFirst && !revealed)) return;
    played.current = true;
    say();
  }, [revealed]); // eslint-disable-line react-hooks/exhaustive-deps

  const brief = e && briefOf(e);

  const check = () => {
    const r = checkTyped(text, answer, e ?? { lemma, forms: [] });
    if (r === "empty") return;
    if (r === "ok") {
      setMiss(null);
      setRevealed(true);
      return;
    }
    setMiss(CHECK_TEXT[r][mode === "cloze" ? "cloze" : "base"]);
    input.current?.select();
  };
  const giveUp = () => {
    forcedRating.current = rateCard(card.id, 1);
    void forcedRating.current.then((c) => setForced(c ?? null));
    setRevealed(true);
  };
  const rate = (g: Grade) => {
    if (busy.current || !revealed) return;
    busy.current = true;
    if (forcedRating.current) return void forcedRating.current.then((c) => onDone(c, 1));
    void rateCard(card.id, g).then((c) => onDone(c, g));
  };
  const postpone = () => {
    if (busy.current || revealed) return;
    busy.current = true;
    void postponeCard(card.id).then((c) => onDone(c));
  };
  /** choice mode: a wrong pick rates the card "again" at once, as on question cards */
  const choose = (i: number) => {
    if (!choice || revealed || i >= choice.options.length) return;
    setPicked(i);
    if (i !== choice.answer) {
      forcedRating.current = rateCard(card.id, 1);
      void forcedRating.current.then((c) => setForced(c ?? null));
    }
    setRevealed(true);
  };
  const known = () => {
    if (busy.current || forcedRating.current) return;
    busy.current = true;
    onKnown();
  };
  const flip = () => !typed && mode !== "choice" && setRevealed(true);
  const key = (i: number) => (revealed ? rate((i + 1) as Grade) : choose(i));

  useShortcuts(
    {
      " ": () => (revealed ? say() : flip()),
      enter: () => (revealed ? rate(3) : flip()),
      r: say,
      "1": () => key(0), "2": () => key(1), "3": () => key(2), "4": () => key(3),
      a: () => choose(0), b: () => choose(1), c: () => choose(2), d: () => choose(3),
      s: postpone,
    },
    true,
  );

  const meta = (
    <div className="text-sm text-muted-foreground">
      {e?.posLabel}
      {e?.gender && ` · ${GENDER[e.gender]}`}
    </div>
  );
  const listenButton = (
    <Button variant="outline" size="lg" className="rounded-full" onClick={say} title="再听一遍（R）">
      <Volume2 /> 再听一遍（R）
    </Button>
  );

  let front: React.ReactNode;
  if (mode === "recognize" || mode === "choice" || (mode === "listen" && revealed)) {
    front = (
      <>
        <div className="font-serif text-4xl font-semibold">{lemma}</div>
        <div className="text-sm text-muted-foreground">
          {e?.ipa && <span className="mr-2 font-serif">{e.ipa}</span>}
          {e?.posLabel}
          {e?.gender && ` · ${GENDER[e.gender]}`}
        </div>
      </>
    );
  } else if (mode === "listen" || mode === "dictation") {
    front = (
      <>
        {listenButton}
        {mode === "dictation" && meta}
      </>
    );
  } else if (mode === "cloze" && cloze) {
    front = (
      <>
        <p className="max-w-[640px] font-serif text-xl leading-relaxed">
          {cloze.before}
          {revealed ? (
            <mark className="rounded bg-primary/15 px-1 text-primary">{cloze.answer}</mark>
          ) : (
            <span className="mx-0.5 inline-block border-b-2 border-primary px-1 font-sans tracking-[0.2em] text-primary">
              {cloze.answer[0]}
              {"_".repeat(Math.max(0, cloze.answer.length - 1))}
            </span>
          )}
          {cloze.after}
        </p>
        {revealed && cloze.zh && <p className="max-w-[640px] text-sm text-muted-foreground">{cloze.zh}</p>}
        {!revealed && (
          <div className="text-sm text-muted-foreground">
            {brief?.text}
            {e?.posLabel && ` · ${e.posLabel}`} · 例句出自 {cloze.qid}
          </div>
        )}
      </>
    );
  } else {
    // recall, spell (and cloze without a sentence, which pickMode avoids)
    front = (
      <>
        <div className="text-2xl font-semibold">{brief?.text || <span className="text-muted-foreground">词典里没有这个词的释义</span>}</div>
        <div className="text-sm text-muted-foreground">
          {e?.posLabel}
          {e?.gender && ` · ${GENDER[e.gender]}`}
          {brief?.source === "mt" ? " · 机器翻译" : brief?.source === "en" ? " · 英文释义" : ""}
        </div>
      </>
    );
  }

  const hint = typed
    ? "回车检查 · 不会就点「看答案」"
    : mode === "choice"
      ? "1–4 或 A–D 选择 · 选错记「重来」"
      : mode === "listen"
        ? "R 再听一遍 · 空格翻面"
        : "空格或回车翻面";

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
        <div className="mb-[-6px] text-xs text-muted-foreground">{MODE_OF[mode].label}</div>
        <div className="flex flex-col items-center gap-2.5 pt-3 pb-1.5 text-center">
          {front}
          {typed && !revealed && (
            <div className="flex w-full flex-wrap justify-center gap-2">
              <Input
                ref={input}
                className="h-10 w-[min(320px,100%)] text-lg md:text-lg"
                autoFocus
                value={text}
                onChange={(ev) => {
                  setText(ev.target.value);
                  setMiss(null);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") check();
                  if (ev.key === "Escape") (ev.target as HTMLInputElement).blur();
                }}
                placeholder={PLACEHOLDER[mode]}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <Button variant="outline" className="h-10" onClick={giveUp}>
                看答案
              </Button>
              {miss && <div className="w-full text-xs text-wrong">{miss}</div>}
            </div>
          )}
          {choice && (
            <div className="grid w-full max-w-[640px] gap-2 sm:grid-cols-2" role="radiogroup">
              {choice.options.map((o, i) => {
                const right = i === choice.answer;
                const tone = !revealed ? "" : right ? "border-correct bg-correct/10 text-correct" : i === picked ? "border-wrong bg-wrong/10 text-wrong" : "opacity-60";
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={i === picked}
                    disabled={revealed}
                    className={cn("flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left text-[15px] transition-colors enabled:hover:bg-muted", tone)}
                    onClick={() => choose(i)}
                  >
                    <span className={cn("w-4 shrink-0 font-bold", !revealed && "text-muted-foreground")}>{LETTERS[i]}</span>
                    <span className="flex-1">{o}</span>
                    {revealed && (right ? <Check className="size-4 shrink-0" /> : i === picked && <X className="size-4 shrink-0" />)}
                  </button>
                );
              })}
            </div>
          )}
          {!typed && !choice && !revealed && (
            <Button size="lg" onClick={() => setRevealed(true)}>
              显示答案（空格）
            </Button>
          )}
        </div>
        {revealed && (
          <div className="flex flex-col gap-2.5 border-t border-dashed pt-3.5">
            {e ? (
              <>
                <WordHead e={e}>
                  <span className="flex-1" />
                  <LevelTag level={e.level} />
                </WordHead>
                {brief && <div className="text-lg font-semibold">{brief.text}</div>}
                {typed && !forced && text && <div className="text-xs text-correct">{mode === "cloze" ? "填对了" : "拼写正确"}</div>}
                <WordDetails e={e} />
              </>
            ) : (
              <b className="font-serif text-lg">{lemma}</b>
            )}
          </div>
        )}
      </div>
      <RatingBar
        card={card}
        state={!revealed ? "front" : forcedRating.current ? "forced" : "rate"}
        forced={forced}
        hint={hint}
        onRate={rate}
        onPostpone={postpone}
        extra={
          !forcedRating.current && (
            <Button variant="ghost" size="lg" onClick={known} title="已经会了：移出牌堆。在闪卡页可以放回">
              <Check /> 已掌握
            </Button>
          )
        }
      />
    </div>
  );
}
