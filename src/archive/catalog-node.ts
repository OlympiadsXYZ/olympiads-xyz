// Node-side catalog loading for the archive (used by gatsby-node only).
// The catalog JSON files in archive-catalog/ are the single source of truth;
// the site never touches the actual archive files.
import fs from 'fs';
import path from 'path';
import { competitionShort, competitionSlug, entryExt } from './labels';

export type CatalogEntry = {
  id: string;
  subject: string;
  kind: 'competition' | 'book' | 'handout' | 'syllabus' | 'results' | 'misc';
  competition: string | null;
  year: number | null;
  round: string | null;
  group: string | null;
  type: string;
  lang: string;
  title: string;
  file: string;
  size: number;
  note?: string;
  // hidden: true = дубликат/плейсхолдър/боклук — не се рисува и не се брои;
  // duplicateOf сочи каноничния запис (D1/D4, docs/Archive-Decisions-2026-09.md).
  hidden?: boolean;
  duplicateOf?: string;
  unparsed?: boolean;
};

export type ClientEntry = {
  id: string;
  title: string;
  year: number | null;
  round: string | null;
  group: string | null;
  type: string;
  lang: string;
  size: number;
  key: string; // path inside the hosted bucket == catalog `file`
  ext: string;
  folder?: string; // library entries only: folder path for tree grouping
  // the transcribed problems of this document on the site (year and
  // competition pages only; see archiveProblemLinks)
  onSite?: ProblemLink;
};

export type ProblemLink = {
  /** The solution page of the document's first published problem. */
  url: string;
  /** How many of its problems are published. */
  count: number;
};

// Реда на предметите в архива: най-пълните рафтове първи; математиката и
// информатиката са само библиотеки.
export const SCIENCE_ORDER = [
  'physics',
  'astronomy',
  'chemistry',
  'geography',
  'mathematics',
  'informatics',
];

export function sortSciences(sciences: string[]): string[] {
  const rank = (s: string) => {
    const i = SCIENCE_ORDER.indexOf(s);
    return i === -1 ? SCIENCE_ORDER.length : i;
  };
  return [...sciences].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export type ScienceCard = {
  science: string;
  count: number;
  bytes: number;
  competitions: number;
  yearMin: number | null;
  yearMax: number | null;
  /** Short names of the competitions with the most material. */
  top: string[];
};

/** What a science's card on /archive/ says about it. */
export function scienceCard(s: ScienceData): ScienceCard {
  const summaries = competitionSummaries(s);
  const all = [
    ...Object.values(s.competitions).flat(),
    ...s.library,
    ...s.uncategorized,
  ];
  const mins = summaries.map(c => c.yearMin).filter((y): y is number => y != null);
  const maxs = summaries.map(c => c.yearMax).filter((y): y is number => y != null);
  return {
    science: s.science,
    count: all.length,
    bytes: all.reduce((a, b) => a + b.size, 0),
    competitions: summaries.length,
    yearMin: mins.length ? Math.min(...mins) : null,
    yearMax: maxs.length ? Math.max(...maxs) : null,
    top: summaries.slice(0, 4).map(c => competitionShort(c.code)),
  };
}

export type CompetitionSummary = {
  code: string;
  slug: string;
  count: number;
  bytes: number;
  yearMin: number | null;
  yearMax: number | null;
};

export type ScienceData = {
  science: string;
  competitions: { [code: string]: ClientEntry[] };
  library: ClientEntry[];
  uncategorized: ClientEntry[];
};

export function toClientEntry(e: CatalogEntry, withFolder = false): ClientEntry {
  const c: ClientEntry = {
    id: e.id,
    title: e.title || e.file,
    year: e.year ?? null,
    round: e.round || null,
    group: e.group || null,
    type: e.type || 'other',
    lang: e.lang || 'bg',
    size: e.size || 0,
    key: e.file,
    ext: entryExt(e.file),
  };
  if (withFolder) {
    c.folder = e.file.split('/').slice(0, -1).join('/');
  }
  return c;
}

export function loadCatalog(repoRoot: string): CatalogEntry[] {
  const dir = path.join(repoRoot, 'archive-catalog');
  if (!fs.existsSync(dir)) return [];
  const seen = new Set<string>();
  const all: CatalogEntry[] = [];
  let hidden = 0;
  for (const f of fs.readdirSync(dir)) {
    // schema.json describes the catalog, it is not part of it
    if (!f.endsWith('.json') || f === 'schema.json') continue;
    let arr: CatalogEntry[];
    try {
      arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (err) {
      console.warn(`[archive] skipping malformed catalog file ${f}: ${err}`);
      continue;
    }
    // a non-array here used to throw and kill onPreBootstrap, taking the whole
    // build down; any future non-catalog JSON dropped in this folder is skipped
    if (!Array.isArray(arr)) {
      console.warn(`[archive] skipping ${f}: expected an array of entries`);
      continue;
    }
    for (const e of arr) {
      if (!e || !e.id || !e.subject || !e.file) {
        console.warn(`[archive] skipping malformed entry in ${f}`);
        continue;
      }
      if (seen.has(e.id)) {
        console.warn(`[archive] duplicate id ${e.id} in ${f}, keeping first`);
        continue;
      }
      seen.add(e.id);
      // hidden entries (byte-identical duplicates, placeholders, junk) stay in
      // the catalog for reversibility but never render or count on the site
      if (e.hidden === true) {
        hidden += 1;
        continue;
      }
      all.push(e);
    }
  }
  if (hidden > 0) {
    console.log(`[archive] skipped ${hidden} hidden catalog entries (duplicates/placeholders)`);
  }
  return all;
}

export function groupCatalog(entries: CatalogEntry[]): { [science: string]: ScienceData } {
  const out: { [science: string]: ScienceData } = {};
  for (const e of entries) {
    if (!out[e.subject]) {
      out[e.subject] = { science: e.subject, competitions: {}, library: [], uncategorized: [] };
    }
    const s = out[e.subject];
    const shelf = e.kind === 'book' || e.kind === 'handout';
    // Принадлежността към състезание е `competition !== null`, не `kind`
    // (Archive-Schema.md §3.2): протоколите (`results`), регламентите
    // (`syllabus`) и програмите/данните (`misc`) на състезанието стоят на
    // неговите страници, не в „Други материали“. Сборниците със задачи на едно
    // състезание (IPhO 1967–1999, ВсОШ, Московска) също — под „Без година“ на
    // състезанието, не в библиотеката; книгите без състезание остават на рафта.
    if (e.competition) {
      if (!s.competitions[e.competition]) s.competitions[e.competition] = [];
      s.competitions[e.competition].push(toClientEntry(e));
    } else if (shelf) {
      s.library.push(toClientEntry(e, true));
    } else {
      s.uncategorized.push(toClientEntry(e, true));
    }
  }
  return out;
}

export function competitionSummaries(s: ScienceData): CompetitionSummary[] {
  return Object.keys(s.competitions)
    .map(code => {
      const entries = s.competitions[code];
      const years = entries.map(e => e.year).filter((y): y is number => y != null);
      return {
        code,
        slug: competitionSlug(code),
        count: entries.length,
        bytes: entries.reduce((a, b) => a + b.size, 0),
        yearMin: years.length ? Math.min(...years) : null,
        yearMax: years.length ? Math.max(...years) : null,
      };
    })
    // състезанията без нито една година (един сборен файл) — накрая
    .sort(
      (a, b) =>
        Number(a.yearMin == null) - Number(b.yearMin == null) ||
        b.count - a.count
    );
}

/**
 * Archive key → the transcribed problems of that document on the site. A paper
 * counts when at least one of its problems has a page (`urlById`: problem id →
 * its page, only published problems have one); its problem and solution files
 * both link there. Keys are compared in NFC (the bucket mixes NFC and NFD).
 */
export function archiveProblemLinks(
  papers: {
    paper: {
      source?: { archiveKey?: string } | null;
      solutionSource?: { archiveKey?: string } | null;
    };
    problems: { id: string }[];
  }[],
  urlById: Map<string, string>
): Map<string, ProblemLink> {
  const out = new Map<string, ProblemLink>();
  for (const { paper, problems } of papers) {
    const urls = problems.map(p => urlById.get(p.id)).filter((u): u is string => !!u);
    if (!urls.length) continue;
    const keys = [paper.source?.archiveKey, paper.solutionSource?.archiveKey];
    for (const key of new Set(keys.filter((k): k is string => !!k).map(k => k.normalize('NFC')))) {
      const prev = out.get(key);
      out.set(key, prev ? { url: prev.url, count: prev.count + urls.length } : { url: urls[0], count: urls.length });
    }
  }
  return out;
}

/** Sets `onSite` on the entries whose document has problems on the site; returns how many. */
export function attachProblemLinks(
  entries: ClientEntry[],
  links: Map<string, ProblemLink>
): number {
  let n = 0;
  for (const e of entries) {
    const link = links.get(e.key.normalize('NFC'));
    if (link) {
      e.onSite = link;
      n += 1;
    }
  }
  return n;
}

export function writeSearchIndexes(
  repoRoot: string,
  grouped: { [science: string]: ScienceData }
): void {
  const dir = path.join(repoRoot, 'static', 'archive-data');
  fs.mkdirSync(dir, { recursive: true });
  for (const science of Object.keys(grouped)) {
    const s = grouped[science];
    const rows: (ClientEntry & { comp: string | null })[] = [];
    Object.keys(s.competitions).forEach(code => {
      s.competitions[code].forEach(e => rows.push({ ...e, comp: code }));
    });
    s.library.forEach(e => rows.push({ ...e, comp: null }));
    s.uncategorized.forEach(e => rows.push({ ...e, comp: null }));
    fs.writeFileSync(path.join(dir, `${science}.json`), JSON.stringify(rows));
  }
}
