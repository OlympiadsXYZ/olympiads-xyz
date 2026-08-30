import { Link } from 'gatsby';
import * as React from 'react';
import type { ClientEntry, CompetitionSummary } from '../../archive/catalog-node';
import {
  competitionName,
  competitionShort,
  formatBytes,
  SCIENCE_COLORS,
  SCIENCE_LABELS,
} from '../../archive/labels';
import {
  applyFilters,
  Crumbs,
  EMPTY_FILTERS,
  EntryList,
  LibraryTree,
} from '../../components/Archive/ArchiveUI';
import TopNavigationBar from '../../components/TopNavigationBar/TopNavigationBar';
import Layout from '../../components/layout';
import SEO from '../../components/seo';

type Props = {
  pageContext: {
    science: string;
    competitions: CompetitionSummary[];
    library: ClientEntry[];
    uncategorized: ClientEntry[];
  };
};

export default function ArchiveScienceTemplate({ pageContext }: Props): JSX.Element {
  const { science, competitions, library, uncategorized } = pageContext;
  const name = SCIENCE_LABELS[science] ?? science;
  const colors = SCIENCE_COLORS[science] ?? { bg: 'bg-gray-700', text: 'text-gray-100' };
  const [q, setQ] = React.useState('');
  const [index, setIndex] = React.useState<(ClientEntry & { comp: string | null })[] | null>(null);

  const loadIndex = () => {
    if (index) return;
    fetch(`/archive-data/${science}.json`)
      .then(r => r.json())
      .then(setIndex)
      .catch(() => setIndex([]));
  };

  const results =
    q.trim() && index ? applyFilters(index, { ...EMPTY_FILTERS, q }).slice(0, 200) : null;

  return (
    <Layout>
      <SEO title={`Архив · ${name}`} pathname={`/archive/${science}`} />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <div className={`${colors.bg} py-10 px-5`}>
          <div className="max-w-5xl mx-auto">
            <h1 className="text-4xl font-black text-white">{name}</h1>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-5 py-8">
          <Crumbs parts={[{ name: 'Архив', href: '/archive/' }, { name }]} />
          <input
            type="search"
            value={q}
            onFocus={loadIndex}
            onChange={e => {
              setQ(e.target.value);
              loadIndex();
            }}
            placeholder={`Търси във всички материали по ${name.toLowerCase()}…`}
            className="w-full px-4 py-2.5 mb-6 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {results ? (
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-sm text-gray-500 dark:text-gray-400 px-3 pb-2">
                {results.length === 200 ? 'Първите 200 резултата' : `${results.length} файла`}
              </p>
              <EntryList entries={results} />
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                Състезания
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
                {competitions.map(c => (
                  <Link
                    key={c.code}
                    to={`/archive/${science}/${c.slug}/`}
                    className="block rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {competitionName(c.code)}
                      </span>
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500">
                        {competitionShort(c.code)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                      {c.yearMin && c.yearMax
                        ? c.yearMin === c.yearMax
                          ? c.yearMin
                          : `${c.yearMin}–${c.yearMax}`
                        : 'без години'}{' '}
                      · {c.count} файла · {formatBytes(c.bytes)}
                    </p>
                  </Link>
                ))}
              </div>
              {library.length > 0 && (
                <>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                    Библиотека
                  </h2>
                  <div className="mb-10">
                    <LibraryTree entries={library} />
                  </div>
                </>
              )}
              {uncategorized.length > 0 && (
                <>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                    Други материали
                  </h2>
                  <LibraryTree entries={uncategorized} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
