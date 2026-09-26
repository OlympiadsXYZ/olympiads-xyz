// How catalog entries read on the archive pages: the row title without what the
// page heading already says, the text the shelf search matches, and runs of
// page images folded into one row. Pure functions (no React), shared by
// ArchiveUI and the archive tests (scripts/tests/archive-display.test.mjs).
import type { ClientEntry } from './catalog-node';
import {
  COMPETITION_META,
  competitionName,
  competitionShort,
  groupLabel,
  roundLabel,
  TYPE_LABELS,
} from './labels';

const SEPARATOR = /^\s*[–—·:,-]\s*/;

// Tour words the older titles use for the round the section heading names.
const TOUR_WORDS: { [round: string]: RegExp } = {
  theory: /^(?:теория|теоретичен тур)$/i,
  experiment: /^(?:експеримент|експериментален тур)$/i,
  'data-analysis': /^анализ на данни$/i,
  observational: /^(?:наблюдения|наблюдателен тур)$/i,
  practical: /^(?:практически тур|практика)$/i,
  team: /^(?:отборен тур|отборно състезание)$/i,
  creative: /^творчески тур$/i,
};

// „I Общински кръг“, „III кръг (национален)“, „финален кръг“, „Регионален етап (III)“,
// „Зонален (окръжен) етап“
const STAGE_WORDS =
  /^(?:[IV]+\s+)?(?:[а-яё]+\s+(?:\([^)]*\)\s+)?)?(?:кръг|етап)(?:\s+\([^)]*\))?$/i;

/**
 * The row title on a page that already names the competition and the year
 * (the year page's heading) and, when `round` is given, the round (its section
 * heading): „Национална олимпиада по физика 2024 – II Областен кръг – 10. клас
 * (условия)“ → „10. клас (условия)“. Only a leading „<name> <year>“ with the
 * entry's own year is cut, and nothing is cut that would leave the title empty.
 */
export function shortTitle(
  e: Pick<ClientEntry, 'title' | 'year'>,
  opts: { round?: string | null } = {}
): string {
  let title = e.title;
  if (e.year != null) {
    const m =
      /^([^·–—:,]{1,80}?)\s(\d{4})(?:\/\d{2,4})?(?:\s\([^)]*\))?(\s*[–—·:,-]\s*)(.+)$/.exec(
        title
      );
    if (m && Number(m[2]) === e.year && m[4].trim()) title = m[4].trim();
  }
  if (opts.round) {
    const cut = /^(.+?)(\s[–—·]\s|,\s)(.+)$/.exec(title);
    if (cut) {
      const head = cut[1].trim();
      const tour = TOUR_WORDS[opts.round];
      if ((tour && tour.test(head)) || STAGE_WORDS.test(head)) {
        title = cut[3].trim();
      }
    }
  }
  title = title.replace(SEPARATOR, '');
  if (!title) return e.title;
  // „… – условия (10 клас)“ → „Условия (10 клас)“
  return title === e.title ? title : title[0].toUpperCase() + title.slice(1);
}

/** Everything the shelf search matches: what the row and the page show, and the folder path. */
export function searchText(
  e: ClientEntry & { comp?: string | null },
  competition?: string | null
): string {
  const comp = e.comp ?? competition ?? null;
  const parts: (string | number | null | undefined)[] = [
    e.title,
    e.year,
    e.round,
    roundLabel(e.round, comp),
    TYPE_LABELS[e.type],
    e.type,
    e.group,
    groupLabel(e.group),
    e.key.replace(/[/_]/g, ' '),
  ];
  if (comp) {
    parts.push(comp, competitionName(comp), competitionShort(comp));
    if (COMPETITION_META[comp]) parts.push(COMPETITION_META[comp].slug);
  }
  return parts
    .filter(p => p != null && p !== '')
    .join(' ')
    .normalize('NFC')
    .toLowerCase();
}

/** Every whitespace-separated word of the query occurs in the entry's search text. */
export function matchesQuery(
  e: ClientEntry & { comp?: string | null },
  query: string,
  competition?: string | null
): boolean {
  const words = query
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(e, competition);
  return words.every(w => hay.includes(w));
}

export type FolderNode = {
  /** Shown name: the folder label, or „A › B“ for a folder whose only content is B. */
  name: string;
  entries: ClientEntry[];
  children: FolderNode[];
  /** Entries in this folder and below. */
  total: number;
};

/**
 * The library as nested folders, without the science's own top folder and the
 * „Книги“ folder every physics/astronomy book sits in. A folder that holds
 * only one subfolder is merged with it („Учебници › По програмата“).
 */
export function folderTree(
  entries: ClientEntry[],
  labelOf: (segment: string) => string = s => s
): FolderNode[] {
  const root: FolderNode = { name: '', entries: [], children: [], total: 0 };
  const child = (node: FolderNode, seg: string) => {
    let c = node.children.find(n => n.name === seg);
    if (!c) {
      c = { name: seg, entries: [], children: [], total: 0 };
      node.children.push(c);
    }
    return c;
  };
  for (const e of entries) {
    // NFC: the bucket spells „Английски“ with a decomposed „й“ in some keys
    const segs = (e.folder ?? '')
      .normalize('NFC')
      .split('/')
      .slice(1)
      .filter(Boolean);
    if (segs[0] === 'Книги') segs.shift();
    let node = root;
    for (const seg of segs) node = child(node, seg);
    node.entries.push(e);
  }
  const finish = (node: FolderNode): FolderNode => {
    node.children = node.children.map(finish);
    node.total =
      node.entries.length + node.children.reduce((a, c) => a + c.total, 0);
    node.name = labelOf(node.name);
    if (node.entries.length === 0 && node.children.length === 1 && node.name) {
      const only = node.children[0];
      return { ...only, name: `${node.name} › ${only.name}` };
    }
    node.children.sort((a, b) =>
      a.name.localeCompare(b.name, 'bg', { numeric: true })
    );
    return node;
  };
  const top = finish(root);
  // files straight in the science folder
  if (top.entries.length) {
    top.children.push({
      name: 'Други файлове',
      entries: top.entries,
      children: [],
      total: top.entries.length,
    });
  }
  return top.children;
}

export type RowItem =
  | { kind: 'entry'; entry: ClientEntry }
  | { kind: 'images'; title: string; entries: ClientEntry[] };

// „… · Решения · C5 1“, „… · част 2“, „… (решения)“ ×3: the title without the part name.
function imageStem(title: string): string {
  return title.replace(
    /\s*[·–-]\s*(?:част\s*)?[A-Za-zА-Яа-я]{0,2}\d{1,3}(?:\s\d{1,2})?$/,
    ''
  );
}

/**
 * Folds runs of at least `min` page images of one document (same round, type,
 * group and language, same title up to the part name) into one item, so a
 * solution scanned page by page is one row, not seventy. `titleOf` is the
 * title the row shows.
 */
export function foldImageRuns(
  entries: ClientEntry[],
  titleOf: (e: ClientEntry) => string = e => e.title,
  min = 3
): RowItem[] {
  const out: RowItem[] = [];
  let run: ClientEntry[] = [];
  let runKey = '';
  const flush = () => {
    if (run.length >= min) {
      out.push({
        kind: 'images',
        title: imageStem(titleOf(run[0])),
        entries: run,
      });
    } else {
      run.forEach(entry => out.push({ kind: 'entry', entry }));
    }
    run = [];
    runKey = '';
  };
  for (const e of entries) {
    const key =
      e.ext === 'img'
        ? [e.round, e.type, e.group, e.lang, imageStem(titleOf(e))].join(
            '\u0000'
          )
        : '';
    if (key && key === runKey) {
      run.push(e);
      continue;
    }
    flush();
    if (key) {
      run = [e];
      runKey = key;
    } else {
      out.push({ kind: 'entry', entry: e });
    }
  }
  flush();
  return out;
}
