import { XIcon } from '@heroicons/react/solid';
import { Link } from 'gatsby';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useSiteStats } from '../../hooks/useSiteStats';
import {
  approxCount,
  mostHaveSolutions,
  subjectList,
} from '../../utils/siteStatsFormat';

// A dismissed banner stays closed on this browser until the id changes: give a
// new announcement a new id. The counts in the text change with every build
// and do not bring it back.
export const BANNER_ID = 'problem-bank-2026-09';
const BANNER_STORAGE_KEY = 'olympiads:banner-dismissed';

export default function Banner() {
  const { t } = useTranslation();
  const stats = useSiteStats();
  // rendered in the static HTML; hidden after hydration when dismissed here
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(BANNER_STORAGE_KEY) === BANNER_ID) {
        setDismissed(true);
      }
    } catch (e) {
      // storage unavailable: the banner just shows
    }
  }, []);
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(BANNER_STORAGE_KEY, BANNER_ID);
    } catch (e) {
      // closed for this page view only
    }
  };
  if (dismissed || !stats || stats.problems === 0) return null;

  return (
    <div className="relative isolate flex items-center gap-x-4 overflow-hidden bg-gray-50 dark:bg-[rgb(17_24_39)] pl-4 pr-2 py-2 sm:px-3.5 sm:before:flex-1">
      <div
        className="absolute left-[max(-7rem,calc(50%-52rem))] top-1/2 -z-10 -translate-y-1/2 transform-gpu blur-2xl"
        aria-hidden="true"
      >
        <div
          className="aspect-[577/310] w-[36.0625rem] bg-gradient-to-r from-[#ff80b5] to-[#9089fc] opacity-30"
          style={{
            clipPath:
              'polygon(74.8% 41.9%, 97.2% 73.2%, 100% 34.9%, 92.5% 0.4%, 87.5% 0%, 75% 28.6%, 58.5% 54.6%, 50.1% 56.8%, 46.9% 44%, 48.3% 17.4%, 24.7% 53.9%, 0% 27.9%, 11.9% 74.2%, 24.9% 54.1%, 68.6% 100%, 74.8% 41.9%)',
          }}
        />
      </div>
      <div
        className="absolute left-[max(45rem,calc(50%+8rem))] top-1/2 -z-10 -translate-y-1/2 transform-gpu blur-2xl"
        aria-hidden="true"
      >
        <div
          className="aspect-[577/310] w-[36.0625rem] bg-gradient-to-r from-[#ff80b5] to-[#9089fc] opacity-30"
          style={{
            clipPath:
              'polygon(74.8% 41.9%, 97.2% 73.2%, 100% 34.9%, 92.5% 0.4%, 87.5% 0%, 75% 28.6%, 58.5% 54.6%, 50.1% 56.8%, 46.9% 44%, 48.3% 17.4%, 24.7% 53.9%, 0% 27.9%, 11.9% 74.2%, 24.9% 54.1%, 68.6% 100%, 74.8% 41.9%)',
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
        <p className="text-sm leading-6 text-gray-900 dark:text-white">
          {t('banner_problems', { n: approxCount(stats.problems) })}
          {stats.subjects.length > 0 && (
            <span className="hidden sm:inline">
              {' '}
              {t('banner_subjects', { subjects: subjectList(stats.subjects) })}
            </span>
          )}
          {mostHaveSolutions(stats) && <> — {t('banner_most-solved')}</>}
          <Link
            to="/problems/"
            className="ml-2 font-semibold underline decoration-gray-400 underline-offset-2 hover:decoration-current sm:hidden"
          >
            {t('banner_action')}&nbsp;<span aria-hidden="true">&rarr;</span>
          </Link>
        </p>
        <Link
          to="/problems/"
          className="hidden sm:block flex-none rounded-full bg-gray-900 px-3.5 py-1 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
        >
          {t('banner_action')} <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
      <div className="flex flex-1 justify-end">
        <button
          type="button"
          onClick={dismiss}
          className="-m-1 p-2 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-900/5 dark:text-gray-300 dark:hover:text-white dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span className="sr-only">{t('banner_close')}</span>
          <XIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
