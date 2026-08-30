// Renders a single draft module. Draft pages are only generated when
// GATSBY_INCLUDE_DRAFTS=true (preview deployments), and are additionally
// gated client-side to admin/author accounts.
import { graphql, Link } from 'gatsby';
import * as React from 'react';
import TopNavigationBar from '../../components/TopNavigationBar/TopNavigationBar';
import Layout from '../../components/layout';
import Markdown from '../../components/markdown/Markdown';
import SEO from '../../components/seo';
import useStaffRole from '../../hooks/useStaffRole';

export default function DraftTemplate(props: any): JSX.Element {
  const { xdm } = props.data;
  const { role, loading } = useStaffRole();

  return (
    <Layout>
      <SEO title={`Чернова · ${xdm.frontmatter.title}`} />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <div className="bg-amber-600 dark:bg-amber-800 text-white text-sm font-semibold px-5 py-2 text-center">
          ЧЕРНОВА — този модул не е публикуван и не отговаря още на
          стандарта (docs/Module-Standard.md)
        </div>
        <div className="max-w-3xl mx-auto px-5 py-8">
          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Проверка на достъпа…</p>
          ) : role ? (
            <>
              <Link
                to="/drafts/"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                ← Всички чернови
              </Link>
              <h1 className="text-3xl font-black text-gray-900 dark:text-gray-100 mt-2 mb-6">
                {xdm.frontmatter.title}
              </h1>
              <div className="markdown">
                <Markdown body={xdm.body} />
              </div>
            </>
          ) : (
            <p className="text-gray-700 dark:text-gray-300">
              Черновите са видими само за администратори и автори. Влезте с
              акаунт с такава роля.
            </p>
          )}
        </div>
      </div>
    </Layout>
  );
}

export const pageQuery = graphql`
  query DraftById($id: String!) {
    xdm(frontmatter: { id: { eq: $id } }) {
      body
      frontmatter {
        id
        title
        description
        author
      }
    }
  }
`;
