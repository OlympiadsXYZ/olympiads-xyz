import { graphql, Link } from 'gatsby';
import * as React from 'react';
import Layout from '../components/layout';
import Markdown from '../components/markdown/Markdown';
import SEO from '../components/seo';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import type { CollectionPageContext } from '../collections/types';

export default function CollectionTemplate({
  data,
  pageContext,
}: {
  data: { xdm: { body: string } };
  pageContext: CollectionPageContext;
}) {
  const { collection, chapters, chapterId, taskSections } = pageContext;
  const chapter = chapters.find(item => item.id === chapterId);
  const title = chapter
    ? `${chapter.title} — ${collection.title}`
    : collection.title;
  return (
    <Layout>
      <SEO
        title={title}
        description="Тематичен редактиран сборник с условия и печатни решения."
      />
      <TopNavigationBar />
      <main className="max-w-5xl mx-auto px-5 py-10">
        <Link to="/problems/" className="text-blue-700 dark:text-blue-400">
          Задачи и сборници
        </Link>
        <h1 className="text-3xl font-bold mt-4 mb-3">{title}</h1>
        <p>
          Редактиран тематичен сборник · {collection.language.toUpperCase()}
        </p>
        <p>Печатни състезателни кодове: {collection.contestYears.join(', ')}</p>
        {collection.publicationYear !== null && (
          <p>Година на изданието: {collection.publicationYear}</p>
        )}
        <p className="mt-2">{pageContext.attribution}</p>
        <p className="text-sm mt-2">{pageContext.printedConditions}</p>
        <nav aria-label="Навигация на сборника" className="my-6">
          <Link
            to={collection.url}
            aria-current={chapterId === null ? 'page' : undefined}
          >
            За сборника
          </Link>
          <details open={chapterId === null} className="mt-3">
            <summary className="cursor-pointer font-semibold">Глави</summary>
            <ol className="list-decimal pl-5 mt-2">
              {chapters.map(item => (
                <li key={item.id}>
                  <Link
                    to={item.url}
                    aria-current={item.id === chapterId ? 'page' : undefined}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ol>
          </details>
          {taskSections.length > 0 && (
            <details open className="mt-3">
              <summary className="cursor-pointer font-semibold">
                Задачи в тази глава
              </summary>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-2">
                {taskSections.map(group => (
                  <div key={group.section}>
                    <a
                      href={`#native-section-${group.section.replace(
                        /[^a-z0-9-]/gi,
                        '-'
                      )}`}
                      className="font-semibold"
                    >
                      {group.section}
                    </a>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                      {group.tasks.map(task => (
                        <li key={task.id}>
                          <a
                            href={`#${task.id}`}
                            title={task.printedTags.join(' · ')}
                          >
                            {task.printedNumber}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}
        </nav>
        <Markdown body={data.xdm.body} />
      </main>
    </Layout>
  );
}

export const pageQuery = graphql`
  query ($id: String!) {
    xdm(frontmatter: { id: { eq: $id } }) {
      body
    }
  }
`;
