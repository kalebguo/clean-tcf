import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { db } from "./schema";

export interface Settings {
  shortcuts: boolean;
  autoplay: boolean;
  autoplayDelay: number; // seconds
  instantJudge: boolean;
  autoNext: boolean;
  shuffle: boolean;
  alwaysShowTranscript: boolean;
  hideHighlights: boolean;
  quickHighlight: boolean;
  rate: number;
  volume: number;
  theme: "system" | "light" | "dark";
  readingView: "text" | "image";
  /** P2: language of the transcript / passage panel, remembered across questions */
  p2Lang: "fr" | "zh" | "en";
  hoverTranslate: "off" | "zh" | "en";
  optionTranslation: "after" | "always" | "hidden";
  showEvidence: boolean;
  /** listening timeline: mark the word being spoken, click a word to play from it */
  followAudio: boolean;
  /** reading: the read-aloud bar is open (SPEC §5.A), and its speed */
  ttsBar: boolean;
  ttsRate: number;
}

export const DEFAULT_SETTINGS: Settings = {
  shortcuts: true,
  autoplay: false,
  autoplayDelay: 2,
  instantJudge: false,
  autoNext: false,
  shuffle: false,
  alwaysShowTranscript: false,
  hideHighlights: false,
  quickHighlight: false,
  rate: 1,
  volume: 1,
  theme: "system",
  readingView: "text",
  p2Lang: "fr",
  hoverTranslate: "off",
  optionTranslation: "after",
  showEvidence: true,
  followAudio: true,
  ttsBar: false,
  ttsRate: 1,
};

export const RATES = [0.5, 0.75, 0.9, 1, 1.25];

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get("settings");
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.transaction("rw", db.kv, async () => {
    const cur = await getSettings();
    await db.kv.put({ key: "settings", value: { ...cur, ...patch }, updatedAt: Date.now() });
  });
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const value = useLiveQuery(() => getSettings(), []) ?? DEFAULT_SETTINGS;
  const set = useCallback((patch: Partial<Settings>) => void updateSettings(patch), []);
  return [value, set];
}

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value, updatedAt: Date.now() });
}

/** Exam day for the countdown, "2026-11-20"; "" = not set. Kept under its own key (older backups have it there). */
export function useExamDate(): [string, (date: string) => void] {
  const value = useLiveQuery(() => getKV("examDate", ""), []) ?? "";
  const set = useCallback((date: string) => void setKV("examDate", date), []);
  return [value, set];
}
