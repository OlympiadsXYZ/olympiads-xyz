import { PageProps, graphql } from 'gatsby';
import * as React from 'react';
import Announcements from '../components/Dashboard/Announcements';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import Layout from '../components/layout';
import SEO from '../components/seo';
import '../i18n';
import { useTranslation } from 'react-i18next';
import {
  AnnouncementInfo,
  graphqlToAnnouncementInfo,
} from '../models/announcement';

export default function AnnouncementsPage(props: PageProps) {
  const { t } = useTranslation();
  const { announcements } = props.data as any;
  const parsedAnnouncements: AnnouncementInfo[] = React.useMemo(() => {
    return announcements.edges.map(node =>
      graphqlToAnnouncementInfo(node.node)
    );
  }, []);

  return (
    <Layout>
      <SEO title={t('announcements_title')} />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar linkLogoToIndex={true} redirectToDashboard={true} />
        <h1 className="text-3xl font-bold leading-tight text-gray-900 dark:text-dark-high-emphasis text-center mx-auto mt-6">
          {t('announcements_title')}
        </h1>
        <main className="pb-12">
          <Announcements
            className="lg:grid-cols-1 max-w-xl px-12 mx-6 sm:mx-auto"
            announcements={parsedAnnouncements}
          />
        </main>
      </div>
    </Layout>
  );
}

export const pageQuery = graphql`
  query {
    announcements: allXdm(
      filter: { fileAbsolutePath: { regex: "/announcements/" } }
      sort: { order: DESC, fields: frontmatter___order }
    ) {
      edges {
        node {
          frontmatter {
            title
            id
            date
          }
          body
        }
      }
    }
  }
`;
