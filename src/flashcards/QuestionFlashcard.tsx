import { Lightbulb } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isPictureItem, type Banks } from "../data/bank";
import { useP2 } from "../data/p2";
import type { Letter } from "../data/types";
import { dayStart, postponeCard, rateCard, type Grade } from "../db/cards";
import { useHighlights } from "../db/highlights";
import { toggleFavorite, useFavorites } from "../db/progress";
import type { FlashCard } from "../db/schema";
import { useSettings } from "../db/settings";
import type { AudioHandle } from "../practice/AudioBar";
import { HighlightBubble } from "../practice/HighlightBubble";
import { QuestionView } from "../practice/QuestionView";
import { optionOrder, originalLetter } from "../practice/shuffle";
import { useShortcuts } from "../practice/useShortcuts";
import { RatingBar } from "./RatingBar";

interface Props {
  banks: Banks;
  card: FlashCard;
  /** after: the card as rated or postponed (undefined when it is gone); grade: the rating, none when postponed */
  onDone(after: FlashCard | undefined, grade?: Grade): void;
}

/**
 * Front: the question (listening plays at once). Choosing an option judges it: a wrong answer is
 * rated "again" on the spot; a right one lets the learner rate how hard it was.
 */
export function QuestionFlashcard({ banks, card, onDone }: Props) {
  const q = banks.get(card.id.slice(2));
  const [settings, setSettings] = useSettings();
  const favorites = useFavorites();
  const [choice, setChoice] = useState<Letter>();
  const [forced, setForced] = useState<FlashCard | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [transcript, setTranscript] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const audio = useRef<AudioHandle>(null);
  const p2 = useP2(q);
  const highlights = useHighlights(q?.id);
  const busy = useRef(false);
  const forcedRating = useRef<Promise<FlashCard | undefined> | null>(null);

  // a question removed from the bank since: skip it
  useEffect(() => {
    if (!q) onDone(undefined);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMemo(
    () => (q ? optionOrder("fc" + dayStart(Date.now()), q.id, settings.shuffle && !isPictureItem(q)) : [0, 1, 2, 3]),
    [q, settings.shuffle],
  );
  const answered = Boolean(choice);
  const correct = Boolean(q && choice === q.answer);

  const choose = (orig: Letter) => {
    if (answered || !q) return;
    setChoice(orig);
    if (orig !== q.answer) {
      forcedRating.current = rateCard(card.id, 1);
      void forcedRating.current.then((c) => setForced(c ?? null));
    }
  };
  const rate = (g: Grade) => {
    if (busy.current || !answered) return;
    busy.current = true;
    if (!correct) return void forcedRating.current?.then((c) => onDone(c, 1));
    void rateCard(card.id, g).then((c) => onDone(c, g));
  };
  const postpone = () => {
    if (busy.current || answered) return;
    busy.current = true;
    void postponeCard(card.id).then((c) => onDone(c));
  };

  const pick = (pos: number) => (answered ? rate((pos + 1) as Grade) : choose(originalLetter(order, pos)));
  useShortcuts(
    {
      a: () => !answered && pick(0), b: () => !answered && pick(1), c: () => !answered && pick(2), d: () => !answered && pick(3),
      "1": () => pick(0), "2": () => pick(1), "3": () => pick(2), "4": () => pick(3),
      " ": () => audio.current?.toggle(),
      s: postpone,
      enter: () => answered && rate(3),
      r: () => answered && setShowAnalysis((v) => !v),
      t: () => setTranscript((v) => !v),
    },
    Boolean(q) && !bubble,
  );

  if (!q) return null;
  return (
    <div>
      <QuestionView
        q={q}
        p2={p2}
        no={card.reps + 1}
        done
        entry={{ choice, peeked: false, revealed: answered }}
        order={order}
        settings={settings}
        setSettings={setSettings}
        revealAnswer={answered}
        judgeChoice={answered}
        showAnalysis={showAnalysis}
        transcriptShown={answered || transcript || settings.alwaysShowTranscript}
        onShowTranscript={() => setTranscript(true)}
        favorite={favorites.has(q.id)}
        onToggleFavorite={() => void toggleFavorite(q)}
        noteOpen={noteOpen}
        onToggleNote={() => setNoteOpen((o) => !o)}
        onOpenAnalysis={() => setShowAnalysis(true)}
        highlights={highlights}
        onOpenHighlight={setBubble}
        audioRef={audio}
        autoplayDelay={q.audio ? 0.5 : null}
        readOnly={answered}
        onChoose={choose}
        onChooseAndNext={choose}
      />
      <RatingBar
        card={card}
        state={!answered ? "front" : correct ? "rate" : "forced"}
        forced={forced}
        hint="选一个答案后判对错 · 1–4 / A–D 选择 · 空格播放"
        onRate={rate}
        onPostpone={postpone}
        extra={
          answered && (
            <Button
              variant="outline"
              size="lg"
              className={cn(showAnalysis && "border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
              onClick={() => setShowAnalysis((v) => !v)}
            >
              <Lightbulb /> 答案解析（R）
            </Button>
          )
        }
      />
      {bubble && <HighlightBubble id={bubble} onClose={() => setBubble(null)} />}
    </div>
  );
}
