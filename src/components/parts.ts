import { BookOpen, Headphones, Library, Mic, PenLine, type LucideIcon } from "lucide-react";
import type { Level, Section } from "../data/types";

/** The four parts of the exam plus the vocabulary book; each has its own colour (globals.css). */
export type Part = Section | "EE" | "EO";

export interface PartInfo {
  key: Part | "V";
  path: string;
  name: string;
  fr: string;
  icon: LucideIcon;
  /** Tailwind classes, written out in full so the class scanner finds them */
  text: string;
  bg: string;
  soft: string;
  border: string;
}

export const PARTS: Record<Part | "V", PartInfo> = {
  CO: { key: "CO", path: "/listening", name: "听力", fr: "Compréhension orale", icon: Headphones, text: "text-co", bg: "bg-co", soft: "bg-co/10", border: "border-co/25" },
  CE: { key: "CE", path: "/reading", name: "阅读", fr: "Compréhension écrite", icon: BookOpen, text: "text-ce", bg: "bg-ce", soft: "bg-ce/10", border: "border-ce/25" },
  EE: { key: "EE", path: "/writing", name: "写作", fr: "Expression écrite", icon: PenLine, text: "text-ee", bg: "bg-ee", soft: "bg-ee/10", border: "border-ee/25" },
  EO: { key: "EO", path: "/speaking", name: "口语", fr: "Expression orale", icon: Mic, text: "text-eo", bg: "bg-eo", soft: "bg-eo/10", border: "border-eo/25" },
  V: { key: "V", path: "/vocab", name: "单词本", fr: "Vocabulaire", icon: Library, text: "text-vocab", bg: "bg-vocab", soft: "bg-vocab/10", border: "border-vocab/25" },
};

export const NAV_ORDER: (Part | "V")[] = ["CO", "CE", "EE", "EO", "V"];

export const LEVEL_TEXT: Record<Level, string> = {
  A1: "text-lv-a1", A2: "text-lv-a2", B1: "text-lv-b1", B2: "text-lv-b2", C1: "text-lv-c1", C2: "text-lv-c2",
};
export const LEVEL_BG: Record<Level, string> = {
  A1: "bg-lv-a1", A2: "bg-lv-a2", B1: "bg-lv-b1", B2: "bg-lv-b2", C1: "bg-lv-c1", C2: "bg-lv-c2",
};

/** Which nav item a path belongs to. */
export function partOfPath(path: string): Part | "V" | null {
  for (const k of NAV_ORDER) if (path === PARTS[k].path || path.startsWith(PARTS[k].path + "/")) return k;
  return null;
}
