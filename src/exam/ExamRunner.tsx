import { ChevronLeft, ChevronRight, Play, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bar } from "../components/AppShell";
import { Modal, ModalActions } from "../components/Modal";
import { PARTS } from "../components/parts";
import { isPictureItem, type Banks } from "../data/bank";
import { SECTION_FR, type Letter, type Section } from "../data/types";
import { onBeforeDbUpgrade, type DraftEntry, type Session } from "../db/schema";
import { saveDraft, submitSession, type SubmitResult } from "../db/sessions";
import { useSettings } from "../db/settings";
import { Options } from "../practice/Options";
import { optionOrder, originalLetter } from "../practice/shuffle";
import { PANEL, PANEL_BODY, PANEL_HEAD, PanelTab } from "../practice/QuestionView";
import { cellClass, fmtElapsed } from "../practice/Sidebar";
import { useShortcuts } from "../practice/useShortcuts";
import { READING_LIMIT_MS } from "./score";

const EMPTY: DraftEntry = { peeked: false, revealed: false };
const noop = () => {};

interface Props {
  banks: Banks;
  session: Session;
  /** leave without submitting; the paper stays open and can be resumed */
  onQuit(): void;
  onSubmitted(id: string, r: SubmitResult): void;
}

/**
 * The exam itself, in French, without translations, dictionary or answers (SPEC §5.H).
 * Listening: each recording plays once, then a short answering time, then the next question;
 * no going back. Reading: 60 minutes, free navigation, submitted when the time is up.
 */
export function ExamRunner({ banks, session, onQuit, onSubmitted }: Props) {
  const section = session.section as Section;
  const listening = section === "CO";
  const qids = session.qids;
  const shuffle = session.scope.shuffle !== "0";
  const answerMs = Number(session.scope.answerSeconds ?? 10) * 1000;
  const [settings, setSettings] = useSettings();

  const [draft, setDraft] = useState(session.draft);
  const [index, setIndex] = useState(Math.max(0, Math.min(session.currentIndex, qids.length - 1)));
  const [confirm, setConfirm] = useState(false);
  // listening waits for a click, so the browser lets the recording play; the clock starts then
  const [started, setStarted] = useState(!listening);
  const clock = useRef({ base: session.elapsedMs, since: Date.now() });
  const [now, setNow] = useState(Date.now());
  const elapsed = started ? clock.current.base + now - clock.current.since : clock.current.base;

  const latest = useRef({ draft, index, started });
  latest.current = { draft, index, started };
  const elapsedNow = useCallback(
    () => (latest.current.started ? clock.current.base + Date.now() - clock.current.since : clock.current.base),
    [],
  );

  const start = () => {
    clock.current.since = Date.now();
    setNow(Date.now());
    setStarted(true);
  };

  useEffect(() => {
    if (!started) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [started]);

  // ------------------------------------------------------------ saving & submitting

  const save = useCallback(
    () => saveDraft(session.id, { entries: latest.current.draft, currentIndex: latest.current.index, elapsedMs: elapsedNow() }),
    [session.id, elapsedNow],
  );

  useEffect(() => {
    if (started) void save();
  }, [draft, index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onBeforeDbUpgrade(async () => void (await save())), [save]);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void save();
    const onPageHide = () => void save();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    const t = setInterval(() => void save(), 10000);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(t);
      void save();
    };
  }, [save]);

  const submitting = useRef(false);
  const submit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    const r = await submitSession(session.id, banks.get, { entries: latest.current.draft, elapsedMs: elapsedNow() });
    onSubmitted(session.id, r);
  }, [session.id, banks, elapsedNow, onSubmitted]);

  const remaining = READING_LIMIT_MS - elapsed;
  useEffect(() => {
    if (!listening && started && remaining <= 0) void submit();
  }, [listening, started, remaining <= 0, submit]); // eslint-disable-line react-hooks/exhaustive-deps

  // the search box and the dictionary are not available during the exam
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !(e.target as HTMLElement).closest?.("input, textarea"))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, []);

  // ------------------------------------------------------------ current question

  const q = banks.get(qids[index])!;
  const picture = isPictureItem(q);
  const order = optionOrder(session.id, q.id, shuffle && !picture);
  const entry = draft[q.id];
  const answered = qids.filter((id) => draft[id]?.choice).length;
  const last = index === qids.length - 1;

  const choose = (orig: Letter) => {
    if (!started) return;
    setDraft((d) => ({ ...d, [q.id]: { ...EMPTY, ...d[q.id], choice: orig } }));
  };

  // ------------------------------------------------------------ listening: play once, answer, move on

  const [phase, setPhase] = useState<"playing" | "answering">("playing");
  const [deadline, setDeadline] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [audioTime, setAudioTime] = useState({ t: 0, d: 0 });
  const audio = useRef<HTMLAudioElement>(null);

  const toAnswering = useCallback(() => {
    setPhase("answering");
    setDeadline(Date.now() + answerMs);
  }, [answerMs]);

  const play = useCallback(() => {
    const a = audio.current;
    if (!a) return toAnswering();
    a.play().then(
      () => setBlocked(false),
      () => (a.error ? toAnswering() : setBlocked(true)),
    );
  }, [toAnswering]);

  useEffect(() => {
    if (!listening || !started) return;
    setBlocked(false);
    setAudioTime({ t: 0, d: 0 });
    if (!q.audio) return toAnswering();
    setPhase("playing");
    const t = setTimeout(play, 800);
    return () => clearTimeout(t);
  }, [index, started]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audio.current) audio.current.volume = settings.volume;
  }, [settings.volume, q.id]);

  const next = () => {
    if (!listening) return setIndex((i) => Math.min(qids.length - 1, i + 1));
    if (last) return void submit();
    setPhase("playing");
    setIndex(index + 1);
  };

  useEffect(() => {
    if (listening && started && phase === "answering" && now >= deadline) next();
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ keys

  const pick = (pos: number) => choose(originalLetter(order, pos));
  useShortcuts(
    {
      a: () => pick(0), b: () => pick(1), c: () => pick(2), d: () => pick(3),
      "1": () => pick(0), "2": () => pick(1), "3": () => pick(2), "4": () => pick(3),
      enter: () => (!listening || phase === "answering") && next(),
      arrowright: () => !listening && next(),
      arrowleft: () => !listening && setIndex((i) => Math.max(0, i - 1)),
    },
    started && !confirm,
  );

  useEffect(() => {
    document.title = `Question ${index + 1} / ${qids.length} · ${SECTION_FR[section]}`;
  }, [index, qids.length, section]);

  // ------------------------------------------------------------ render

  const volume = (className?: string) => (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Volume2 className="size-4 text-muted-foreground" />
      <input
        className="w-[84px] accent-primary"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={settings.volume}
        title="Volume"
        onChange={(e) => setSettings({ volume: Number(e.target.value) })}
      />
    </span>
  );

  const options = (
    <Options
      q={q}
      order={order}
      choice={entry?.choice}
      revealAnswer={false}
      judgeChoice={false}
      highlights={[]}
      hideHighlights
      disabled={!started}
      onChoose={choose}
      onChooseAndNext={choose}
      onOpenHighlight={noop}
    />
  );
  const low = !listening && remaining < 5 * 60 * 1000;

  return (
    <div className="flex min-h-screen flex-col bg-background" data-exam="">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
        <span className={cn("text-[13px] font-bold tracking-[0.06em] uppercase max-sm:hidden", PARTS[section].text)}>{SECTION_FR[section]}</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          Question {index + 1} / {qids.length}
        </span>
        <span className="flex-1" />
        <span
          className={cn("rounded-md bg-muted px-2 py-0.5 font-mono text-base font-semibold tabular-nums", low && "bg-wrong/10 text-wrong")}
          title={listening ? "Temps écoulé" : "Temps restant"}
        >
          {fmtElapsed(listening ? elapsed : Math.max(0, remaining))}
        </span>
        <Button size="sm" onClick={() => setConfirm(true)} disabled={!started}>
          Terminer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          title="Quitter sans terminer : vous pourrez reprendre plus tard"
          onClick={() => {
            audio.current?.pause();
            void save().then(onQuit);
          }}
        >
          Quitter
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-6 px-3 pt-3 pb-8 max-md:flex-col sm:px-5 sm:pt-5">
        {!listening && (
          <nav className="flex shrink-0 flex-col gap-2 self-start md:sticky md:top-[76px] md:w-[230px] max-md:w-full">
            <div className="text-xs text-muted-foreground">
              {answered} / {qids.length} réponses
            </div>
            <div className="grid grid-cols-6 gap-1.5 max-md:grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))]">
              {qids.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  className={cn(cellClass(draft[id]?.choice ? "selected" : "todo", i === index), "max-md:aspect-auto max-md:h-8")}
                  onClick={() => setIndex(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </nav>
        )}

        <main className="mx-auto w-full max-w-[900px] min-w-0 flex-1">
          {listening && !started ? (
            <div className="mx-auto my-10 flex max-w-[560px] flex-col items-start gap-3 rounded-2xl border bg-card p-6">
              <h2 className="text-xl font-bold">Compréhension orale</h2>
              <p className="leading-relaxed">
                {index > 0 ? `Reprise à la question ${index + 1} sur ${qids.length}.` : `${qids.length} questions.`} Chaque
                enregistrement est diffusé une seule fois. Après l’enregistrement, vous avez {answerMs / 1000} secondes pour
                répondre, puis la question suivante commence.
              </p>
              {volume()}
              <Button size="lg" onClick={start}>
                <Play className="fill-current" /> {index > 0 ? "Reprendre" : "Commencer"}
              </Button>
            </div>
          ) : listening ? (
            <>
              <p className="mb-3 text-[17px]">
                {picture
                  ? "Écoutez l’extrait sonore et les 4 propositions. Choisissez la bonne réponse."
                  : "Écoutez l’extrait sonore et la question. Choisissez la bonne réponse."}
              </p>
              {q.image && <img className="mx-auto mb-3.5 block max-h-[360px] max-w-[min(100%,560px)] rounded-xl border bg-white" src={`/media/${q.image}`} alt="" />}
              {q.audio && (
                <audio
                  key={q.id}
                  ref={audio}
                  src={`/media/${q.audio}`}
                  preload="auto"
                  onEnded={toAnswering}
                  onError={() => phase === "playing" && toAnswering()}
                  // paused from outside the page (headset button, system): offer to go on, not to restart
                  onPause={(e) => !e.currentTarget.ended && phase === "playing" && setBlocked(true)}
                  onTimeUpdate={(e) => setAudioTime({ t: e.currentTarget.currentTime, d: e.currentTarget.duration || 0 })}
                />
              )}
              <div className="mb-3.5 flex min-h-14 items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5">
                {phase === "playing" ? (
                  blocked ? (
                    <Button onClick={play}>
                      <Play className="fill-current" /> {audioTime.t > 0 ? "Reprendre l’enregistrement" : "Écouter l’enregistrement"}
                    </Button>
                  ) : (
                    <>
                      <span className="text-[13.5px] font-semibold whitespace-nowrap">Écoute en cours</span>
                      <Bar className="h-2 flex-1" value={audioTime.d ? audioTime.t / audioTime.d : 0} />
                      <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                        {fmtElapsed(audioTime.t * 1000)} / {fmtElapsed(audioTime.d * 1000)}
                      </span>
                    </>
                  )
                ) : (
                  <>
                    <span className="text-[13.5px] font-semibold whitespace-nowrap">Temps de réponse</span>
                    <Bar className="h-2 flex-1" fill="bg-wrong duration-250 ease-linear" value={Math.max(0, (deadline - now) / answerMs)} />
                    <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">{Math.max(0, Math.ceil((deadline - now) / 1000))} s</span>
                  </>
                )}
                {volume("max-md:hidden")}
              </div>
              {options}
              <footer className="flex items-center gap-2.5 py-3.5">
                <span className="flex-1" />
                {phase === "answering" && (
                  <Button size="lg" onClick={next}>
                    {last ? "Terminer l’épreuve" : "Question suivante"} {!last && <ChevronRight />}
                  </Button>
                )}
              </footer>
            </>
          ) : (
            <>
              {q.question && <p className="mb-3.5 text-[19px] font-medium">{q.question}</p>}
              <div className={PANEL}>
                <div className={PANEL_HEAD}>
                  <PanelTab active={settings.readingView === "text" || !q.image} onClick={() => setSettings({ readingView: "text" })}>
                    Texte
                  </PanelTab>
                  {q.image && (
                    <PanelTab active={settings.readingView === "image"} onClick={() => setSettings({ readingView: "image" })}>
                      Document
                    </PanelTab>
                  )}
                </div>
                <div className={cn(PANEL_BODY, "[&_p]:mb-3")}>
                  {settings.readingView === "image" && q.image ? (
                    <img className="mx-auto block max-w-full rounded-lg bg-white" src={`/media/${q.image}`} alt="Document" />
                  ) : (
                    (q.passage ?? []).map((t, i) => <p key={i}>{t}</p>)
                  )}
                </div>
              </div>
              {options}
              <footer className="flex items-center gap-2.5 py-3.5">
                <Button variant="outline" size="lg" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                  <ChevronLeft /> Précédente
                </Button>
                <span className="flex-1" />
                {last ? (
                  <Button size="lg" onClick={() => setConfirm(true)}>
                    Terminer l’épreuve
                  </Button>
                ) : (
                  <Button size="lg" onClick={next}>
                    Suivante <ChevronRight />
                  </Button>
                )}
              </footer>
            </>
          )}
        </main>
      </div>

      {confirm && (
        <Modal
          title="Terminer l’épreuve ?"
          onClose={() => setConfirm(false)}
          description={
            <>
              Vous avez répondu à {answered} question{answered > 1 ? "s" : ""} sur {qids.length}.
              {answered < qids.length && " Les questions sans réponse ne rapportent aucun point."}
            </>
          }
        >
          <ModalActions>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Continuer
            </Button>
            <Button onClick={() => void submit()}>Terminer</Button>
          </ModalActions>
        </Modal>
      )}
    </div>
  );
}
