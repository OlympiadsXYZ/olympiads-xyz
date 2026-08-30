// Node-side catalog loading for the archive (used by gatsby-node only).
// The catalog JSON files in archive-catalog/ are the single source of truth;
// the site never touches the actual archive files.
import fs from 'fs';
import path from 'path';
import { competitionSlug, entryExt } from './labels';

export type CatalogEntry = {
  id: string;
  subject: string;
  kind: 'competition' | 'book' | 'handout' | 'other';
  competition: string | null;
  year: number | null;
  round: string | null;
  group: string | null;
  type: string;
  lang: string;
  title: string;
  file: string;
  size: number;
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
};

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
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let arr: CatalogEntry[];
    try {
      arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (err) {
      console.warn(`[archive] skipping malformed catalog file ${f}: ${err}`);
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
      all.push(e);
    }
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
    if (e.kind === 'competition' && e.competition) {
      if (!s.competitions[e.competition]) s.competitions[e.competition] = [];
      s.competitions[e.competition].push(toClientEntry(e));
    } else if (e.kind === 'book' || e.kind === 'handout') {
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
    .sort((a, b) => b.count - a.count);
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
