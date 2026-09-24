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
