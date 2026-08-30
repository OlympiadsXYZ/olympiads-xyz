import { Link } from 'gatsby';
import * as React from 'react';
import { SCIENCE_COLORS, SCIENCE_LABELS } from '../../archive/labels';
import TopNavigationBar from '../../components/TopNavigationBar/TopNavigationBar';
import Layout from '../../components/layout';
import SEO from '../../components/seo';

type Props = {
  pageContext: {
    sciences: { science: string; count: number; bytes: number }[];
  };
};

export default function ArchiveIndexTemplate({ pageContext }: Props): JSX.Element {
  const { sciences } = pageContext;
  return (
    <Layout>
      <SEO title="Архив" pathname="/archive" />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
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
            {sciences.map(s => (
              <Link
                key={s.science}
                to={`/archive/${s.science}/`}
                className="block rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
              >
                <div
                  className={`inline-block px-2.5 py-1 rounded-md text-sm font-bold text-white ${
                    SCIENCE_COLORS[s.science]?.bg ?? 'bg-gray-700'
                  }`}
                >
                  {SCIENCE_LABELS[s.science] ?? s.science}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
