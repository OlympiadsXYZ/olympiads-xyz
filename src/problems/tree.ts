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
import { COMPETITION_META, SCIENCE_LABELS } from '../archive/labels';

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
  const label = labels?.rounds?.[paper.competition]?.[roundKey(paper)];
  return typeof label === 'string' ? label : null;
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

/**
 * A problem's title for the sidebar row. With an overlaid number, a title
 * that repeats it ("2A. Optical properties") drops the repeat, as the page
 * title does (scripts/problems-to-site.mjs problemName).
 */
function rowTitle(
  title: string | null | undefined,
  number: number | string,
  stored: number | string
): string | null {
  if (!title) return null;
  if (number === stored) return title;
  const escaped = String(number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`^${escaped}\\s*[.:)]\\s*`), '') || null;
}

/**
 * "Задача 3. Title" — the same rule as the page title: a title that already
 * starts with "Задача" is used as is, a non-numeric number ("Практически 1")
 * is the label itself.
 */
export function problemLabel(p: TreeProblem): string {
  if (p.title && /^Задача(?![\p{L}\p{N}])/u.test(p.title)) return p.title;
  const label =
    typeof p.number === 'number' || /^\d/.test(String(p.number))
      ? `Задача ${p.number}`
      : String(p.number);
  return `${label}${p.title ? '. ' + p.title : ''}`;
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
  mixed: 'смесен тур',
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
    let years = comps.get(paper.competition);
    if (!years) comps.set(paper.competition, (years = new Map()));
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
        short: meta?.short ?? code,
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
