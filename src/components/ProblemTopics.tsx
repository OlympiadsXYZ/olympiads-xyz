import { Link } from 'gatsby';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { tagLabel } from './ProblemsPage/problemSearch';

/** Topics are visible on the problem itself, including legacy topic metadata. */
export default function ProblemTopics({ tags }: { tags?: string[] | null }) {
  const { t } = useTranslation();
  const topics = [...new Set((tags ?? []).filter(Boolean))];
  if (!topics.length) return null;
  return (
    <nav aria-label={t('tags')} className="mb-6 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold text-gray-500 dark:text-dark-med-emphasis">
        {t('tags')}
      </span>
      {topics.map(tag => (
        <Link
          key={tag}
          to={`/problems?q=${encodeURIComponent(tagLabel(tag))}`}
          className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-blue-800 dark:bg-blue-900 dark:text-blue-100 dark:hover:bg-blue-800 dark:focus:ring-offset-gray-900"
        >
          {tagLabel(tag)}
        </Link>
      ))}
    </nav>
  );
}
