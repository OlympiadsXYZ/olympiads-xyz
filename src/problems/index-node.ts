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
import { getProblemURL, recentUsaco } from '../models/problem';

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
  isStarred: boolean;
  tags: string[];
  problemModules: ProblemsIndexModule[];
  solution: ProblemsIndexSolution;
  /** The problem's page on this site, from getProblemURL(). */
  problemURL: string;
};

/** Shape of one `allProblemInfo` node as queried in gatsby-node's createPages. */
type ProblemNode = {
  uniqueId: string;
  name: string;
  url: string;
  source: string;
  difficulty: string;
  isStarred?: boolean | null;
  tags?: string[] | null;
  solution?: ProblemsIndexSolution;
  module?: { frontmatter?: { id: string; title: string } | null } | null;
};

/**
 * Collapses the `allProblemInfo` nodes into one row per unique problem: a
 * problem that appears in several modules has one node per module, so tags and
 * modules get unioned together (same merge the Algolia transformer did).
 */
export function buildProblemsIndex(nodes: ProblemNode[]): ProblemsIndexEntry[] {
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
      isStarred: !!node.isStarred,
      tags: [...new Set(node.tags ?? [])],
      problemModules: moduleInfo ? [moduleInfo] : [],
      solution: node.solution ?? null,
      problemURL: getProblemURL(node),
    });
  }

  const entries = [...byId.values()];
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
  const entries = buildProblemsIndex(nodes);
  const dir = path.join(repoRoot, 'static', 'problems-data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(entries));
  return entries.length;
}
