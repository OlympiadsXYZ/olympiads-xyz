import { Link } from 'gatsby';
import * as React from 'react';
import type { CollectionSearchEntry } from '../../collections/types';
import {
  matchesAllTokens,
  normalizeSearchText,
  searchTokens,
} from './problemSearch';

let pending: Promise<CollectionSearchEntry[]> | null = null;
function loadCollections() {
  if (!pending) {
    pending = fetch('/collections-data/index.json')
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(rows => {
        if (!Array.isArray(rows)) throw new Error('Invalid collection index');
        return rows as CollectionSearchEntry[];
      })
      .catch(error => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

export default function CollectionHits({
  query,
  filters,
}: {
  query: string;
  filters: { [attribute: string]: string[] };
}) {
  const [rows, setRows] = React.useState<CollectionSearchEntry[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    loadCollections()
      .then(data => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const tokens = searchTokens(query);
  const hits = rows.filter(row => {
    // A collection has no task progress, difficulty or field classification.
    if (
      Object.entries(filters).some(
        ([key, values]) =>
          values.length > 0 && !['subject', 'competition', 'year'].includes(key)
      )
    ) {
      return false;
    }
    if (filters.subject?.length && !filters.subject.includes(row.subject)) {
      return false;
    }
    if (
      filters.competition?.length &&
      !filters.competition.includes(row.competition)
    ) {
      return false;
    }
    if (
      filters.year?.length &&
      !row.contestYears.some(year => filters.year.includes(String(year)))
    ) {
      return false;
    }
    return matchesAllTokens(
      normalizeSearchText(
        [
          row.title,
          row.competition,
          row.subject,
          ...row.chapterTitles,
          ...row.contestYears,
          ...row.printedTags,
        ].join(' ')
      ),
      tokens
    );
  });
  if (!hits.length) return null;
  return (
    <section aria-label="Тематични сборници" className="mb-5">
      <h2 className="text-lg font-semibold mb-2">Тематични сборници</h2>
      {hits.map(row => (
        <article
          key={row.id}
          className="rounded bg-white dark:bg-dark-surface p-4 mb-2"
        >
          <Link
            to={row.url}
            className="text-blue-700 dark:text-blue-400 font-semibold"
          >
            {row.title}
          </Link>
          <p className="text-sm">
            {row.chapterTitles.length} глави · {row.taskCount} печатни задачи ·{' '}
            {row.language.toUpperCase()}
          </p>
          <p className="text-sm">
            Редактирани варианти от {row.contestYears.join(', ')}
          </p>
        </article>
      ))}
    </section>
  );
}
