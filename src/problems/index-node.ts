// Node-side problems index (used by gatsby-node only).
//
// The /problems page used to be backed by Algolia, which was never configured
// for this project (GATSBY_ALGOLIA_APP_ID / GATSBY_ALGOLIA_SEARCH_KEY are
// unset), so the index was always empty and the page always rendered
// "no problems found". Instead we write a static JSON index at build time and
// filter it client-side — the same approach the archive uses
// (see src/archive/catalog-node.ts).
import fs from 'fs';
import path from 'path';
import { COMPETITION_META, SCIENCE_LABELS } from '../archive/labels';
import { getProblemURL, recentUsaco } from '../models/problem';
import {
  assembleProblemsTree,
  NavigationOverlays,
  PaperFile,
  ProblemsTreeData,
} from './tree';

export type ProblemsIndexModule = {
  id: string;
  title: string;
};

export type ProblemsIndexSolution = {
  kind: 'internal' | 'link' | 'label' | 'sketch';
  label?: string | null;
  labelTooltip?: string | null;
  url?: string | null;
  sketch?: string | null;
  hasHints?: boolean | null;
} | null;

export type ProblemsIndexEntry = {
  uniqueId: string;
  name: string;
  url: string;
  source: string;
  difficulty: string;
  assessmentLabel?: string | null;
  fields?: string[] | null;
  conceptIds?: string[] | null;
  classificationTerms?: string[] | null;
  isStarred: boolean;
  tags: string[];
  problemModules: ProblemsIndexModule[];
  solution: ProblemsIndexSolution;
  /** The problem's page on this site, from getProblemURL(). */
  problemURL: string;
  /** Science of the problem ("physics", "astronomy", …; see SCIENCE_LABELS). */
  subject?: string | null;
  /** Competition code ("NOF", "NAO", …; see COMPETITION_META). */
  competition?: string | null;
};

/** Where a problem was set: the subject and competition of its paper. */
export type ProblemPaperInfo = { subject: string; competition: string };

/**
 * Modules whose problems are made-up illustrations rather than real problems:
 * the "Using modules" guide shows what a problem list looks like. A problem
 * that appears only in these modules is left out of the index.
 */
const EXAMPLE_MODULE_IDS = new Set(['using-modules']);

/** Shape of one `allProblemInfo` node as queried in gatsby-node's createPages. */
type ProblemNode = {
  uniqueId: string;
  name: string;
  url: string;
  source: string;
  difficulty: string;
  assessmentLabel?: string | null;
  fields?: string[] | null;
  conceptIds?: string[] | null;
  classificationTerms?: string[] | null;
  isStarred?: boolean | null;
  tags?: string[] | null;
  solution?: ProblemsIndexSolution;
  module?: { frontmatter?: { id: string; title: string } | null } | null;
};

/**
 * Adds the subject and competition of the problem's paper. A problem without
 * a paper file (listed only in modules) gets its subject from an
 * /archive/<subject>/ link and its competition from the first word of the
 * source when that is a known competition code.
 */
function withPaperInfo(
  entry: ProblemsIndexEntry,
  paperInfo: Map<string, ProblemPaperInfo>,
  subjectByCompetition: Map<string, string>
): ProblemsIndexEntry {
  const paper = paperInfo.get(entry.uniqueId);
  const code = (entry.source ?? '').split(' ')[0];
  const competition =
    paper?.competition ??
    (COMPETITION_META[code] || subjectByCompetition.has(code) ? code : null);
  const fromURL = /\/archive\/([a-z]+)\//.exec(entry.url ?? '')?.[1];
  const subject =
    paper?.subject ??
    (fromURL && SCIENCE_LABELS[fromURL] ? fromURL : null) ??
    (competition ? subjectByCompetition.get(competition) ?? null : null);
  return { ...entry, subject, competition };
}

/**
 * Collapses the `allProblemInfo` nodes into one row per unique problem: a
 * problem that appears in several modules has one node per module, so tags and
 * modules get unioned together (same merge the Algolia transformer did).
 * `paperInfo` (problem id → its paper's subject and competition, see
 * readProblemPapers) fills in `subject` and `competition`.
 */
export function buildProblemsIndex(
  nodes: ProblemNode[],
  paperInfo: Map<string, ProblemPaperInfo> = new Map()
): ProblemsIndexEntry[] {
  const byId = new Map<string, ProblemsIndexEntry>();
  for (const node of nodes) {
    if (!node || !node.uniqueId) continue;
    const moduleInfo =
      node.module && node.module.frontmatter
        ? {
            id: node.module.frontmatter.id,
            title: node.module.frontmatter.title,
          }
        : null;
    const existing = byId.get(node.uniqueId);
    if (existing) {
      existing.tags = [...new Set([...existing.tags, ...(node.tags ?? [])])];
      if (node.assessmentLabel) {
        existing.assessmentLabel = node.assessmentLabel;
        existing.fields = node.fields;
        existing.conceptIds = node.conceptIds;
        existing.classificationTerms = node.classificationTerms;
      }
      existing.isStarred = existing.isStarred || !!node.isStarred;
      if (
        moduleInfo &&
        !existing.problemModules.some(m => m.id === moduleInfo.id)
      ) {
        existing.problemModules.push(moduleInfo);
      }
      continue;
    }
    byId.set(node.uniqueId, {
      uniqueId: node.uniqueId,
      name: node.name,
      url: node.url,
      source: node.source,
      difficulty: node.difficulty,
      ...(node.assessmentLabel
        ? {
            assessmentLabel: node.assessmentLabel,
            fields: node.fields,
            conceptIds: node.conceptIds,
            classificationTerms: node.classificationTerms,
          }
        : {}),
      isStarred: !!node.isStarred,
      tags: [...new Set(node.tags ?? [])],
      problemModules: moduleInfo ? [moduleInfo] : [],
      solution: node.solution ?? null,
      problemURL: getProblemURL(node),
    });
  }

  const subjectByCompetition = new Map<string, string>();
  for (const { subject, competition } of paperInfo.values()) {
    if (!subjectByCompetition.has(competition)) {
      subjectByCompetition.set(competition, subject);
    }
  }
  const entries = [...byId.values()]
    .filter(
      entry =>
        !(
          entry.problemModules.length > 0 &&
          entry.problemModules.every(m => EXAMPLE_MODULE_IDS.has(m.id))
        )
    )
    .map(entry => withPaperInfo(entry, paperInfo, subjectByCompetition));
  for (const entry of entries) {
    // Same fallback the old Algolia hit renderer applied at display time.
    if (
      entry.problemModules.length === 0 &&
      recentUsaco.includes(entry.source)
    ) {
      entry.problemModules.push({
        id: 'usaco-monthlies',
        title: 'USACO Monthlies',
      });
    }
    entry.tags.sort();
    entry.problemModules.sort((a, b) => a.id.localeCompare(b.id));
  }
  // Stable order so the written file doesn't churn between builds.
  entries.sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));
  return entries;
}

/** Writes static/problems-data/index.json. Returns the number of problems. */
export function writeProblemsIndex(
  repoRoot: string,
  nodes: ProblemNode[]
): number {
  const entries = buildProblemsIndex(nodes, readProblemPapers(repoRoot));
  const dir = path.join(repoRoot, 'static', 'problems-data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(entries));
  return entries.length;
}

// ---------------------------------------------------------------------------
// Problems tree (sidebar of problem pages) — see src/problems/tree.ts.

/** Calls `onPaper` for each content/problems/**\/*.json (skipping schema.json), sorted by path. */
function forEachPaperFile(
  repoRoot: string,
  onPaper: (paper: PaperFile) => void
): void {
  const root = path.join(repoRoot, 'content', 'problems');
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json') && name !== 'schema.json') {
        files.push(full);
      }
    }
  };
  walk(root);
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.warn(`[problems] skipping unreadable ${file}: ${e}`);
      continue;
    }
    if (data && data.paper && Array.isArray(data.problems)) {
      onPaper(data as PaperFile);
    }
  }
}

/** Reads content/problems/**\/*.json (skipping schema.json), sorted by path. */
export function readPaperFiles(repoRoot: string): PaperFile[] {
  const papers: PaperFile[] = [];
  forEachPaperFile(repoRoot, paper => papers.push(paper));
  return papers;
}

/**
 * Problem id → subject and competition of its paper. Keeps only those two
 * fields, so the (large) paper files are not all held in memory at once.
 */
export function readProblemPapers(
  repoRoot: string
): Map<string, ProblemPaperInfo> {
  const info = new Map<string, ProblemPaperInfo>();
  forEachPaperFile(repoRoot, ({ paper, problems }) => {
    const value = { subject: paper.subject, competition: paper.competition };
    for (const problem of problems) {
      if (problem && problem.id && !info.has(problem.id)) {
        info.set(problem.id, value);
      }
    }
  });
  return info;
}

/**
 * The navigation overlays (presentation layer; the paper files are hash-bound
 * to their receipts): content/round-labels.json gives every round its
 * canonical label, content/question-numbers.json the printed question number
 * where the stored one differs. A missing or unreadable file only means raw
 * labels and stored numbers (scripts/check-navigation.mjs gates the content).
 */
export function readNavigationOverlays(repoRoot: string): NavigationOverlays {
  const read = (relative: string) => {
    const file = path.join(repoRoot, relative);
    try {
      return fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : null;
    } catch (e) {
      console.warn(`[problems] skipping unreadable ${file}: ${e}`);
      return null;
    }
  };
  return {
    labels: read(path.join('content', 'round-labels.json')),
    numbers: read(path.join('content', 'question-numbers.json')),
  };
}

/**
 * Builds the tree from the paper files, joining each problem to its
 * ProblemInfo node (by uniqueId) for the solution page URL. Problems without a
 * node are skipped with a warning.
 */
export function buildProblemsTree(
  nodes: ProblemNode[],
  repoRoot: string
): ProblemsTreeData {
  const urlById = new Map<string, string>();
  for (const node of nodes) {
    if (!node || !node.uniqueId || urlById.has(node.uniqueId)) continue;
    urlById.set(node.uniqueId, getProblemURL(node) + '/solution');
  }
  return assembleProblemsTree(
    readPaperFiles(repoRoot),
    urlById,
    (pid, paper) =>
      console.warn(
        `[problems] tree: ${pid} (paper ${paper}) has no ProblemInfo node, skipped`
      ),
    readNavigationOverlays(repoRoot)
  );
}

/** Writes static/problems-data/tree.json. Returns the tree. */
export function writeProblemsTree(
  repoRoot: string,
  nodes: ProblemNode[]
): ProblemsTreeData {
  const tree = buildProblemsTree(nodes, repoRoot);
  const dir = path.join(repoRoot, 'static', 'problems-data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tree.json'), JSON.stringify(tree));
  return tree;
}
