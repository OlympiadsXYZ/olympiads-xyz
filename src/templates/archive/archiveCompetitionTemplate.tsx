import { Link } from 'gatsby';
import * as React from 'react';
import type { ClientEntry } from '../../archive/catalog-node';
import {
  competitionName,
  competitionShort,
  filesCount,
  SCIENCE_COLORS,
  SCIENCE_LABELS,
} from '../../archive/labels';
import {
  applyFilters,
  Crumbs,
  EMPTY_FILTERS,
  EntryList,
  FilterBar,
  Filters,
  NoResults,
} from '../../components/Archive/ArchiveUI';
import TopNavigationBar from '../../components/TopNavigationBar/TopNavigationBar';
import Layout from '../../components/layout';
import SEO from '../../components/seo';

type Props = {
  pageContext: {
    science: string;
    competition: string;
    slug: string;
    years: number[];
    undatedCount: number;
    entries: ClientEntry[];
  };
};

export default function ArchiveCompetitionTemplate({ pageContext }: Props): JSX.Element {
  const { science, competition, slug, years, entries } = pageContext;
  const name = competitionName(competition);
  const scienceName = SCIENCE_LABELS[science] ?? science;
  const colors = SCIENCE_COLORS[science] ?? { bg: 'bg-gray-700', text: 'text-gray-100' };
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const active =
    filters.q.trim() ||
    filters.round.length ||
    filters.group.length ||
    filters.type.length ||
    filters.lang.length;
  const filtered = active ? applyFilters(entries, filters, competition) : null;
  // Сборници, бележки, регламенти и протоколи без година нямат своя
  // годишна страница — показват се под годините.
  const undated = entries.filter(e => e.year == null);

  return (
    <Layout>
      <SEO
        title={`Архив · ${scienceName} · ${name}`}
        description={`${name} (${competitionShort(competition)}): оригиналните условия, решения и протоколи${
          years.length
            ? ` от ${years.length === 1 ? years[0] : `${years.length} години (${years[years.length - 1]}–${years[0]})`}`
            : ''
        }${undated.length ? ', сборници и материали без година' : ''}.`}
        pathname={`/archive/${science}/${slug}/`}
      />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <main>
        <div className={`${colors.bg} py-10 px-5`}>
          <div className="max-w-5xl mx-auto">
            <h1 className="text-3xl sm:text-4xl font-black text-white">{name}</h1>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-5 py-8">
          <Crumbs
            parts={[
              { name: 'Архив', href: '/archive/' },
              { name: scienceName, href: `/archive/${science}/` },
              { name },
            ]}
          />
          <FilterBar
            entries={entries}
            filters={filters}
            setFilters={setFilters}
            competition={competition}
          />
          {filtered ? (
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-sm text-gray-500 dark:text-gray-400 px-3 pb-2">
                {filesCount(filtered.length)}
              </p>
              {filtered.length ? (
                <EntryList entries={filtered} competition={competition} />
              ) : (
                <NoResults
                  onReset={() => setFilters(EMPTY_FILTERS)}
                  resetLabel="Изчисти филтрите"
                />
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {years.map(y => (
                  <Link
                    key={y}
                    to={`/archive/${science}/${slug}/${y}/`}
                    className="block text-center py-2.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 font-semibold text-gray-800 dark:text-gray-100 hover:border-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors tabular-nums"
                  >
                    {y}
                  </Link>
                ))}
              </div>
              {undated.length > 0 && (
                <>
                  <h2
                    className={`text-xl font-bold text-gray-900 dark:text-gray-100 mb-3 ${
                      years.length ? 'mt-10' : ''
                    }`}
                  >
                    Без година
                  </h2>
                  <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <EntryList entries={undated} competition={competition} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
        </main>
      </div>
    </Layout>
  );
}
