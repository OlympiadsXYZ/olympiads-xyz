// The problems tree: subject → competition → year → paper → problems.
//
// Written at build time to static/problems-data/tree.json (see index-node.ts)
// and read client-side by src/components/ProblemsTree, which is the sidebar of
// every problem page. This file is shared by both sides, so it must stay free
// of node-only imports (fs, path) — the file reading lives in index-node.ts.
import { COMPETITION_META, SCIENCE_LABELS } from '../archive/labels';

export type TreeProblem = {
  id: string;
  number: number;
  title: string | null;
  /** The problem's solution page on this site. */
  url: string;
};

export type TreePaper = {
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
    title?: string;
  };
  problems: { id: string; number: number; title?: string | null }[];
};

// ---------------------------------------------------------------------------
// Labels — the same rules scripts/problems-to-site.mjs applies to the page
// headings (gradeLabel / GROUP_NAMES there), so the sidebar and the page agree.

const GROUP_NAMES: { [subject: string]: { [code: string]: string } } = {
  physics: { ST: 'Специална тема', SP: 'Специална тема' },
  astronomy: { ML: 'Младша възраст', ST: 'Старша възраст' },
};

/** "9" → "9. клас", "9-10" → "9–10 клас", group codes → their names. */
export function gradeLabel(
  grade: string | null | undefined,
  subject: string
): string | null {
  if (!grade) return null;
  const g = String(grade)
    .replace(/\s*клас\.?$/u, '')
    .trim()
    .replace(/\s*-\s*/g, '–');
  if (/^\d+$/.test(g)) return `${g}. клас`;
  if (/^\d+–\d+$/.test(g)) return `${g} клас`;
  const named = GROUP_NAMES[subject]?.[g.toUpperCase()];
  return named ?? String(grade);
}

export function paperLabel(paper: PaperFile['paper']): string {
  const parts = [paper.round || null, gradeLabel(paper.grade, paper.subject)];
  const label = parts.filter(Boolean).join(' · ');
  return label || paper.title || paper.id;
}

// Tour names used only to tell apart papers of one year that share round and
// grade (e.g. the national round's theory paper and its test, or the IV-round
// observational tour and the Urania cup).
const ROUND_TYPE_LABELS: { [code: string]: string } = {
  theory: 'теория',
  test: 'тест',
  experiment: 'експеримент',
  practical: 'практически тур',
  observation: 'наблюдения',
  'data-analysis': 'анализ на данни',
  mixed: 'смесен тур',
};
const ROUND_TYPE_ORDER = Object.keys(ROUND_TYPE_LABELS);

/**
 * Gives every paper of a year a distinct label: papers that collide on
 * round · grade get their tour appended, and if that is still not enough the
 * paper id is appended as a last resort.
 */
function disambiguateLabels(
  papers: { paper: PaperFile['paper']; node: TreePaper }[]
) {
  const byLabel = new Map<string, typeof papers>();
  for (const p of papers) {
    const list = byLabel.get(p.node.label) ?? [];
    list.push(p);
    byLabel.set(p.node.label, list);
  }
  for (const group of byLabel.values()) {
    if (group.length < 2) continue;
    for (const p of group) {
      const tour =
        ROUND_TYPE_LABELS[p.paper.roundType ?? ''] ?? p.paper.roundType;
      if (tour) p.node.label = `${p.node.label} · ${tour}`;
    }
    const seen = new Set<string>();
    for (const p of group) {
      if (seen.has(p.node.label)) {
        p.node.label = `${p.node.label} (${p.paper.id})`;
      }
      seen.add(p.node.label);
    }
  }
}

// ---------------------------------------------------------------------------
// Sort keys

const SUBJECT_ORDER = ['physics', 'astronomy'];
const ROMAN_ROUNDS = ['I', 'II', 'III', 'IV'];

/** Round rank: I, II, III, IV first (by the leading numeral), then the rest. */
function roundRank(round: string | null | undefined): number {
  if (!round) return ROMAN_ROUNDS.length + 1;
  const m = /^(IV|III|II|I)\b/.exec(round.trim());
  if (m) return ROMAN_ROUNDS.indexOf(m[1]);
  return ROMAN_ROUNDS.length;
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
  return [2, 0, 0];
}

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpPapers(a: PaperFile['paper'], b: PaperFile['paper']): number {
  const r = cmpNum(roundRank(a.round), roundRank(b.round));
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

function roundTypeRank(type: string | null | undefined): number {
  const i = ROUND_TYPE_ORDER.indexOf(type ?? '');
  return i === -1 ? ROUND_TYPE_ORDER.length : i;
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
  onMissing?: (problemId: string, paperId: string) => void
): ProblemsTreeData {
  type PaperAcc = { paper: PaperFile['paper']; node: TreePaper };
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
      problems.push({
        id: p.id,
        number: p.number,
        title: p.title ?? null,
        url,
      });
    }
    if (problems.length === 0) continue;
    problems.sort(
      (a, b) => cmpNum(a.number, b.number) || a.id.localeCompare(b.id)
    );

    let comps = subjects.get(paper.subject);
    if (!comps) subjects.set(paper.subject, (comps = new Map()));
    let years = comps.get(paper.competition);
    if (!years) comps.set(paper.competition, (years = new Map()));
    let list = years.get(paper.year);
    if (!list) years.set(paper.year, (list = []));
    list.push({
      paper,
      node: {
        id: paper.id,
        label: paperLabel(paper),
        count: problems.length,
        problems,
      },
    });
  }

  const subjectNodes: TreeSubject[] = [];
  for (const [subjectId, comps] of subjects) {
    const compNodes: TreeCompetition[] = [];
    for (const [code, years] of comps) {
      const yearNodes: TreeYear[] = [];
      for (const [year, list] of years) {
        list.sort((a, b) => cmpPapers(a.paper, b.paper));
        disambiguateLabels(list);
        const paperNodes = list.map(x => x.node);
        yearNodes.push({
          year,
          count: paperNodes.reduce((s, p) => s + p.count, 0),
          papers: paperNodes,
        });
      }
      yearNodes.sort((a, b) => cmpNum(b.year, a.year));
      const meta = COMPETITION_META[code];
      compNodes.push({
        code,
        short: meta?.short ?? code,
        name: meta?.name ?? code,
        count: yearNodes.reduce((s, y) => s + y.count, 0),
        years: yearNodes,
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
