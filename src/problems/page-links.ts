// Links a problem page carries besides its own content, computed at build time
// (gatsby-node passes them to solutionTemplate in the page context):
//   - the previous and next problem, in the sidebar tree's reading order;
//   - the archive page of the paper's competition and year, when there is one.
// Shared-safe like tree.ts: no node-only imports (the file reading lives in
// index-node.ts and gatsby-node).
import {
  canonicalCompetition,
  competitionShort,
  competitionSlug,
} from '../archive/labels';
import { problemLabel, ProblemsTreeData } from './tree';

export type ProblemNeighbour = {
  /** The neighbour's solution page. */
  url: string;
  /** "Задача 4. Планети" */
  label: string;
  /** The neighbour's paper node label, when it is not the current problem's paper. */
  paper: string | null;
};

export type ProblemNeighbours = {
  prev: ProblemNeighbour | null;
  next: ProblemNeighbour | null;
};

/**
 * Previous and next problem of every problem in the tree: the problems of a
 * competition's year in sidebar order, paper after paper (Задача 5 of the
 * 9–10 клас paper is followed by Задача 1 of the 11–12 клас paper). The first
 * and last problem of a year have no neighbour on that side.
 */
export function problemNeighbours(
  tree: ProblemsTreeData
): Map<string, ProblemNeighbours> {
  const out = new Map<string, ProblemNeighbours>();
  for (const subject of tree.subjects) {
    for (const competition of subject.competitions) {
      for (const year of competition.years) {
        const rows = year.papers.flatMap(paper =>
          paper.problems.map(problem => ({ problem, paper }))
        );
        rows.forEach(({ problem, paper }, i) => {
          if (out.has(problem.id)) return;
          const link = (j: number): ProblemNeighbour | null => {
            const row = rows[j];
            if (!row || row.problem.id === problem.id) return null;
            return {
              url: row.problem.url,
              label: problemLabel(row.problem),
              paper: row.paper.id === paper.id ? null : row.paper.label,
            };
          };
          out.set(problem.id, { prev: link(i - 1), next: link(i + 1) });
        });
      }
    }
  }
  return out;
}

export type ArchiveYearLink = {
  /** "/archive/physics/nof/2019/" */
  path: string;
  /** "НОФ 2019" */
  label: string;
};

/** The parts of an archive catalog entry (archive-catalog/*.json) the year pages are made from. */
export type ArchiveCatalogRow = {
  subject: string;
  kind: string;
  competition: string | null;
  year: number | null;
  file: string;
};

export type ArchiveYearPages = {
  /** catalog file (the paper's source.archiveKey) → its year page */
  byFile: Map<string, ArchiveYearLink>;
  /** "physics|NOF|2019" → the year page */
  byYear: Map<string, ArchiveYearLink>;
};

const yearKey = (subject: string, competition: string, year: number) =>
  `${subject}|${canonicalCompetition(competition)}|${year}`;

/**
 * The archive year pages, as gatsby-node creates them from the catalog
 * (groupCatalog): an entry with a competition, that is not a book or a
 * handout, and has a year, is listed on /archive/<science>/<slug>/<year>/.
 */
export function archiveYearPages(rows: ArchiveCatalogRow[]): ArchiveYearPages {
  const byFile = new Map<string, ArchiveYearLink>();
  const byYear = new Map<string, ArchiveYearLink>();
  for (const e of rows) {
    if (!e || !e.competition || e.year == null) continue;
    if (e.kind === 'book' || e.kind === 'handout') continue;
    const link = {
      path: `/archive/${e.subject}/${competitionSlug(e.competition)}/${
        e.year
      }/`,
      label: `${competitionShort(canonicalCompetition(e.competition))} ${
        e.year
      }`,
    };
    byFile.set(e.file, link);
    const key = yearKey(e.subject, e.competition, e.year);
    if (!byYear.has(key)) byYear.set(key, link);
  }
  return { byFile, byYear };
}

/**
 * The archive year page of a paper: the page that lists the paper's own
 * problems file, else the page of its competition and year, else null (no
 * such page is built).
 */
export function archiveYearLink(
  paper: {
    subject: string;
    competition: string;
    year: number;
    archiveKey?: string | null;
  },
  pages: ArchiveYearPages
): ArchiveYearLink | null {
  if (paper.archiveKey) {
    const own = pages.byFile.get(paper.archiveKey);
    if (own) return own;
  }
  return (
    pages.byYear.get(yearKey(paper.subject, paper.competition, paper.year)) ??
    null
  );
}

/** A paper language worth a lang attribute: a two- or three-letter code other than Bulgarian. */
export function foreignLang(lang: string | null | undefined): string | null {
  const code = String(lang ?? '')
    .trim()
    .toLowerCase();
  return /^[a-z]{2,3}$/.test(code) && code !== 'bg' ? code : null;
}
