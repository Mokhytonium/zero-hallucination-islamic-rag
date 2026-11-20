import type { Label } from "./types";

export interface LabelStyle {
  name: string;
  section: "main" | "supporting" | "opposing" | "unverified";
  accent: string;
  bg: string;
  spine: string;
  chip: string;
}

export const LABELS: Record<Label, LabelStyle> = {
  Direct_Match: {
    name: "تأیید مستقیم",
    section: "main",
    accent: "text-green",
    bg: "bg-green-bg",
    spine: "bg-green",
    chip: "bg-green-bg text-green",
  },
  Conditional_Match: {
    name: "تأیید مشروط",
    section: "supporting",
    accent: "text-amber",
    bg: "bg-amber-bg",
    spine: "bg-amber",
    chip: "bg-amber-bg text-amber",
  },
  Contradiction: {
    name: "شاهد مخالف",
    section: "opposing",
    accent: "text-rose",
    bg: "bg-rose-bg",
    spine: "bg-rose",
    chip: "bg-rose-bg text-rose",
  },
  Unverified: {
    name: "تأییدنشده",
    section: "unverified",
    accent: "text-indigo",
    bg: "bg-indigo-bg",
    spine: "bg-indigo",
    chip: "bg-indigo-bg text-indigo",
  },
};

export const SECTION_ORDER: LabelStyle["section"][] = [
  "main",
  "supporting",
  "opposing",
  "unverified",
];

export const SECTION_TITLE: Record<LabelStyle["section"], string> = {
  main: "شواهد اصلی",
  supporting: "شواهد پشتیبان و مقیّد",
  opposing: "شواهد مخالف",
  unverified: "تأییدنشده",
};

export function labelStyle(label: Label | string | undefined): LabelStyle {
  return LABELS[(label as Label) ?? "Unverified"] ?? LABELS.Unverified;
}