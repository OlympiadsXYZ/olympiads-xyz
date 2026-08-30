import { Link } from 'gatsby';
import * as React from 'react';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import Layout from '../components/layout';
import SEO from '../components/seo';

export default function ArchiveMaintenancePage(): JSX.Element {
  return (
    <Layout>
      <SEO title="Архив" pathname="/archive" />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-black/5 dark:shadow-white/5 shadow p-8 sm:p-10">
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
              Архивът временно не е достъпен
            </h1>
            <p className="mt-4 text-base sm:text-lg text-gray-700 dark:text-gray-300">
              Възстановяваме файловете и връзките на архива. Учебните модули и
              задачите продължават да са достъпни.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 transition-colors"
              >
                Към таблото
              </Link>
              <Link
                to="/problems"
                className="inline-flex items-center rounded-md bg-gray-200 dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-gray-100 font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Разгледай задачите
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
