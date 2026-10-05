export type Section = "CO" | "CE";
export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type Letter = "A" | "B" | "C" | "D";

export const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const LETTERS: Letter[] = ["A", "B", "C", "D"];
export const SECTIONS: Section[] = ["CO", "CE"];

export const SECTION_SLUG: Record<Section, "listening" | "reading"> = { CO: "listening", CE: "reading" };
export const SECTION_NAME: Record<Section, string> = { CO: "听力", CE: "阅读" };
export const SECTION_FR: Record<Section, string> = { CO: "COMPRÉHENSION ORALE", CE: "COMPRÉHENSION ÉCRITE" };

export function slugToSection(slug: string | undefined): Section | null {
  if (slug === "listening") return "CO";
  if (slug === "reading") return "CE";
  return null;
}

export interface Appearance {
  set: string;
  num: number;
  series?: string;
}

export interface Question {
  id: string;
  section: Section;
  level: Level;
  points: number;
  source: "main" | "extra";
  bankNo: number;
  appearances: Appearance[];
  options: [string, string, string, string];
  answer: Letter;
  analysis?: string;
  disputed?: boolean;
  audio?: string;
  image?: string;
  transcript?: string[];
  question?: string;
  passage?: string[];
}

export interface SetInfo {
  section: Section;
  id: string;
  label: string;
  series: string[];
  complete: boolean;
  questionIds: string[];
}

export interface Bank {
  section: Section;
  questions: Question[];
  sets: SetInfo[];
  byId: Map<string, Question>;
}

/**
 * "review" browses the bank with answers shown and never records attempts or sessions;
 * "exam" is a mock exam or a set test (SPEC §5.H)
 */
export type Mode = "dedupe" | "set" | "wrong" | "favorites" | "search" | "review" | "exam";
