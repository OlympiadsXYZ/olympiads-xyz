// Client-side search over the static problems index (/problems-data/index.json,
// written at build time by src/problems/index-node.ts). Shared by the /problems
// page and the search modal in the top navigation bar, so both load the index
// once and match text the same way.
import {
  COMPETITION_META,
  SCIENCE_LABELS,
  competitionShort,
} from '../../archive/labels';
import type { ProblemsIndexEntry } from '../../problems/index-node';

export const PROBLEMS_INDEX_URL = '/problems-data/index.json';

let indexPromise: Promise<ProblemsIndexEntry[]> | null = null;

/**
 * Fetches the problems index once per page load; later calls share the same
 * request. A failed request is not cached, so the next call retries.
 */
export function loadProblemsIndex(): Promise<ProblemsIndexEntry[]> {
  if (!indexPromise) {
    indexPromise = fetch(PROBLEMS_INDEX_URL)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(data => (Array.isArray(data) ? data : []))
      .catch(error => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

/**
 * Lowercases, strips accents (keeping й) and unifies dashes, so that e.g.
 * "Ёлка", "ёлка" and "елка" or "9–10" and "9-10" match each other.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/и\u0306/g, 'й')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-');
}

/** The normalized words of a query; a problem matches when it contains all. */
export function searchTokens(query: string): string[] {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(token => token.length > 0);
}

/** A digit or a (lowercase) letter of a cased script: Latin, Cyrillic, Greek. */
const isWordChar = (c: string) =>
  (c >= '0' && c <= '9') || c !== c.toUpperCase();

/**
 * Whether a word of lowercase `text` starts with `token` ("махал" finds
 * "махалото", but "физика" does not find "астрофизика", nor "ток" "поток").
 */
export function hasWordStartingWith(text: string, token: string): boolean {
  for (let at = text.indexOf(token); at !== -1; ) {
    if (at === 0 || !isWordChar(text[at - 1])) return true;
    at = text.indexOf(token, at + 1);
  }
  return false;
}

/** Both arguments normalized (normalizeSearchText / searchTokens). */
export function matchesAllTokens(text: string, tokens: string[]): boolean {
  return tokens.every(token => hasWordStartingWith(text, token));
}

/** Bulgarian labels for the English tags some papers carry (round type, group). */
const TAG_LABELS: { [tag: string]: string } = {
  theory: 'Теория',
  mixed: 'Смесен',
  experiment: 'Експеримент',
  observation: 'Наблюдения',
  practical: 'Практически',
  test: 'Тест',
  'data-analysis': 'Анализ на данни',
  alpha: 'α',
  beta: 'β',
  Optics: 'Оптика',
  'Modern physics': 'Съвременна физика',
};

export function tagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? tag;
}

/** Display order of the subjects; any other subject goes after these. */
export const SUBJECT_ORDER = ['physics', 'astronomy', 'chemistry', 'geography'];

export function subjectLabel(subject: string): string {
  return SCIENCE_LABELS[subject] ?? subject;
}

/** "НОФ — Национална олимпиада по физика", or the bare code without metadata. */
export function competitionLabel(code: string): string {
  const meta = COMPETITION_META[code];
  if (!meta) return code;
  return meta.name && meta.name !== meta.short
    ? `${meta.short} — ${meta.name}`
    : meta.short;
}

/**
 * The problem's source with the competition code replaced by its Bulgarian
 * short name: "NOF 2019 II 7" → "НОФ 2019 II 7".
 */
export function problemSourceLabel(problem: ProblemsIndexEntry): string {
  const source = problem.source ?? '';
  const code = problem.competition;
  if (!code || !COMPETITION_META[code]) return source;
  if (source === code || source.startsWith(`${code} `)) {
    return competitionShort(code) + source.slice(code.length);
  }
  return source;
}

const searchTextCache = new WeakMap<ProblemsIndexEntry, string>();

/**
 * Everything a query is matched against: name, source (also with the
 * Bulgarian competition names), subject, tags and classification terms.
 */
export function problemSearchText(problem: ProblemsIndexEntry): string {
  const cached = searchTextCache.get(problem);
  if (cached !== undefined) return cached;
  const meta = problem.competition
    ? COMPETITION_META[problem.competition]
    : undefined;
  const tags = problem.tags ?? [];
  const text = normalizeSearchText(
    [
      problem.name,
      problem.source,
      meta?.short,
      meta?.name,
      problem.subject ? subjectLabel(problem.subject) : null,
      ...tags,
      ...tags.map(tagLabel),
      ...(problem.classificationTerms ?? []),
    ]
      .filter(Boolean)
      .join(' ')
  );
  searchTextCache.set(problem, text);
  return text;
}

// ---------------------------------------------------------------------------
// Difficulty: one scale for every card and one facet. A problem whose
// classification estimated a level (assessmentLabel "Оценена трудност: 3/5")
// is shown and filtered by that level; any other by its recorded difficulty.

export const DIFFICULTY_ORDER = [
  'Very Easy',
  'Easy',
  'Normal',
  'Hard',
  'Very Hard',
  'Insane',
  'N/A',
];

const LEVEL_DIFFICULTY = ['Very Easy', 'Easy', 'Normal', 'Hard', 'Very Hard'];

/** The problem's difficulty on the site's scale ("Very Easy" … "Insane", "N/A"). */
export function problemDifficulty(
  problem: Pick<ProblemsIndexEntry, 'difficulty' | 'assessmentLabel'>
): string {
  const level = /(\d)\s*\/\s*5/.exec(problem.assessmentLabel ?? '');
  if (level) {
    const mapped = LEVEL_DIFFICULTY[Number(level[1]) - 1];
    if (mapped) return mapped;
  }
  return problem.difficulty || 'N/A';
}

// ---------------------------------------------------------------------------
// Order of the list.

export type ProblemSort = 'newest' | 'oldest' | 'competition';
export const DEFAULT_SORT: ProblemSort = 'newest';
export const SORT_OPTIONS: { value: ProblemSort; label: string }[] = [
  { value: 'newest', label: 'Най-новите първо' },
  { value: 'oldest', label: 'Най-старите първо' },
  { value: 'competition', label: 'По състезание' },
];

const naturalId = (a: string, b: string) =>
  a.localeCompare(b, 'en', { numeric: true });

/**
 * The problems in the chosen order. Within a year (or a competition) the
 * competitions keep `competitionRank`'s order and a paper's problems their
 * numbers (ids compared with numbers as numbers: p2 before p10). Problems
 * without a year come last.
 */
export function sortProblems(
  problems: ProblemsIndexEntry[],
  sort: ProblemSort,
  competitionRank: (code: string | null | undefined) => number
): ProblemsIndexEntry[] {
  const year = (p: ProblemsIndexEntry, dir: number) =>
    typeof p.year === 'number' ? dir * p.year : Number.POSITIVE_INFINITY;
  const byYear = (a: ProblemsIndexEntry, b: ProblemsIndexEntry, dir: number) =>
    year(a, dir) - year(b, dir) || 0;
  const byCompetition = (a: ProblemsIndexEntry, b: ProblemsIndexEntry) =>
    competitionRank(a.competition) - competitionRank(b.competition);
  const cmp =
    sort === 'competition'
      ? (a: ProblemsIndexEntry, b: ProblemsIndexEntry) =>
          byCompetition(a, b) || byYear(a, b, -1)
      : (a: ProblemsIndexEntry, b: ProblemsIndexEntry) =>
          byYear(a, b, sort === 'oldest' ? 1 : -1) || byCompetition(a, b);
  return [...problems].sort(
    (a, b) => cmp(a, b) || naturalId(a.uniqueId, b.uniqueId)
  );
}

// ---------------------------------------------------------------------------
// The page's state in its URL (/problems/?subject=physics&year=2019&page=3),
// so a reload, a shared link and Back keep the list as it was.

/** The facets whose selection goes into the URL, in the order they appear there. */
export const FILTER_PARAMS = [
  'subject',
  'competition',
  'year',
  'difficulty',
  'tags',
  'fields',
  'isStarred',
  'progress',
];

export type ProblemsUrlState = {
  q: string;
  filters: { [attribute: string]: string[] };
  /** 0-based */
  page: number;
  sort: ProblemSort;
  /** null = the default page size */
  perPage: number | null;
};

export function parseProblemsUrl(search: string): ProblemsUrlState {
  const params = new URLSearchParams(search);
  const filters: { [attribute: string]: string[] } = {};
  for (const attribute of FILTER_PARAMS) {
    const values = params
      .getAll(attribute)
      .flatMap(v => v.split(','))
      .map(v => v.trim())
      .filter(Boolean);
    if (values.length) filters[attribute] = [...new Set(values)];
  }
  const page = parseInt(params.get('page') ?? '', 10);
  const perPage = parseInt(params.get('n') ?? '', 10);
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? '',
    filters,
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
    sort: SORT_OPTIONS.some(o => o.value === sort)
      ? (sort as ProblemSort)
      : DEFAULT_SORT,
    perPage: Number.isFinite(perPage) && perPage > 0 ? perPage : null,
  };
}

/** "?q=…&subject=physics&page=3", or "" for the default state. Defaults are left out. */
export function problemsUrlSearch(state: ProblemsUrlState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  for (const attribute of FILTER_PARAMS) {
    for (const value of state.filters[attribute] ?? []) {
      params.append(attribute, value);
    }
  }
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  if (state.perPage) params.set('n', String(state.perPage));
  if (state.page > 0) params.set('page', String(state.page + 1));
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** 8674 -> "8 674" (Bulgarian digit groups, with no-break spaces). */
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "1 задача", "8 674 задачи" */
export function problemsCountLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'задача' : 'задачи'}`;
}

/** Link target of a problem: its page on this site, or the source document. */
export function problemLink(problem: ProblemsIndexEntry): {
  href: string;
  internal: boolean;
} {
  if (problem.solution?.kind === 'internal') {
    return { href: `${problem.problemURL}/solution`, internal: true };
  }
  return { href: problem.url, internal: false };
}
