import problemsJson from '../data/problems.json';
import sheetsJson from '../data/sheets.json';

export type Difficulty = 'easy' | 'medium' | 'hard' | null;

export interface Problem {
  id: string;
  tufId: number;
  title: string;
  kind: 'problem' | 'article';
  difficulty: Difficulty;
  summary: string;
  links: { practice?: string; leetcode?: string; article?: string; video?: string };
  topics: string[];
  patterns: string[];
  sheets: string[];
}

export interface Group {
  id: string;
  title: string;
  problemIds: string[];
}

export interface Section {
  id: string;
  title: string;
  groups: Group[];
}

export interface Sheet {
  id: string;
  slug: string;
  name: string;
  short: string;
  description: string;
  count: number;
  sections: Section[];
}

export const problems = problemsJson as Problem[];
export const sheets = sheetsJson as Sheet[];

export const problemById = new Map(problems.map((p) => [p.id, p]));
export const sheetById = new Map(sheets.map((s) => [s.id, s]));

export const sectionProblemIds = (section: Section) => section.groups.flatMap((g) => g.problemIds);
export const sheetProblemIds = (sheet: Sheet) => sheet.sections.flatMap(sectionProblemIds);

/** Where a problem sits in each sheet that contains it. */
export function placements(problemId: string) {
  const out: { sheet: Sheet; section: Section; group: Group }[] = [];
  for (const sheet of sheets)
    for (const section of sheet.sections)
      for (const group of section.groups)
        if (group.problemIds.includes(problemId)) out.push({ sheet, section, group });
  return out;
}

/** Prefix a site path with the configured base (GitHub Pages serves under /<repo>/). */
export const url = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

/** Drive note keys; also used as file names. */
export const noteKey = {
  problem: (id: string) => `problem--${id}`,
  topic: (sheetId: string, sectionId: string) => `topic--${sheetId}--${sectionId}`,
};
