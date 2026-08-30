import { Link } from 'gatsby';
import * as React from 'react';
import TopNavigationBar from '../../components/TopNavigationBar/TopNavigationBar';
import Layout from '../../components/layout';
import SEO from '../../components/seo';
import useStaffRole from '../../hooks/useStaffRole';

type DraftEntry = {
  id: string;
  title: string;
  description: string | null;
  group: string;
};

export default function DraftsIndexTemplate({
  pageContext,
}: {
  pageContext: { drafts: DraftEntry[] };
}): JSX.Element {
  const { role, loading } = useStaffRole();
  const byGroup: { [g: string]: DraftEntry[] } = {};
  pageContext.drafts.forEach(d => {
    if (!byGroup[d.group]) byGroup[d.group] = [];
    byGroup[d.group].push(d);
  });

  return (
    <Layout>
      <SEO title="Чернови" />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <div className="max-w-3xl mx-auto px-5 py-10">
          <h1 className="text-3xl font-black text-gray-900 dark:text-gray-100">
            Чернови ({pageContext.drafts.length})
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300 text-sm">
            Непубликувани модули. Публикация става чак след пренаписване по
            стандарта и регистрация в ordering.ts.
          </p>
          {loading ? (
            <p className="mt-8 text-gray-500 dark:text-gray-400">
              Проверка на достъпа…
            </p>
          ) : role ? (
            <div className="mt-8 space-y-8">
              {Object.keys(byGroup)
                .sort()
                .map(g => (
                  <div key={g}>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
                      {g}
                    </h2>
                    <ul className="space-y-1">
                      {byGroup[g].map(d => (
                        <li key={d.id}>
                          <Link
                            to={`/drafts/${d.id}/`}
                            className="text-blue-700 dark:text-blue-400 hover:underline"
                          >
                            {d.title}
                          </Link>
                          {d.description && (
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {' '}
                              — {d.description}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-8 text-gray-700 dark:text-gray-300">
              Черновите са видими само за администратори и автори. Влезте с
              акаунт с такава роля.
            </p>
          )}
        </div>
      </div>
    </Layout>
  );
}
