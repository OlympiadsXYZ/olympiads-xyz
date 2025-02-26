import { Link } from 'gatsby';
import * as React from 'react';
import '../../i18n';
import { useTranslation } from 'react-i18next';

export default function WelcomeBackBanner({
  lastViewedModuleURL,
  lastViewedModuleLabel,
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-white dark:bg-gray-800 shadow lg:rounded-lg w-full">
      <Link
        className="px-4 py-6 sm:p-8 block sm:flex sm:items-center sm:justify-between"
        to={lastViewedModuleURL || '/general/general-intro'}
      >
        <div>
          <h3 className="text-xl sm:text-2xl leading-7 font-medium text-black dark:text-dark-high-emphasis">
            {lastViewedModuleURL
              ? t('welcome-back-banner_welcome-back')
              : t('welcome-back-banner_welcome-to-the-usacog')}
          </h3>
          <div className="mt-2 font-medium text-blue-600 dark:text-blue-300">
            <p>
              {lastViewedModuleURL
                ? `${t('welcome-back-banner_pick-up-where-you-left-off')} "${lastViewedModuleLabel}".`
                : t('welcome-back-banner_get-started-on-the-first-module')}
            </p>
          </div>
        </div>
        <div className="mt-5 sm:mt-0 sm:ml-6 sm:flex-shrink-0 sm:flex sm:items-center lg:mr-2">
          <span className="inline-flex rounded-md shadow-sm">
            <span className="inline-flex items-center px-4 lg:px-8 py-2 lg:py-3 border border-transparent text-sm sm:text-base lg:text-lg font-medium rounded-md text-white bg-blue-800 hover:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none focus:border-blue-700 focus:shadow-outline-blue active:bg-blue-700 transition ease-in-out duration-150">
              {lastViewedModuleURL
                ? `${t('welcome-back-banner_continue')}: ${lastViewedModuleLabel}`
                : `${t('welcome-back-banner_get-started')}: ${t('welcome-back-banner_introduction')}`}
            </span>
          </span>
        </div>
      </Link>
    </div>
  );
}
