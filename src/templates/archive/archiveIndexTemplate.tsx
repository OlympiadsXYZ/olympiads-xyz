import { Link } from 'gatsby';
import * as React from 'react';
import type { ScienceCard } from '../../archive/catalog-node';
import { plural, SCIENCE_COLORS, SCIENCE_LABELS } from '../../archive/labels';
import TopNavigationBar from '../../components/TopNavigationBar/TopNavigationBar';
import Layout from '../../components/layout';
import SEO from '../../components/seo';

type Props = {
  pageContext: {
    sciences: ScienceCard[];
  };
};

// What a card says under the science's name: its competitions and their years,
// or, for a shelf with no competitions, that it is a library.
function cardLines(s: ScienceCard): { main: string; sub: string | null } {
  if (s.competitions === 0) {
    return { main: 'Библиотека', sub: 'Книги и учебни материали' };
  }
  const years =
    s.yearMin && s.yearMax
      ? s.yearMin === s.yearMax
        ? ` · ${s.yearMin}`
        : ` · ${s.yearMin}–${s.yearMax}`
      : '';
  return {
    main: `${plural(s.competitions, 'състезание', 'състезания')}${years}`,
    sub: s.top.length ? s.top.join(', ') + (s.competitions > s.top.length ? ' …' : '') : null,
  };
}

export default function ArchiveIndexTemplate({ pageContext }: Props): JSX.Element {
  const { sciences } = pageContext;
  const competitions = sciences.reduce((a, s) => a + s.competitions, 0);
  const withCompetitions = sciences
    .filter(s => s.competitions > 0)
    .map(s => (SCIENCE_LABELS[s.science] ?? s.science).toLowerCase());
  const subjects =
    withCompetitions.length > 1
      ? `${withCompetitions.slice(0, -1).join(', ')} и ${withCompetitions[withCompetitions.length - 1]}`
      : withCompetitions.join('');
  return (
    <Layout>
      <SEO
        title="Архив"
        description={`Оригиналните условия, решения и протоколи на ${competitions} български и международни олимпиади и състезания по ${subjects} — свободни за всички.`}
        pathname="/archive/"
      />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <main>
        <div className="bg-blue-700 dark:bg-blue-900 py-12 px-5">
          <div className="max-w-5xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-black text-white">Архив</h1>
            <p className="mt-3 text-blue-100 text-lg max-w-2xl">
              Задачи, решения, книги и материали от български и международни
              олимпиади и състезания — свободни за всички.
            </p>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-5 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sciences.map(s => {
              const { main, sub } = cardLines(s);
              return (
                <Link
                  key={s.science}
                  to={`/archive/${s.science}/`}
                  className="block rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-blue-400 transition"
                >
                  <div
                    className={`inline-block px-2.5 py-1 rounded-md text-sm font-bold text-white ${
                      SCIENCE_COLORS[s.science]?.bg ?? 'bg-gray-700'
                    }`}
                  >
                    {SCIENCE_LABELS[s.science] ?? s.science}
                  </div>
                  <p className="mt-3 text-sm font-medium text-gray-800 dark:text-gray-100">
                    {main}
                  </p>
                  {sub && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {sub}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
        </main>
      </div>
    </Layout>
  );
}
