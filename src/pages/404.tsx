import {
  ArchiveIcon,
  QuestionMarkCircleIcon,
  SearchIcon,
} from '@heroicons/react/solid';
import { Link } from 'gatsby';
import * as React from 'react';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import { SearchModal } from '../components/TopNavigationBar/SearchModal';
import Layout from '../components/layout';
import SEO from '../components/seo';
import { useSiteStats } from '../hooks/useSiteStats';
import { approxCount } from '../utils/siteStatsFormat';
import '../i18n';
import { useTranslation } from 'react-i18next';

const cardClasses =
  'flex items-start gap-4 rounded-lg bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 p-5 text-left hover:ring-blue-500 dark:hover:ring-blue-400 transition';

export default function NotFoundPage() {
  const { t } = useTranslation();
  const stats = useSiteStats();
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);

  return (
    <Layout>
      <SEO title="404" />
      <div className="min-h-[70vh] bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />

        <main className="max-w-2xl mx-auto px-4 py-16">
          <h1 className="text-center text-4xl sm:text-5xl font-black text-gray-900 dark:text-white">
            {t('404_not-found')}
          </h1>
          <p className="text-center mt-4 text-lg text-gray-600 dark:text-gray-400">
            {t('404_lead')}
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <Link to="/problems/" className={cardClasses}>
              <QuestionMarkCircleIcon
                className="h-8 w-8 flex-shrink-0 text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              />
              <span>
                <span className="block text-lg font-semibold text-gray-900 dark:text-white">
                  {t('top-nav_problems')}
                </span>
                <span className="block mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t('404_problems-desc', { n: approxCount(stats.problems) })}
                </span>
              </span>
            </Link>
            <Link to="/archive/" className={cardClasses}>
              <ArchiveIcon
                className="h-8 w-8 flex-shrink-0 text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              />
              <span>
                <span className="block text-lg font-semibold text-gray-900 dark:text-white">
                  {t('top-nav_archive')}
                </span>
                <span className="block mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t('404_archive-desc')}
                </span>
              </span>
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <SearchIcon className="h-5 w-5 mr-2" aria-hidden="true" />
              {t('404_search')}
            </button>
            <Link
              to="/"
              className="text-base font-medium text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {t('404_return-home')}
            </Link>
          </div>
        </main>
      </div>

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </Layout>
  );
}
