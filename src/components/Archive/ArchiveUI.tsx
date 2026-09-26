// Shared client-side UI for the catalog-driven archive.
import { Link } from 'gatsby';
import * as React from 'react';
import {
  EXT_ICONS,
  EXT_LABELS,
  entryUrl,
  filesCount,
  folderLabel,
  groupLabel,
  label,
  LANG_LABELS,
  plural,
  ROUND_ORDER,
  roundLabel,
  TYPE_LABELS,
  TYPE_ORDER,
} from '../../archive/labels';
import type { ClientEntry } from '../../archive/catalog-node';
import {
  FolderNode,
  folderTree,
  foldImageRuns,
  matchesQuery,
  shortTitle,
} from '../../archive/display';

export function Crumbs({
  parts,
}: {
  parts: { name: string; href?: string }[];
}): JSX.Element {
  return (
    <nav className="text-sm text-gray-600 dark:text-gray-400 mb-4 flex flex-wrap gap-1 items-center">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="mx-1">›</span>}
          {p.href ? (
            <Link to={p.href} className="hover:underline">
              {p.name}
            </Link>
          ) : (
            <span className="text-gray-700 dark:text-gray-200">{p.name}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function Badge({
  children,
  color = 'gray',
}: {
  children: React.ReactNode;
  color?: string;
}): JSX.Element {
  const colors: { [k: string]: string } = {
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
        colors[color] ?? colors.gray
      }`}
    >
      {children}
    </span>
  );
}

const TYPE_COLORS: { [t: string]: string } = {
  problems: 'blue',
  solutions: 'green',
  answers: 'green',
  results: 'amber',
};

/** The empty result of a search or a filter, with a way back. */
export function NoResults({
  onReset,
  resetLabel = 'Изчисти търсенето',
}: {
  onReset: () => void;
  resetLabel?: string;
}): JSX.Element {
  return (
    <p className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">
      Нищо не е намерено.{' '}
      <button
        className="text-blue-600 dark:text-blue-400 hover:underline"
        onClick={onReset}
      >
        {resetLabel}
      </button>
    </p>
  );
}

// Keeps both ends of a long file name: the distinguishing part is often the
// tail („…-0001.jpg“, „…_corrected.pdf“).
function shortName(name: string): string {
  return name.length > 40 ? `${name.slice(0, 16)}…${name.slice(-22)}` : name;
}

// Rows in one list with the same title and badges get their file name as a
// distinguishing detail — e.g. three „Теоретични задачи – решения“ become
// T1_sol.pdf / T2_sol.pdf / T3_sol_corrected.pdf. The file icon is not enough
// (a lone XLS among PDFs still says nothing about its content). Parent
// folders are added while the names still clash. `titleOf` is the title the
// row shows.
export function rowDetails(
  entries: ClientEntry[],
  withRound = false,
  titleOf: (e: ClientEntry) => string = e => e.title
): { [id: string]: string } {
  const byLook: { [k: string]: ClientEntry[] } = {};
  entries.forEach(e => {
    const k = [titleOf(e), e.type, e.group, e.lang, withRound ? e.round : '']
      .map(v => v ?? '')
      .join('\u0000');
    if (!byLook[k]) byLook[k] = [];
    byLook[k].push(e);
  });
  const out: { [id: string]: string } = {};
  Object.values(byLook).forEach(same => {
    if (same.length < 2) return;
    const name = (e: ClientEntry, depth: number) => e.key.split('/').slice(-depth).join('/');
    let depth = 1;
    while (depth < 4 && new Set(same.map(e => name(e, depth))).size < same.length) depth++;
    const full = same.map(e => name(e, depth));
    const short = full.map(shortName);
    const shown = new Set(short).size === new Set(full).size ? short : full;
    same.forEach((e, i) => {
      out[e.id] = shown[i];
    });
  });
  return out;
}

function ExtTag({ ext }: { ext: string }): JSX.Element {
  return (
    <span
      className="flex-none w-8 sm:w-11 text-[10px] font-bold text-gray-500 dark:text-gray-400 tracking-wide"
      title={EXT_LABELS[ext] ?? EXT_LABELS.other}
    >
      {EXT_ICONS[ext] ?? EXT_ICONS.other}
    </span>
  );
}

function RowBadges({
  entry,
  competition,
  showRound,
  withLink = true,
}: {
  entry: ClientEntry;
  competition?: string | null;
  showRound: boolean;
  withLink?: boolean;
}): JSX.Element {
  return (
    // on a phone the badges go under the title, which keeps the full width
    <span className="flex flex-wrap items-center gap-1.5 basis-full sm:basis-auto sm:flex-none pl-11 sm:pl-0">
      {showRound && entry.round && (
        <Badge>{roundLabel(entry.round, competition)}</Badge>
      )}
      <Badge color={TYPE_COLORS[entry.type]}>
        {label(TYPE_LABELS, entry.type)}
      </Badge>
      {entry.group && <Badge>{groupLabel(entry.group)}</Badge>}
      {entry.lang && entry.lang !== 'bg' && (
        <Badge>{label(LANG_LABELS, entry.lang)}</Badge>
      )}
      {withLink && entry.onSite && (
        <Link
          to={entry.onSite.url}
          // above the row's stretched file link
          className="relative z-10 inline-block px-1.5 py-0.5 rounded text-xs font-semibold whitespace-nowrap bg-teal-100 text-teal-800 hover:bg-teal-200 dark:bg-teal-900 dark:text-teal-100 dark:hover:bg-teal-800"
          title="Транскрибираните задачи от този файл, с решения и отговори на сайта"
        >
          {plural(entry.onSite.count, 'задача', 'задачи')} на сайта →
        </Link>
      )}
    </span>
  );
}

const ROW =
  'relative flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-md text-sm text-gray-800 dark:text-gray-100';

export function EntryRow({
  entry,
  title = entry.title,
  detail,
  showRound = false,
  competition,
}: {
  entry: ClientEntry;
  /** The title the row shows (the page may cut what its heading says). */
  title?: string;
  detail?: string;
  showRound?: boolean;
  competition?: string | null;
}): JSX.Element {
  const url = entryUrl(entry.key);
  const text = (
    <>
      {title}
      {detail && (
        <span
          className="ml-2 font-mono text-xs text-gray-500 dark:text-gray-400 break-all"
          title={entry.key.split('/').pop()}
        >
          {detail}
        </span>
      )}
    </>
  );
  if (!url) {
    return (
      <div className={`${ROW} opacity-60`}>
        <ExtTag ext={entry.ext} />
        <span className="flex-1 min-w-0 break-words">{text}</span>
        <RowBadges entry={entry} competition={competition} showRound={showRound} />
        <Badge color="amber">скоро</Badge>
      </div>
    );
  }
  return (
    <div className={`${ROW} hover:bg-gray-100 dark:hover:bg-gray-800`}>
      <ExtTag ext={entry.ext} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        // the whole row opens the file; the „на сайта“ link sits above it
        className="flex-1 min-w-0 break-words after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:underline"
      >
        {text}
      </a>
      <RowBadges entry={entry} competition={competition} showRound={showRound} />
    </div>
  );
}

// A document scanned page by page: one row that opens into its images.
function ImageRunRow({
  title,
  entries,
  showRound,
  competition,
}: {
  title: string;
  entries: ClientEntry[];
  showRound: boolean;
  competition?: string | null;
}): JSX.Element {
  const first = entries[0];
  const details = rowDetails(entries);
  return (
    <details className="group">
      <summary
        className={`${ROW} cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-gray-100 dark:hover:bg-gray-800`}
      >
        <ExtTag ext="img" />
        <span className="flex-1 min-w-0 break-words">
          {title}
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {plural(entries.length, 'изображение', 'изображения')}{' '}
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
          </span>
        </span>
        <RowBadges
          entry={first}
          competition={competition}
          showRound={showRound}
          withLink={false}
        />
      </summary>
      <div className="pl-6 sm:pl-11 divide-y divide-gray-100 dark:divide-gray-800">
        {entries.map((e, i) => {
          const part = e.title.slice(title.length).replace(/^\s*[·–-]\s*/, '').trim();
          return (
            <EntryRow
              key={e.id}
              entry={e}
              title={part || `Изображение ${i + 1}`}
              detail={part ? undefined : details[e.id] ?? e.key.split('/').pop()}
              competition={competition}
            />
          );
        })}
      </div>
    </details>
  );
}

function roundSortKey(round: string | null): number {
  if (!round) return ROUND_ORDER.length + 1;
  const i = ROUND_ORDER.indexOf(round);
  return i === -1 ? ROUND_ORDER.length : i;
}

function typeSortKey(type: string): number {
  const i = TYPE_ORDER.indexOf(type);
  return i === -1 ? TYPE_ORDER.length : i;
}

export function sortEntries(entries: ClientEntry[]): ClientEntry[] {
  return [...entries].sort(
    (a, b) =>
      roundSortKey(a.round) - roundSortKey(b.round) ||
      typeSortKey(a.type) - typeSortKey(b.type) ||
      // numeric: grades 7, 8, 9, 10 … (text order put 10, 11, 12 before 7), "стр. 1" before "стр. 2"
      (a.group ?? '').localeCompare(b.group ?? '', 'bg', { numeric: true }) ||
      (a.lang === 'bg' ? 0 : 1) - (b.lang === 'bg' ? 0 : 1) ||
      // the document before its page images
      Number(a.ext === 'img') - Number(b.ext === 'img') ||
      a.title.localeCompare(b.title, 'bg', { numeric: true })
  );
}

// Rows of one visible list, already sorted; rows that would look identical
// get their file name (rowDetails); runs of page images fold into one row.
// `cutTitles` (year pages): the titles lose the competition and year of the
// heading, and the round of the section (`round`).
function EntryRows({
  entries,
  showRound = false,
  competition,
  cutTitles = false,
  round,
}: {
  entries: ClientEntry[];
  showRound?: boolean;
  competition?: string | null;
  cutTitles?: boolean;
  round?: string | null;
}): JSX.Element {
  const titles = React.useMemo(() => {
    const t: { [id: string]: string } = {};
    entries.forEach(e => {
      t[e.id] = cutTitles ? shortTitle(e, { round: showRound ? null : round }) : e.title;
    });
    return t;
  }, [entries, cutTitles, showRound, round]);
  const titleOf = (e: ClientEntry) => titles[e.id];
  const details = rowDetails(entries, showRound, titleOf);
  return (
    <>
      {foldImageRuns(entries, titleOf).map(item =>
        item.kind === 'entry' ? (
          <EntryRow
            key={item.entry.id}
            entry={item.entry}
            title={titleOf(item.entry)}
            detail={details[item.entry.id]}
            showRound={showRound}
            competition={competition}
          />
        ) : (
          <ImageRunRow
            key={item.entries[0].id}
            title={item.title}
            entries={item.entries.map(e => ({ ...e, title: titleOf(e) }))}
            showRound={showRound}
            competition={competition}
          />
        )
      )}
    </>
  );
}

const NO_ROUND = '__none';
const RESULTS = '__results';

export function EntryList({
  entries,
  groupByRound = false,
  competition,
  cutTitles = false,
}: {
  entries: ClientEntry[];
  groupByRound?: boolean;
  /** The competition of the page; search results carry their own (`comp`). */
  competition?: string | null;
  cutTitles?: boolean;
}): JSX.Element {
  const sorted = sortEntries(entries);
  if (!groupByRound) {
    return (
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        <EntryRows entries={sorted} competition={competition} cutTitles={cutTitles} />
      </div>
    );
  }
  // Протоколите и класиранията са в отделна секция „Резултати“ накрая (с
  // кръга като значка на реда); всичко останало е по кръгове.
  const byRound: { [r: string]: ClientEntry[] } = {};
  sorted.forEach(e => {
    const r = e.type === 'results' ? RESULTS : e.round ?? NO_ROUND;
    if (!byRound[r]) byRound[r] = [];
    byRound[r].push(e);
  });
  const sectionKey = (r: string) =>
    r === RESULTS
      ? ROUND_ORDER.length + 2
      : roundSortKey(r === NO_ROUND ? null : r);
  const roundKeys = Object.keys(byRound).sort(
    (a, b) => sectionKey(a) - sectionKey(b)
  );
  return (
    <div className="space-y-6">
      {roundKeys.map(r => (
        <div key={r}>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 px-3">
            {r === RESULTS
              ? 'Резултати'
              : r === NO_ROUND
              ? 'Общи материали'
              : roundLabel(r, competition)}
          </h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <EntryRows
              entries={byRound[r]}
              showRound={r === RESULTS}
              competition={competition}
              cutTitles={cutTitles}
              round={r === RESULTS || r === NO_ROUND ? null : r}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export type Filters = {
  round: string[];
  group: string[];
  type: string[];
  lang: string[];
  q: string;
};

export const EMPTY_FILTERS: Filters = {
  round: [],
  group: [],
  type: [],
  lang: [],
  q: '',
};

export function applyFilters(
  entries: (ClientEntry & { comp?: string | null })[],
  f: Filters,
  competition?: string | null
): ClientEntry[] {
  return entries.filter(e => {
    if (f.round.length && !f.round.includes(e.round ?? '')) return false;
    if (f.group.length && !f.group.includes(e.group ?? '')) return false;
    if (f.type.length && !f.type.includes(e.type)) return false;
    if (f.lang.length && !f.lang.includes(e.lang)) return false;
    return matchesQuery(e, f.q, competition);
  });
}

function FacetChips({
  title,
  values,
  labelFor,
  selected,
  onToggle,
}: {
  title: string;
  values: string[];
  labelFor: (v: string) => string;
  selected: string[];
  onToggle: (v: string) => void;
}): JSX.Element | null {
  if (values.length < 2) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 w-14 flex-none">
        {title}
      </span>
      {values.map(v => (
        <button
          key={v}
          onClick={() => onToggle(v)}
          aria-pressed={selected.includes(v)}
          className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
            selected.includes(v)
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'
          }`}
        >
          {labelFor(v)}
        </button>
      ))}
    </div>
  );
}

// Facet values in the order the page lists them (rounds and types as the
// sections are ordered), not alphabetically.
const byOrder = (order: string[]) => (x: string, y: string) => {
  const rank = (v: string) => (order.indexOf(v) === -1 ? order.length : order.indexOf(v));
  return rank(x) - rank(y) || x.localeCompare(y, 'bg', { numeric: true });
};

export function FilterBar({
  entries,
  filters,
  setFilters,
  competition,
}: {
  entries: ClientEntry[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  competition?: string | null;
}): JSX.Element {
  const distinct = (
    get: (e: ClientEntry) => string | null,
    cmp: (x: string, y: string) => number = (x, y) =>
      x.localeCompare(y, 'bg', { numeric: true })
  ) => [...new Set(entries.map(get).filter((v): v is string => !!v))].sort(cmp);
  const toggle = (k: 'round' | 'group' | 'type' | 'lang') => (v: string) => {
    const cur = filters[k];
    setFilters({
      ...filters,
      [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v],
    });
  };
  const active =
    filters.round.length +
    filters.group.length +
    filters.type.length +
    filters.lang.length +
    (filters.q ? 1 : 0);
  return (
    <div className="space-y-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <input
        type="search"
        value={filters.q}
        onChange={e => setFilters({ ...filters, q: e.target.value })}
        placeholder="Търси по заглавие, година, клас…"
        aria-label="Търси в материалите на състезанието"
        className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-transparent text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="space-y-1.5 overflow-x-auto">
        <FacetChips
          title="Кръг"
          values={distinct(e => e.round, byOrder(ROUND_ORDER))}
          labelFor={v => roundLabel(v, competition) ?? v}
          selected={filters.round}
          onToggle={toggle('round')}
        />
        <FacetChips
          title="Група"
          values={distinct(e => e.group)}
          labelFor={v => groupLabel(v) ?? v}
          selected={filters.group}
          onToggle={toggle('group')}
        />
        <FacetChips
          title="Вид"
          values={distinct(e => e.type, byOrder(TYPE_ORDER))}
          labelFor={v => label(TYPE_LABELS, v) ?? v}
          selected={filters.type}
          onToggle={toggle('type')}
        />
        <FacetChips
          title="Език"
          values={distinct(e => e.lang, byOrder(Object.keys(LANG_LABELS)))}
          labelFor={v => label(LANG_LABELS, v) ?? v}
          selected={filters.lang}
          onToggle={toggle('lang')}
        />
      </div>
      {active > 0 && (
        <button
          onClick={() => setFilters(EMPTY_FILTERS)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Изчисти филтрите ({active})
        </button>
      )}
    </div>
  );
}

function FolderRows({ node, depth }: { node: FolderNode; depth: number }): JSX.Element {
  return (
    <details
      className={
        depth === 0
          ? 'bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'
          : 'border-t border-gray-100 dark:border-gray-800'
      }
    >
      <summary
        className={`cursor-pointer py-2.5 font-medium text-sm text-gray-800 dark:text-gray-100 select-none ${
          depth === 0 ? 'px-4' : 'px-3'
        }`}
      >
        {node.name}{' '}
        <span className="text-gray-500 dark:text-gray-400 font-normal">
          ({filesCount(node.total)})
        </span>
      </summary>
      <div className={depth === 0 ? 'px-2 pb-2' : 'pl-4 pb-1'}>
        {node.entries.length > 0 && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <EntryRows entries={sortEntries(node.entries)} />
          </div>
        )}
        {node.children.map(c => (
          <FolderRows key={c.name} node={c} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function LibraryTree({
  entries,
}: {
  entries: ClientEntry[];
}): JSX.Element {
  const tree = React.useMemo(() => folderTree(entries, folderLabel), [entries]);
  return (
    <div className="space-y-4">
      {tree.map(node => (
        <FolderRows key={node.name} node={node} depth={0} />
      ))}
    </div>
  );
}
