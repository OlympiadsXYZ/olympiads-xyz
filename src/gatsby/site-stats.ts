// Build-time counts for the home page, the announcement bar and the 404 page
// (gatsby-node sourceNodes creates one SiteStats node from them; the UI reads
// it through src/hooks/useSiteStats.ts). Counted from the files the build
// publishes, never hard-coded:
//   - problems: content/extraProblems.json, the generator's list of published
//     olympiad problems (scripts/problems-to-site.mjs),
//   - official solutions and papers: the paper files in content/problems whose
//     problems are published; a problem has an official solution when its
//     solution has text or sections (what the problem page shows under
//     "Покажи официалното решение"),
//   - archive: the archive catalog (hidden entries excluded, as on the site);
//     competition files are the entries shelved under a competition.
import fs from 'fs';
import path from 'path';
import { loadCatalog } from '../archive/catalog-node';
import type { SiteStatsCounts } from '../utils/siteStatsFormat';

export type SiteStats = SiteStatsCounts;

// the order the site names its subjects in (the Архив menu), others after
const SUBJECT_ORDER = [
  'physics',
  'astronomy',
  'mathematics',
  'informatics',
  'chemistry',
  'biology',
  'geography',
];
const subjectRank = (subject: string) => {
  const i = SUBJECT_ORDER.indexOf(subject);
  return i === -1 ? SUBJECT_ORDER.length : i;
};

type PaperFile = {
  paper?: { id?: string; subject?: string };
  problems?: {
    id?: string;
    solution?: {
      statement?: string | null;
      sections?: unknown[] | null;
    } | null;
  }[];
};

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    console.warn(`[site-stats] skipping unreadable ${file}: ${e}`);
    return null;
  }
}

function publishedProblemIds(repoRoot: string): Set<string> {
  const file = path.join(repoRoot, 'content', 'extraProblems.json');
  if (!fs.existsSync(file)) return new Set();
  const data = readJson<{ EXTRA_PROBLEMS?: { uniqueId?: string }[] }>(file);
  return new Set(
    (data?.EXTRA_PROBLEMS ?? [])
      .map(p => p?.uniqueId)
      .filter((id): id is string => !!id)
  );
}

function paperFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.json') && name !== 'schema.json') {
        files.push(full);
      }
    }
  };
  walk(path.join(repoRoot, 'content', 'problems'));
  return files;
}

export const hasOfficialSolution = (
  solution:
    | { statement?: string | null; sections?: unknown[] | null }
    | null
    | undefined
): boolean =>
  !!(
    solution &&
    ((typeof solution.statement === 'string' && solution.statement.trim()) ||
      (Array.isArray(solution.sections) && solution.sections.length > 0))
  );

export function computeSiteStats(repoRoot: string): SiteStats {
  const published = publishedProblemIds(repoRoot);
  let problemsWithSolution = 0;
  const counted = new Set<string>();
  const papers = new Set<string>();
  const bySubject = new Map<string, number>();
  for (const file of paperFiles(repoRoot)) {
    const data = readJson<PaperFile>(file);
    if (!data || !Array.isArray(data.problems)) continue;
    for (const problem of data.problems) {
      const id = problem?.id;
      if (!id || !published.has(id) || counted.has(id)) {
        continue;
      }
      counted.add(id);
      if (data.paper?.id) papers.add(data.paper.id);
      const subject = data.paper?.subject;
      if (subject) bySubject.set(subject, (bySubject.get(subject) ?? 0) + 1);
      if (hasOfficialSolution(problem.solution)) problemsWithSolution += 1;
    }
  }

  const catalog = loadCatalog(repoRoot);
  const competitionEntries = catalog.filter(
    e => e.competition && e.kind !== 'book' && e.kind !== 'handout'
  );
  const competitions = new Set(
    competitionEntries.map(e => `${e.subject}/${e.competition}`)
  );

  return {
    problems: published.size,
    problemsWithSolution,
    papers: papers.size,
    subjects: [...bySubject.keys()].sort(
      (a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b)
    ),
    archiveFiles: catalog.length,
    archiveCompetitionFiles: competitionEntries.length,
    archiveCompetitions: competitions.size,
  };
}
