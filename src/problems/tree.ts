// The problems tree: subject → competition → year → paper node → problems.
//
// Written at build time to static/problems-data/tree.json (see index-node.ts)
// and read client-side by src/components/ProblemsTree, which is the sidebar of
// every problem page. This file is shared by both sides, so it must stay free
// of node-only imports (fs, path) — the file reading lives in index-node.ts,
// which also loads the two navigation overlays passed in here:
//   content/round-labels.json     canonical round label per (competition, raw round, roundType)
//   content/question-numbers.json display number per problem where the stored one is not the printed one
// scripts/lib/navigation.mjs applies the same lookups to the problem pages, and
// scripts/check-navigation.mjs checks the two agree and gates the result.
import {
  COMPETITION_META,
  SCIENCE_LABELS,
  canonicalCompetition,
} from '../archive/labels';

export type TreeProblem = {
  id: string;
  /** The display number (content/question-numbers.json, else the stored number). */
  number: number | string;
  title: string | null;
  /** The problem's solution page on this site. */
  url: string;
};

export type TreePaper = {
  /** The id of the node's first paper (a node can hold several papers of one round). */
  id: string;
  /** "III кръг (национален) · 9. клас" */
  label: string;
  count: number;
  problems: TreeProblem[];
};

export type TreeYear = {
  year: number;
  count: number;
  papers: TreePaper[];
};

export type TreeCompetition = {
  code: string;
  short: string;
  name: string;
  count: number;
  years: TreeYear[];
};

export type TreeSubject = {
  id: string;
  label: string;
  count: number;
  competitions: TreeCompetition[];
};

export type ProblemsTreeData = {
  count: number;
  subjects: TreeSubject[];
};

/** The parts of content/problems/**\/*.json the tree needs. */
export type PaperFile = {
  paper: {
    id: string;
    subject: string;
    competition: string;
    year: number;
    round?: string | null;
    roundType?: string | null;
    grade?: string | null;
    lang?: string | null;
    title?: string;
  };
  problems: { id: string; number: number | string; title?: string | null }[];
};

/** content/round-labels.json */
export type RoundLabels = {
  rounds?: { [competition: string]: { [roundKey: string]: string } };
  papers?: { [paperId: string]: string };
  grades?: { [competition: string]: { [grade: string]: string } };
  suffixes?: { [paperId: string]: string };
};

/** content/question-numbers.json */
export type QuestionNumbers = {
  problems?: { [problemId: string]: number | string };
};

export type NavigationOverlays = {
  labels?: RoundLabels | null;
  numbers?: QuestionNumbers | null;
};

// ---------------------------------------------------------------------------
// Labels — the same rules scripts/lib/navigation.mjs applies to the page
// headings, so the sidebar and the page agree (check-navigation.mjs verifies it).

const GROUP_NAMES: { [subject: string]: { [code: string]: string } } = {
  physics: { ST: 'Специална тема', SP: 'Специална тема' },
  astronomy: { ML: 'Младша възраст', ST: 'Старша възраст' },
};

/**
 * "9" → "9. клас", "9-10" → "9–10 клас", group codes → their names; a
 * competition's own group names (round-labels.json grades) come first.
 */
export function gradeLabel(
  grade: string | null | undefined,
  subject: string,
  competition?: string,
  labels?: RoundLabels | null
): string | null {
  if (!grade) return null;
  const own = competition
    ? labels?.grades?.[competition]?.[String(grade)]
    : undefined;
  if (typeof own === 'string') return own || null;
  const g = String(grade)
    .replace(/\s*клас\.?$/u, '')
    .trim()
    .replace(/\s*-\s*/g, '–');
  if (/^\d+$/.test(g)) return `${g}. клас`;
  if (/^\d+–\d+$/.test(g)) return `${g} клас`;
  const named = GROUP_NAMES[subject]?.[g.toUpperCase()];
  return named ?? String(grade);
}

/** "theory|theory", "|observation": a (raw round, roundType) pair's key in round-labels.json. */
export function roundKey(paper: PaperFile['paper']): string {
  return `${paper.round ?? ''}|${paper.roundType ?? ''}`;
}

/**
 * The canonical round label, or null when round-labels.json has none (the
 * gate fails on that). "" is a label: a one-round competition named by grade.
 */
export function roundLabel(
  paper: PaperFile['paper'],
  labels?: RoundLabels | null
): string | null {
  const own = labels?.papers?.[paper.id];
  if (typeof own === 'string') return own;
  const key = roundKey(paper);
  const label =
    labels?.rounds?.[paper.competition]?.[key] ??
    labels?.rounds?.[canonicalCompetition(paper.competition)]?.[key];
  return typeof label === 'string' ? label : null;
}

/** The competition a paper is listed under (a legacy code such as VSERUSIYSKA joins its canonical one). */
export function paperCompetition(paper: PaperFile['paper']): string {
  return canonicalCompetition(paper.competition);
}

/** Does the site have a name for this competition (COMPETITION_META, directly or through an alias)? */
export function hasCompetitionName(code: string): boolean {
  return !!COMPETITION_META[canonicalCompetition(code)];
}

/** The short name of a competition in the sidebar and in a page's source line ("НОФ", "ВсОШ"). */
export function competitionShortName(code: string): string {
  const canonical = canonicalCompetition(code);
  return COMPETITION_META[canonical]?.short ?? canonical;
}

/**
 * The node label of a paper: canonical round label · grade label · suffix
 * (round-labels.json suffixes: "първи ден", "тест"). Without an overlay entry
 * (the gate refuses that) it falls back to the raw round, and only as a last
 * resort to the title, so the build never breaks on it.
 */
export function paperLabel(
  paper: PaperFile['paper'],
  labels?: RoundLabels | null
): string {
  const grade = gradeLabel(
    paper.grade,
    paper.subject,
    paper.competition,
    labels
  );
  const round = roundLabel(paper, labels);
  const suffix = labels?.suffixes?.[paper.id] || null;
  const parts = [(round ?? paper.round) || null, grade, suffix];
  const label = parts.filter(Boolean).join(' · ');
  return label || paper.title || paper.id;
}

/** The number a problem is shown with. */
export function displayNumber(
  problem: { id: string; number: number | string },
  numbers?: QuestionNumbers | null
): number | string {
  const own = numbers?.problems?.[problem.id];
  return own != null ? own : problem.number;
}

// A grade-problem code printed at the head of a problem title, in the forms the
// all-grade papers use: "10-1 «Сифон»" (BelPhO), "10 класс. Задача №1. …",
// "8-9 класс, задача 3", "Ученици X-XII клас, Задача 1", "10.1. Title".
// Returns the grade, the problem number and the length of the head.
const GRADE_CODES: [RegExp, (m: RegExpExecArray) => [string, string]][] = [
  [
    /^\s*(\d{1,2}\s*[-–]\s*\d{1,2})\s*класс?[ыа]?\.?,?\s*задача\s*№?\s*(\d{1,2})(?!\d)\s*[.:]?\s*/iu,
    m => [m[1], m[2]],
  ],
  [
    /^\s*(\d{1,2})\s*класс?\.?,?\s*задача\s*№?\s*(\d{1,2})(?!\d)\s*[.:]?\s*/iu,
    m => [m[1], m[2]],
  ],
  [
    /^\s*Ученици\s+([IVX]+\s*[-–÷]\s*[IVX]+)\s*клас,?\s*Задача\s*(\d{1,2})(?!\d)\s*[.:]?\s*/u,
    m => [m[1], m[2]],
  ],
  [/^\s*(\d{1,2})-(\d{1,2})(?![\d.–-]|\s*клас)\s*[.:]?\s*/u, m => [m[1], m[2]]],
  [/^\s*(\d{1,2})\.(\d)\.?(?=\s)\s*/u, m => [m[1], m[2]]],
];
const dashes = (s: string) => s.replace(/\s*[-–÷]\s*/g, '–');

/** { grade, n, head } of a title that opens with a grade-problem code, else null. */
export function gradeCode(
  title: string | null | undefined
): { grade: string; n: string; head: number } | null {
  for (const [re, parts] of GRADE_CODES) {
    const m = re.exec(String(title ?? ''));
    if (m) {
      const [grade, n] = parts(m);
      return { grade: dashes(grade), n, head: m[0].length };
    }
  }
  return null;
}

/** Does a display number name this grade-problem code ("10-1", "10.1", "X–XII.1" for grade X-XII, problem 1)? */
export function numberNamesCode(
  number: number | string,
  code: { grade: string; n: string }
): boolean {
  const s = dashes(String(number));
  return [`${code.grade}.${code.n}`, `${code.grade}–${code.n}`].includes(s);
}

/**
 * A problem's title for the sidebar row and the page title. With an overlaid
 * number, a title that repeats it drops the repeat: "2A. Optical properties",
 * "10-1 «Сифон»" and "10 класс. Задача №1. Эффективная масса" shown as 10.1.
 */
export function rowTitle(
  title: string | null | undefined,
  number: number | string,
  stored: number | string
): string | null {
  if (!title) return null;
  if (number === stored) return title;
  const code = gradeCode(title);
  if (code && numberNamesCode(number, code))
    return title.slice(code.head).trim() || null;
  const escaped = String(number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    title
      .replace(new RegExp(`^${escaped}(?:\\s*[.:)]\\s*|\\s+(?=\\S)|$)`), '')
      .trim() || null
  );
}

const ROMAN_VALUES: { [r: string]: number } = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};
// "Задача 3. …", "Задача №2 …", "Задача II. …", "Задача 10.1 …", "Задача 8 (група α)", "Задача – оценка"
const TITLE_HEAD =
  /^Задача(?![\p{L}\p{N}])\s*(?:№\s*)?(?:(\d+(?:\.\d+)*[A-Za-zА-Яа-я]?|[IVX]+)(?![\p{L}\p{N}]|\.\d))?/u;

/** The number a row shows: "Задача 3", "Задача 2A", or a non-numeric number as is ("Практически 1"). */
export function numberLabel(number: number | string): string {
  return typeof number === 'number' || /^\d/.test(String(number))
    ? `Задача ${number}`
    : String(number);
}

/**
 * "Задача 3. Title" — the sidebar row and the page title (the page generator
 * loads this function, so both read the same). The row always leads with the
 * display number. A title that starts with "Задача" is kept as is only when it
 * prints that same number ("Задача 4. Звезди" for 4; "Задача 10.1 …" for
 * problem 1 of a grade-10 sheet; "Задача 8 (група α)" for 8α). Otherwise the
 * display number leads and the printed heading follows: "Задача 21. Задача 1.
 * Химическа главоблъсканица" (the second part of a paper whose test holds
 * 1–20), "Задача 2. Праволинейно движение" for a printed "Задача II.",
 * "Задача 2 – оценка" for "Задача – оценка", "Задача 4" for a title that is
 * only the points ("Задача 3 т.").
 */
export function problemLabel(p: { number: number | string; title?: string | null }): string {
  const label = numberLabel(p.number);
  const title = p.title ? p.title.trim() : '';
  if (!title) return label;
  const m = TITLE_HEAD.exec(title);
  if (!m) return `${label}. ${title}`;
  const printed = m[1];
  const shown = String(p.number);
  const rest = title.slice(m[0].length);
  const numeric = label !== shown;
  if (printed != null) {
    if (printed === shown) return title;
    // "Задача 10.1" on problem 1 of a grade-10 sheet; "Задача 8 (група α)" on 8α
    const graded = /^(\d+)\.(\d+)$/.exec(printed);
    if (graded && graded[2] === shown) return title;
    if (/^\d+$/.test(printed) && new RegExp(`^${printed}\\p{L}+$`, 'u').test(shown)) return title;
    // only the points: "Задача 3 т."
    if (/^\s*(?:т|точк[аи])\.?\s*$/u.test(rest)) return label;
    const value = ROMAN_VALUES[printed] ?? (/^\d+$/.test(printed) ? Number(printed) : null);
    // "Задача II." on problem 2; "Задача 1." on "Наблюдателен 1" (a named tour numbers its own problems)
    const own = numeric ? shown : /(\d+)$/.exec(shown)?.[1];
    if (value != null && String(value) === own) {
      const tail = rest.replace(/^\s*[.:)]?\s*/, '');
      return tail ? `${label}. ${tail}` : label;
    }
    return `${label}. ${title}`;
  }
  // no printed number: "Задача", "Задача – оценка", "Задача „три в едно“", "Задача о максимумах"
  if (!rest.trim()) return label;
  if (!numeric) return `${label}. ${title}`;
  if (/^\s*[.:]/.test(rest)) {
    const tail = rest.replace(/^\s*[.:]\s*/, '');
    return tail ? `${label}. ${tail}` : label;
  }
  return `${label} ${rest.trim()}`;
}

/** The problem's full name, as the page title and the sidebar row show it. */
export function problemDisplayName(
  problem: { id: string; number: number | string; title?: string | null },
  numbers?: QuestionNumbers | null
): string {
  const number = displayNumber(problem, numbers);
  return problemLabel({
    number,
    title: rowTitle(problem.title, number, problem.number),
  });
}

/**
 * Does a row label lead with its display number? The navigation gate checks
 * every row with it: a label that does not is a row whose visible number
 * contradicts the number the node is sorted and checked by.
 */
export function labelLeadsWithNumber(
  label: string,
  number: number | string
): boolean {
  const lead = numberLabel(number);
  if (label.startsWith(lead) && !/^(?:[\p{L}\p{N}]|\.\d)/u.test(label.slice(lead.length)))
    return true;
  // a verbatim printed heading problemLabel accepts for this number
  const m = TITLE_HEAD.exec(label);
  if (!m || m[1] == null) return false;
  const shown = String(number);
  const graded = /^(\d+)\.(\d+)$/.exec(m[1]);
  return (
    m[1] === shown ||
    (graded != null && graded[2] === shown) ||
    (/^\d+$/.test(m[1]) && new RegExp(`^${m[1]}\\p{L}+$`, 'u').test(shown))
  );
}

// Tour names used only to tell apart the papers of one node whose problem
// numbers collide (the national round's theory paper and its test, the
// regional stage's theory and experiment).
const ROUND_TYPE_LABELS: { [code: string]: string } = {
  theory: 'теория',
  test: 'тест',
  experiment: 'експеримент',
  practical: 'практически тур',
  observation: 'наблюдения',
  'data-analysis': 'анализ на данни',
  team: 'отборен тур',
  mixed: 'теория и практика',
};
const ROUND_TYPE_ORDER = Object.keys(ROUND_TYPE_LABELS);

const LANG_LABELS: { [code: string]: string } = {
  bg: 'на български',
  en: 'на английски',
  ru: 'на руски',
  other: 'на друг език',
};

// ---------------------------------------------------------------------------
// Sort keys

const SUBJECT_ORDER = ['physics', 'astronomy'];
const ROMAN_ROUNDS = ['I', 'II', 'III', 'IV'];
// Named stages in their order within a year; tours after them in their order.
const STAGE_ORDER = [
  'Пробен кръг',
  'Районен етап',
  'Областен етап',
  'Регионален етап',
  'Четвъртфинал',
  'Полуфинал',
  'Заключителен етап',
  'Финален кръг',
];
const TOUR_ORDER = [
  'Теория',
  'Експеримент',
  'Теория и експеримент',
  'Практически тур',
  'Наблюдения',
  'Анализ на данни',
  'Отборен тур',
  'Тест',
  'Блиц',
];

/** Round rank of a node label: I–IV first, then the named stages, the tours, the rest. */
function labelRank(label: string): number {
  const m = /^(IV|III|II|I)\b/.exec(label.trim());
  if (m) return ROMAN_ROUNDS.indexOf(m[1]);
  const stage = STAGE_ORDER.findIndex(s => label.startsWith(s));
  if (stage !== -1) return 10 + stage;
  const tour = TOUR_ORDER.findIndex(
    s => label === s || label.startsWith(s + ' ·')
  );
  if (tour !== -1) return 30 + tour;
  return 50;
}

/**
 * Grade rank: numeric grades first (by lower then upper bound), then the
 * named groups in a fixed order (junior, senior, special), then anything else.
 */
function gradeRank(grade: string | null | undefined): [number, number, number] {
  if (!grade) return [3, 0, 0];
  const g = String(grade).trim();
  const m = /^(\d+)(?:\s*[-–]\s*(\d+))?/.exec(g);
  if (m) return [0, Number(m[1]), m[2] ? Number(m[2]) : Number(m[1])];
  const u = g.toUpperCase();
  if (u === 'ML' || u.startsWith('МЛАДША')) return [1, 0, 0];
  if (u === 'ST' || u.startsWith('СТАРША')) return [1, 1, 0];
  if (u === 'SP') return [1, 2, 0];
  // IAO / APAO groups: α before β before γ (the letter or its name)
  const greek = ['Α', 'Β', 'Γ'].findIndex(
    (letter, i) =>
      u.startsWith(letter) || u.startsWith(['ALPHA', 'BETA', 'GAMMA'][i])
  );
  if (greek !== -1) return [2, greek, u.length];
  return [2, 9, 0];
}

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Display numbers in reading order, digit runs compared as numbers: 2 < 10,
 * 4 < "4.1" < "4.2" < "4.10" < 5, "2A" < "2B", numbers before "Тест 1".
 */
export function cmpDisplayNumbers(
  a: number | string,
  b: number | string
): number {
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

function roundTypeRank(type: string | null | undefined): number {
  const i = ROUND_TYPE_ORDER.indexOf(type ?? '');
  return i === -1 ? ROUND_TYPE_ORDER.length : i;
}

function cmpPapers(
  a: PaperFile['paper'],
  b: PaperFile['paper'],
  labels?: RoundLabels | null
): number {
  const r = cmpNum(
    labelRank(roundLabel(a, labels) ?? a.round ?? ''),
    labelRank(roundLabel(b, labels) ?? b.round ?? '')
  );
  if (r) return r;
  const ga = gradeRank(a.grade);
  const gb = gradeRank(b.grade);
  for (let i = 0; i < 3; i++) {
    const c = cmpNum(ga[i], gb[i]);
    if (c) return c;
  }
  const t = cmpNum(roundTypeRank(a.roundType), roundTypeRank(b.roundType));
  if (t) return t;
  return a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Nodes of one year

type PaperAcc = { paper: PaperFile['paper']; problems: TreeProblem[] };

/** Two different papers of the list share a display number. */
export function numbersCollide(list: { problems: TreeProblem[] }[]): boolean {
  const owner = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    for (const p of list[i].problems) {
      const key = String(p.number);
      const seen = owner.get(key);
      if (seen !== undefined && seen !== i) return true;
      owner.set(key, i);
    }
  }
  return false;
}

function splitBy(list: PaperAcc[], key: (p: PaperAcc) => string) {
  const out = new Map<string, PaperAcc[]>();
  for (const p of list) {
    const k = key(p);
    const group = out.get(k) ?? [];
    group.push(p);
    out.set(k, group);
  }
  return out;
}

/**
 * The nodes of one year. Papers that share a label (round label · grade ·
 * suffix) and a language merge into one node when their display numbers do
 * not collide (IPhO 2016: one "Теория" node with Задача 1, 2, 3). Papers of
 * one label in several languages (an original and its translation) are split
 * by language first ("· на английски", "· на български"); a colliding set is
 * then split by tour ("· теория", "· тест") unless the round label already
 * names the tour. What still collides keeps one node per paper, labelled with
 * its id — round-labels.json suffixes[] is where such papers get proper labels.
 */
export function yearNodes(
  list: PaperAcc[],
  labels?: RoundLabels | null
): TreePaper[] {
  const sorted = [...list].sort((a, b) => cmpPapers(a.paper, b.paper, labels));
  const out: { first: PaperAcc; node: TreePaper }[] = [];
  const emit = (group: PaperAcc[], label: string) => {
    const problems = group
      .flatMap(p => p.problems)
      .sort(
        (a, b) =>
          cmpDisplayNumbers(a.number, b.number) || a.id.localeCompare(b.id)
      );
    out.push({
      first: group[0],
      node: { id: group[0].paper.id, label, count: problems.length, problems },
    });
  };
  const byLabel = splitBy(sorted, p => paperLabel(p.paper, labels));
  for (const [label, group] of byLabel) {
    const byLang = splitBy(group, p => p.paper.lang ?? '');
    for (const [lang, langGroup] of byLang) {
      const langLabel =
        byLang.size > 1 && lang
          ? `${label} · ${LANG_LABELS[lang] ?? lang}`
          : label;
      if (langGroup.length < 2 || !numbersCollide(langGroup)) {
        emit(langGroup, langLabel);
        continue;
      }
      const round = roundLabel(langGroup[0].paper, labels) ?? '';
      const byTour = TOUR_ORDER.includes(round)
        ? new Map([['', langGroup]])
        : splitBy(langGroup, p => p.paper.roundType ?? '');
      for (const [type, tourGroup] of byTour) {
        const tour = ROUND_TYPE_LABELS[type] ?? type;
        const tourLabel =
          byTour.size > 1 && tour ? `${langLabel} · ${tour}` : langLabel;
        if (tourGroup.length < 2 || !numbersCollide(tourGroup)) {
          emit(tourGroup, tourLabel);
          continue;
        }
        for (const p of tourGroup) emit([p], `${tourLabel} (${p.paper.id})`);
      }
    }
  }
  out.sort(
    (a, b) =>
      cmpPapers(a.first.paper, b.first.paper, labels) ||
      a.node.label.localeCompare(b.node.label)
  );
  // two groups can still meet on one label (a per-paper label equal to a
  // combination's): the id keeps the sidebar rows distinct
  const seen = new Set<string>();
  for (const x of out) {
    if (seen.has(x.node.label)) x.node.label = `${x.node.label} (${x.node.id})`;
    seen.add(x.node.label);
  }
  return out.map(x => x.node);
}

// ---------------------------------------------------------------------------

/**
 * Assembles the tree from the paper files and a map problem id → solution page
 * URL. Problems without a URL (no ProblemInfo node) are skipped and reported
 * through `onMissing`. Output is deterministic for a given input.
 */
export function assembleProblemsTree(
  papers: PaperFile[],
  urlById: Map<string, string>,
  onMissing?: (problemId: string, paperId: string) => void,
  overlays: NavigationOverlays = {}
): ProblemsTreeData {
  const { labels, numbers } = overlays;
  // subject → competition → year → papers
  const subjects = new Map<string, Map<string, Map<number, PaperAcc[]>>>();

  for (const file of papers) {
    const { paper } = file;
    const problems: TreeProblem[] = [];
    for (const p of file.problems ?? []) {
      const url = urlById.get(p.id);
      if (!url) {
        onMissing?.(p.id, paper.id);
        continue;
      }
      const number = displayNumber(p, numbers);
      problems.push({
        id: p.id,
        number,
        title: rowTitle(p.title, number, p.number),
        url,
      });
    }
    if (problems.length === 0) continue;

    let comps = subjects.get(paper.subject);
    if (!comps) subjects.set(paper.subject, (comps = new Map()));
    const competition = paperCompetition(paper);
    let years = comps.get(competition);
    if (!years) comps.set(competition, (years = new Map()));
    let list = years.get(paper.year);
    if (!list) years.set(paper.year, (list = []));
    list.push({ paper, problems });
  }

  const subjectNodes: TreeSubject[] = [];
  for (const [subjectId, comps] of subjects) {
    const compNodes: TreeCompetition[] = [];
    for (const [code, years] of comps) {
      const yearList: TreeYear[] = [];
      for (const [year, list] of years) {
        const paperNodes = yearNodes(list, labels);
        yearList.push({
          year,
          count: paperNodes.reduce((s, p) => s + p.count, 0),
          papers: paperNodes,
        });
      }
      yearList.sort((a, b) => cmpNum(b.year, a.year));
      const meta = COMPETITION_META[code];
      compNodes.push({
        code,
        short: competitionShortName(code),
        name: meta?.name ?? code,
        count: yearList.reduce((s, y) => s + y.count, 0),
        years: yearList,
      });
    }
    compNodes.sort(
      (a, b) => cmpNum(b.count, a.count) || a.code.localeCompare(b.code)
    );
    subjectNodes.push({
      id: subjectId,
      label: SCIENCE_LABELS[subjectId] ?? subjectId,
      count: compNodes.reduce((s, c) => s + c.count, 0),
      competitions: compNodes,
    });
  }
  subjectNodes.sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a.id);
    const ib = SUBJECT_ORDER.indexOf(b.id);
    const ra = ia === -1 ? SUBJECT_ORDER.length : ia;
    const rb = ib === -1 ? SUBJECT_ORDER.length : ib;
    return cmpNum(ra, rb) || a.id.localeCompare(b.id);
  });

  return {
    count: subjectNodes.reduce((s, x) => s + x.count, 0),
    subjects: subjectNodes,
  };
}
