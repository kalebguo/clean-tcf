import { Eye, Highlighter, NotebookPen, Play, Star, Volume2 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToolButton } from "../components/AppShell";
import { DisputedBadge, LevelTag } from "../components/controls";
import { PARTS } from "../components/parts";
import { alignWords, lineOk, useAlign } from "../data/align";
import { formatAppearances, isPictureItem } from "../data/bank";
import { evidenceRanges, sentenceRanges, translatedBlocks, type P2Field, type P2Question } from "../data/p2";
import { ttsAudio, ttsWords, useTts } from "../data/tts";
import { SECTION_FR, type Letter, type Question } from "../data/types";
import type { Settings } from "../db/settings";
import type { DraftEntry, Highlight } from "../db/schema";
import { AudioBar, type AudioHandle } from "./AudioBar";
import { HighlightableText } from "./HighlightableText";
import { NotePanel } from "./NotePanel";
import { Options } from "./Options";
import { AnalysisPanel } from "./P2Analysis";
import { SentenceHover } from "./SentenceHover";
import { displayLetter } from "./shuffle";
import { useTimeline } from "./useTimeline";

export interface QuestionViewProps {
  q: Question;
  p2: P2Question | null;
  no: number;
  done: boolean;
  entry?: DraftEntry;
  order: number[];
  settings: Settings;
  setSettings(p: Partial<Settings>): void;
  revealAnswer: boolean;
  judgeChoice: boolean;
  showAnalysis: boolean;
  transcriptShown: boolean;
  onShowTranscript(): void;
  favorite: boolean;
  onToggleFavorite(): void;
  noteOpen: boolean;
  onToggleNote(): void;
  onOpenAnalysis(): void;
  highlights: Highlight[];
  onOpenHighlight(id: string): void;
  audioRef: RefObject<AudioHandle | null>;
  autoplayDelay: number | null;
  readOnly: boolean;
  onChoose(l: Letter): void;
  onChooseAndNext(l: Letter): void;
}

const LANG_LABEL = { fr: "原文", zh: "中文", en: "英文" } as const;
const TL_PLAY = "w-3.5 flex-none p-0 text-[10px] leading-none text-muted-foreground opacity-50 md:w-4";

/** Language of the text panels: the remembered choice, or the original when this question has no translations. */
export function panelLang(p2: P2Question | null, s: Settings): Settings["p2Lang"] {
  return p2?.segments?.length ? s.p2Lang : "fr";
}

export function PanelTab({ active, onClick, title, children }: { active: boolean; onClick?(): void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
        active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

function PanelToggle({ on, onClick, title, children }: { on: boolean; onClick(): void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn("flex items-center gap-1.5 self-stretch border-l px-3 text-[13px] transition-colors", on ? "text-primary" : "text-muted-foreground hover:text-foreground")}
      onClick={onClick}
      title={title}
      aria-pressed={on}
    >
      {children}
    </button>
  );
}

export const PANEL = "mb-3.5 overflow-hidden rounded-xl border bg-card";
export const PANEL_HEAD = "flex items-center border-b bg-muted/40";
export const PANEL_BODY = "relative px-3.5 py-3 font-serif text-[17px] leading-[1.75] md:px-5.5 md:py-3.5 md:text-lg";

export function QuestionView(p: QuestionViewProps) {
  const { q, p2, settings } = p;
  const root = useRef<HTMLElement>(null);
  const hl = { highlights: p.highlights, hidden: settings.hideHighlights, onOpen: p.onOpenHighlight };
  const picture = isPictureItem(q);
  const status = p.entry?.choice ? "本轮已答" : p.done ? "已做" : "未做";
  const lang = panelLang(p2, settings);
  const translated = lang !== "fr" && p2 ? lang : null;
  const doubt = Boolean(p2?.check && !p2.check.agree);

  const sentences = useMemo(() => sentenceRanges(p2), [p2]);
  const showEvidence = settings.showEvidence && p.revealAnswer && !p2?.stale;
  const evidence = useMemo(
    () => (showEvidence ? evidenceRanges(p2, q.answer, (l) => displayLetter(p.order, l)) : new Map()),
    [showEvidence, p2, q.answer, p.order],
  );
  const marks = (field: P2Field, index: number) => ({
    sentences: sentences.get(`${field}:${index}`),
    evidence: evidence.get(`${field}:${index}`),
  });
  const hoverLang = settings.hoverTranslate !== "off" && !translated && !p2?.stale ? settings.hoverTranslate : null;

  // listening timeline: play one line, follow the words, click a word to play from it
  const align = useAlign(q);
  const timed = align && !translated ? align : null;
  // reading aloud (SPEC §5.A): the same, on the passage and the question; opening the bar plays it
  const tts = useTts(q);
  const ttsOpen = Boolean(tts) && settings.ttsBar;
  const [ttsPlay, setTtsPlay] = useState<string | null>(null);
  const textShown = settings.readingView === "text" || !q.image;
  const words = useMemo(() => (q.section === "CO" ? timed && alignWords(timed) : tts && ttsWords(tts)), [q.section, timed, tts]);
  const follow = q.section === "CO" ? p.transcriptShown : ttsOpen && !translated && textShown;
  useTimeline(root, words, p.audioRef, settings.followAudio && follow, settings.shortcuts && (q.section === "CO" || ttsOpen));
  const transcriptLines = (lines: string[]) =>
    !timed
      ? blocks("transcript", lines)
      : lines.map((t, i) => {
          const l = timed.lines[i];
          return (
            <div key={i} className="-ml-3.5 flex items-baseline gap-1 md:-ml-5">
              {!l ? (
                <span className={cn(TL_PLAY, "cursor-default text-center opacity-40")} title="录音里没找到这一句：可能是机器转写多出来的">–</span>
              ) : lineOk(timed, i) && p.transcriptShown ? (
                <button type="button" className={cn(TL_PLAY, "hover:text-primary hover:opacity-100")} title="只播这一句" onClick={() => p.audioRef.current?.playRange(l[0], l[1])}>
                  <Play className="size-2.5 fill-current" />
                </button>
              ) : (
                <span className={TL_PLAY} />
              )}
              <HighlightableText as="p" className="min-w-0 flex-1" text={t} field="transcript" index={i} {...hl} {...marks("transcript", i)} />
            </div>
          );
        });

  /** Original-text blocks, or their translations in the chosen language. */
  const blocks = (field: P2Field, texts: string[], className?: string) =>
    translated
      ? translatedBlocks(p2!, field, translated, texts.length).map((t, i) => (
          <p key={i} className={cn("font-sans text-[16.5px] leading-[1.8]", className)}>{t}</p>
        ))
      : texts.map((t, i) => <HighlightableText key={i} as="p" className={className} text={t} field={field} index={i} {...hl} {...marks(field, i)} />);

  const chooseLang = (l: Settings["p2Lang"]) => p.setSettings(q.section === "CE" ? { p2Lang: l, readingView: "text" } : { p2Lang: l });
  const langTabs = (active: boolean) =>
    p2?.segments?.length
      ? (["fr", "zh", "en"] as const).map((l) => (
          <PanelTab key={l} active={active && lang === l} onClick={() => chooseLang(l)} title={`快捷键 ${{ fr: "Q", zh: "W", en: "E" }[l]}`}>
            {LANG_LABEL[l]}
          </PanelTab>
        ))
      : null;

  const optionLang = lang === "en" ? "en" : "zh";
  const showOptionTranslation = settings.optionTranslation === "always" || (settings.optionTranslation === "after" && p.revealAnswer);

  return (
    <article className="mx-auto max-w-[900px]" ref={root}>
      <header className="mb-4 flex items-start gap-3 border-b pb-3 md:gap-3.5">
        <div className="min-w-9 font-serif text-[30px] leading-none text-muted-foreground md:text-[40px]">{p.no}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold">
            <span className={cn("tracking-wide", PARTS[q.section].text)}>{SECTION_FR[q.section]}</span>
            <LevelTag level={q.level} />
            <span className="font-normal text-muted-foreground">{status}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>出现在: {formatAppearances(q)}</span>
            {(q.disputed || doubt) && <DisputedBadge onClick={p.onOpenAnalysis} />}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <ToolButton label="快速高亮模式：选中文字直接高亮" active={settings.quickHighlight} onClick={() => p.setSettings({ quickHighlight: !settings.quickHighlight })}>
            <Highlighter />
          </ToolButton>
          <ToolButton label="题目笔记（N）" active={p.noteOpen} onClick={p.onToggleNote}>
            <NotebookPen />
          </ToolButton>
          <ToolButton label="收藏（F）" onClick={p.onToggleFavorite} className={cn(p.favorite && "text-amber-500 hover:text-amber-500")}>
            <Star className={cn(p.favorite && "fill-current")} />
          </ToolButton>
        </div>
      </header>

      {q.section === "CO" ? (
        <>
          <p className="mb-3 text-[17px]">
            {picture
              ? "Écoutez l’extrait sonore et les 4 propositions. Choisissez la bonne réponse."
              : "Écoutez l’extrait sonore et la question. Choisissez la bonne réponse."}
          </p>
          <div className={PANEL}>
            <div className={PANEL_HEAD}>
              {langTabs(true) ?? <PanelTab active>原文</PanelTab>}
              <span className="flex-1" />
              <PanelToggle on={settings.alwaysShowTranscript} onClick={() => p.setSettings({ alwaysShowTranscript: !settings.alwaysShowTranscript })}>
                常显原文{settings.alwaysShowTranscript ? "：已开启" : ""}
              </PanelToggle>
            </div>
            {/* "blurred" and "reveal" are also read by SentenceHover */}
            <div
              className={cn(
                PANEL_BODY,
                "[&_p]:mb-2",
                !p.transcriptShown && "blurred min-h-[90px] [&>:not(.reveal)]:pointer-events-none [&>:not(.reveal)]:blur-[6px] [&>:not(.reveal)]:select-none",
              )}
            >
              {transcriptLines(q.transcript ?? [])}
              {!p.transcriptShown && (
                <Button className="reveal absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-sans" onClick={p.onShowTranscript}>
                  <Eye /> 点击显示文本
                </Button>
              )}
            </div>
          </div>
          {q.image && <img className="mx-auto mb-3.5 block max-h-[360px] max-w-[min(100%,560px)] rounded-xl border bg-white" src={`/media/${q.image}`} alt="" />}
          {q.audio && (
            <AudioBar
              ref={p.audioRef}
              src={`/media/${q.audio}`}
              rate={settings.rate}
              volume={settings.volume}
              autoplayDelay={p.autoplayDelay}
              onRate={(rate) => p.setSettings({ rate })}
              onVolume={(volume) => p.setSettings({ volume })}
            />
          )}
        </>
      ) : (
        <>
          {q.question &&
            (translated ? <div className="mb-3.5">{blocks("question", [q.question], "text-lg")}</div> : blocks("question", [q.question], "mb-3.5 text-[19px] font-medium"))}
          {ttsOpen && (
            // reading aloud: stays under the top bar while the passage scrolls
            <div className="sticky top-16 z-[5]">
              <AudioBar
                ref={p.audioRef}
                className="shadow-md"
                src={ttsAudio(q.id)}
                rate={settings.ttsRate}
                volume={settings.volume}
                autoplayDelay={ttsPlay === q.id ? 0 : null}
                onRate={(ttsRate) => p.setSettings({ ttsRate })}
                onVolume={(volume) => p.setSettings({ volume })}
              />
            </div>
          )}
          <div className={PANEL}>
            <div className={PANEL_HEAD}>
              {langTabs(settings.readingView === "text" || !q.image) ?? (
                <PanelTab active={settings.readingView === "text"} onClick={() => p.setSettings({ readingView: "text" })}>
                  原文
                </PanelTab>
              )}
              {q.image && (
                <PanelTab active={settings.readingView === "image"} onClick={() => p.setSettings({ readingView: "image" })}>
                  原图
                </PanelTab>
              )}
              <span className="flex-1" />
              {tts && (
                <PanelToggle
                  on={settings.ttsBar}
                  title="机器朗读原文和题目（macOS 语音），朗读时高亮当前的词，单击词从那里开始播放"
                  onClick={() => {
                    if (!settings.ttsBar) setTtsPlay(q.id);
                    p.setSettings({ ttsBar: !settings.ttsBar });
                  }}
                >
                  <Volume2 className="size-3.5" /> 听原文
                </PanelToggle>
              )}
            </div>
            <div className={cn(PANEL_BODY, "[&_p]:mb-3")}>
              {settings.readingView === "image" && q.image ? (
                <img className="mx-auto block max-w-full rounded-lg bg-white" src={`/media/${q.image}`} alt="题目原图" />
              ) : (
                blocks("passage", q.passage ?? [])
              )}
            </div>
          </div>
        </>
      )}

      <Options
        q={q}
        order={p.order}
        choice={p.entry?.choice}
        revealAnswer={p.revealAnswer}
        judgeChoice={p.judgeChoice}
        highlights={p.highlights}
        hideHighlights={settings.hideHighlights}
        translations={showOptionTranslation ? p2?.options?.map((o) => o?.[optionLang] ?? null) : undefined}
        disabled={p.readOnly}
        onChoose={p.onChoose}
        onChooseAndNext={p.onChooseAndNext}
        onOpenHighlight={p.onOpenHighlight}
      />

      {p.showAnalysis && <AnalysisPanel key={q.id} q={q} p2={p2} order={p.order} />}

      {p.noteOpen && <NotePanel key={q.id} q={q} />}
      <SentenceHover root={root} p2={p2} lang={hoverLang} />
    </article>
  );
}
