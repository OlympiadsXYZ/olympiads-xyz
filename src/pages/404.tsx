import { Link } from 'gatsby';
import * as React from 'react';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import Layout from '../components/layout';
import SEO from '../components/seo';
import '../i18n';
import { useTranslation } from 'react-i18next';

export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <Layout>
      <SEO title="404" />
      <TopNavigationBar />

      <h1 className="text-center mt-16 text-4xl sm:text-5xl font-black">
        {t('404_not-found')}
      </h1>
      <p className="text-center mt-4">
        <Link to="/" className="text-xl text-blue-600">
          {t('404_return-home')}
        </Link>
      </p>
    </Layout>
  );
}
