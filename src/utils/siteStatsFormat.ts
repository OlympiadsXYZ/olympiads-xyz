// Wording for the build-time counts (src/gatsby/site-stats.ts): the home page,
// the announcement bar and the 404 page say "над 9000 задачи", never a number
// typed into a translation. No imports, so node tests can load it as is.

export type SiteStatsCounts = {
  problems: number;
  problemsWithSolution: number;
  papers: number;
  /** Subjects of the published problems, in the order of the Архив menu. */
  subjects: string[];
  archiveFiles: number;
  archiveCompetitionFiles: number;
  archiveCompetitions: number;
};

/** Rounds down to the hundred from 1000 on, to the ten from 100 on ("над 9000"). */
export function roundDownCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1000) return Math.floor(n / 100) * 100;
  if (n >= 100) return Math.floor(n / 10) * 10;
  return Math.floor(n);
}

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * Bulgarian digit grouping: a no-break space from five digits on ("12 400"),
 * none in a four-digit number ("9000"). Deterministic, unlike
 * toLocaleString, whose output differs between Node's ICU and the browsers
 * (a hydration mismatch in the static HTML).
 */
export function formatCount(n: number): string {
  const digits = String(Math.floor(n));
  if (digits.length < 5) return digits;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NO_BREAK_SPACE);
}

/** "9000", rounded down and grouped: the number after "над". */
export const approxCount = (n: number): string =>
  formatCount(roundDownCount(n));

/**
 * Official solutions exist for most problems, not all (APAO 2012 has none):
 * the claim is "повечето с официални решения" while more than half have one,
 * and no claim at all otherwise.
 */
export const mostHaveSolutions = (stats: SiteStatsCounts): boolean =>
  stats.problems > 0 && stats.problemsWithSolution * 2 > stats.problems;

// lower case, as they read after "по" ("задачи по физика")
const SUBJECT_NAMES: { [subject: string]: string } = {
  physics: 'физика',
  astronomy: 'астрономия',
  chemistry: 'химия',
  geography: 'география',
  mathematics: 'математика',
  informatics: 'информатика',
  biology: 'биология',
};

/** "физика, астрономия, химия и география" (the subjects with problems). */
export function subjectList(subjects: string[]): string {
  const names = subjects.map(s => SUBJECT_NAMES[s] ?? s);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}
