import { Pause, Play, RotateCcw, RotateCw, Volume2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NATIVE_SELECT } from "../components/controls";
import { RATES } from "../db/settings";

export interface AudioHandle {
  toggle(): void;
  replay(): void;
  seek(delta: number): void;
  /** play from `start` (seconds); with `end`, pause there (one line of the timeline) */
  playRange(start: number, end?: number): void;
  element(): HTMLAudioElement | null;
}

interface Props {
  src: string;
  rate: number;
  volume: number;
  /** seconds before auto-play after the source changes; null = no auto-play */
  autoplayDelay: number | null;
  onRate(rate: number): void;
  onVolume(v: number): void;
  className?: string;
}

const fmt = (t: number) => {
  if (!isFinite(t)) return "0:00";
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const AudioBar = forwardRef<AudioHandle, Props>(function AudioBar(
  { src, rate, volume, autoplayDelay, onRate, onVolume, className },
  ref,
) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // playing one line: where to stop, checked every frame (timeupdate comes only every ~250 ms)
  const stopAt = useRef<number | null>(null);
  const frame = useRef(0);
  const stopRange = () => {
    stopAt.current = null;
    cancelAnimationFrame(frame.current);
  };

  useImperativeHandle(ref, () => ({
    toggle() {
      const a = audio.current;
      if (!a) return;
      if (a.paused) void a.play();
      else a.pause();
    },
    replay() {
      const a = audio.current;
      if (!a) return;
      a.currentTime = 0;
      void a.play();
    },
    seek(delta) {
      const a = audio.current;
      if (!a) return;
      a.currentTime = Math.max(0, Math.min((a.duration || 0) - 0.05, a.currentTime + delta));
    },
    playRange(start, end) {
      const a = audio.current;
      if (!a) return;
      stopRange();
      a.currentTime = Math.max(0, start - 0.05);
      void a.play();
      if (end === undefined) return;
      stopAt.current = end + 0.15;
      const check = () => {
        if (stopAt.current === null) return;
        if (a.currentTime >= stopAt.current) {
          a.pause();
          stopAt.current = null;
          return;
        }
        frame.current = requestAnimationFrame(check);
      };
      frame.current = requestAnimationFrame(check);
    },
    element: () => audio.current,
  }));

  useEffect(() => stopRange, [src]);

  useEffect(() => {
    setTime(0);
    setDuration(0);
    setPlaying(false);
    if (autoplayDelay === null) return;
    const t = setTimeout(() => void audio.current?.play().catch(() => {}), autoplayDelay * 1000);
    return () => clearTimeout(t);
  }, [src, autoplayDelay]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;
  }, [rate, src]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  return (
    <div className={cn("mb-3.5 rounded-xl border bg-card px-3 py-2 md:px-3.5", className)}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          stopRange();
        }}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          e.currentTarget.playbackRate = rate;
        }}
      />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" title="后退 3 秒（-）" onClick={() => (audio.current!.currentTime -= 3)}>
          <RotateCcw /> 3
        </Button>
        <Button
          size="icon-lg"
          className="size-10 rounded-full"
          title="播放 / 暂停（Space）"
          aria-label={playing ? "暂停" : "播放"}
          onClick={() => (audio.current!.paused ? void audio.current!.play() : audio.current!.pause())}
        >
          {playing ? <Pause className="size-4.5 fill-current" /> : <Play className="size-4.5 translate-x-px fill-current" />}
        </Button>
        <Button variant="outline" size="sm" title="前进 3 秒（+）" onClick={() => (audio.current!.currentTime += 3)}>
          3 <RotateCw />
        </Button>
        <span className="flex-1" />
        <select className={cn(NATIVE_SELECT, "h-7 px-1.5 text-[13px]")} value={rate} title="倍速" onChange={(e) => onRate(Number(e.target.value))}>
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <Volume2 className="size-4 text-muted-foreground max-md:hidden" />
        <input
          className="w-[84px] accent-primary max-md:hidden"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          title="音量"
          onChange={(e) => onVolume(Number(e.target.value))}
        />
      </div>
      <div className="mt-1 flex items-center gap-2.5">
        <input
          className="min-w-0 flex-1 accent-primary"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          aria-label="播放进度"
          onChange={(e) => {
            if (audio.current) audio.current.currentTime = Number(e.target.value);
          }}
        />
        <span className="min-w-[84px] text-right text-[12.5px] text-muted-foreground tabular-nums">
          {fmt(time)} / {fmt(duration)}
        </span>
      </div>
    </div>
  );
});
