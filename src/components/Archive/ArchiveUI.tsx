// Shared client-side UI for the catalog-driven archive.
import { Link } from 'gatsby';
import * as React from 'react';
import {
  entryUrl,
  formatBytes,
  groupLabel,
  label,
  LANG_LABELS,
  ROUND_LABELS,
  ROUND_ORDER,
  TYPE_LABELS,
  TYPE_ORDER,
} from '../../archive/labels';
import type { ClientEntry } from '../../archive/catalog-node';

const EXT_ICONS: { [ext: string]: string } = {
  pdf: 'PDF',
  doc: 'DOC',
  img: 'IMG',
  zip: 'ZIP',
  xls: 'XLS',
  book: 'BOOK',
  other: 'FILE',
};

export function Crumbs({
  parts,
}: {
  parts: { name: string; href?: string }[];
}): JSX.Element {
  return (
    <nav className="text-sm text-gray-500 dark:text-gray-400 mb-4 flex flex-wrap gap-1 items-center">
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

export function EntryRow({ entry }: { entry: ClientEntry }): JSX.Element {
  const url = entryUrl(entry.key);
  const inner = (
    <>
      <span className="flex-none w-11 text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">
        {EXT_ICONS[entry.ext] ?? 'FILE'}
      </span>
      <span className="flex-1 min-w-0 break-words">{entry.title}</span>
      <span className="flex-none flex items-center gap-1.5">
        <Badge color={TYPE_COLORS[entry.type]}>
          {label(TYPE_LABELS, entry.type)}
        </Badge>
        {entry.group && <Badge>{groupLabel(entry.group)}</Badge>}
        {entry.lang && entry.lang !== 'bg' && (
          <Badge>{label(LANG_LABELS, entry.lang)}</Badge>
        )}
        <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums w-16 text-right">
          {formatBytes(entry.size)}
        </span>
      </span>
    </>
  );
  const base =
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-800 dark:text-gray-100';
  if (!url) {
    return (
      <div className={`${base} opacity-60`}>
        {inner}
        <Badge color="amber">скоро</Badge>
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} hover:bg-gray-100 dark:hover:bg-gray-800`}
    >
      {inner}
    </a>
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
      (a.group ?? '').localeCompare(b.group ?? '') ||
      (a.lang === 'bg' ? 0 : 1) - (b.lang === 'bg' ? 0 : 1) ||
      a.title.localeCompare(b.title)
  );
}

export function EntryList({
  entries,
  groupByRound = false,
}: {
  entries: ClientEntry[];
  groupByRound?: boolean;
}): JSX.Element {
  const sorted = sortEntries(entries);
  if (!groupByRound) {
    return (
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {sorted.map(e => (
          <EntryRow key={e.id} entry={e} />
        ))}
      </div>
    );
  }
  const byRound: { [r: string]: ClientEntry[] } = {};
  sorted.forEach(e => {
    const r = e.round ?? '__none';
    if (!byRound[r]) byRound[r] = [];
    byRound[r].push(e);
  });
  const roundKeys = Object.keys(byRound).sort(
    (a, b) =>
      roundSortKey(a === '__none' ? null : a) -
      roundSortKey(b === '__none' ? null : b)
  );
  return (
    <div className="space-y-6">
      {roundKeys.map(r => (
        <div key={r}>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 px-3">
            {r === '__none' ? 'Общи материали' : label(ROUND_LABELS, r)}
          </h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {byRound[r].map(e => (
              <EntryRow key={e.id} entry={e} />
            ))}
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
  entries: ClientEntry[],
  f: Filters
): ClientEntry[] {
  const q = f.q.trim().toLowerCase();
  return entries.filter(e => {
    if (f.round.length && !f.round.includes(e.round ?? '')) return false;
    if (f.group.length && !f.group.includes(e.group ?? '')) return false;
    if (f.type.length && !f.type.includes(e.type)) return false;
    if (f.lang.length && !f.lang.includes(e.lang)) return false;
    if (q) {
      const hay = `${e.title} ${e.year ?? ''} ${e.round ?? ''} ${
        label(TYPE_LABELS, e.type) ?? ''
      } ${e.type}`.toLowerCase();
      if (!q.split(/\s+/).every(tok => hay.includes(tok))) return false;
    }
    return true;
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
      <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 w-14 flex-none">
        {title}
      </span>
      {values.map(v => (
        <button
          key={v}
          onClick={() => onToggle(v)}
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

export function FilterBar({
  entries,
  filters,
  setFilters,
}: {
  entries: ClientEntry[];
  filters: Filters;
  setFilters: (f: Filters) => void;
}): JSX.Element {
  const distinct = (get: (e: ClientEntry) => string | null) =>
    [...new Set(entries.map(get).filter((v): v is string => !!v))].sort();
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
        placeholder="Търси по заглавие, година…"
        className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-transparent text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="space-y-1.5 overflow-x-auto">
        <FacetChips
          title="Кръг"
          values={distinct(e => e.round)}
          labelFor={v => label(ROUND_LABELS, v) ?? v}
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
          values={distinct(e => e.type)}
          labelFor={v => label(TYPE_LABELS, v) ?? v}
          selected={filters.type}
          onToggle={toggle('type')}
        />
        <FacetChips
          title="Език"
          values={distinct(e => e.lang)}
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

export function LibraryTree({
  entries,
}: {
  entries: ClientEntry[];
}): JSX.Element {
  const byFolder: { [f: string]: ClientEntry[] } = {};
  entries.forEach(e => {
    const f = e.folder ?? '';
    if (!byFolder[f]) byFolder[f] = [];
    byFolder[f].push(e);
  });
  const folders = Object.keys(byFolder).sort();
  return (
    <div className="space-y-4">
      {folders.map(f => (
        <details
          key={f}
          className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <summary className="cursor-pointer px-4 py-2.5 font-medium text-sm text-gray-800 dark:text-gray-100 select-none">
            {f.split('/').slice(1).join(' › ') || 'Други'}{' '}
            <span className="text-gray-400 dark:text-gray-500">
              ({byFolder[f].length})
            </span>
          </summary>
          <div className="px-2 pb-2 divide-y divide-gray-100 dark:divide-gray-800">
            {sortEntries(byFolder[f]).map(e => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
