import React from 'react';
import { useTranslation } from 'react-i18next';

export const ProgressTrackingFeature = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <div className="-m-4">
      <div className="w-full p-4">
        <div className="bg-white dark:bg-gray-800 shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-300">
              {t('modules-progress')}
            </h3>
            <div className="mt-6">
              <div>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  <div className="text-center">
                    <span className="text-3xl font-bold text-green-800 bg-green-100 dark:text-green-100 dark:bg-green-800 rounded-full h-16 w-16 inline-block inline-flex items-center justify-center">
                      6
                    </span>
                    <span className="block mt-1 text-sm font-medium uppercase text-green-800 dark:text-green-100">
                      {t('completed')}
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="text-3xl font-bold text-yellow-800 bg-yellow-100 dark:text-yellow-100 dark:bg-yellow-800 rounded-full h-16 w-16 inline-block inline-flex items-center justify-center">
                      3
                    </span>
                    <span className="block mt-1 text-sm font-medium uppercase text-yellow-800 dark:text-yellow-100">
                      {t('in-progress')}
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="text-3xl font-bold text-blue-800 bg-blue-100 dark:text-blue-100 dark:bg-blue-800 rounded-full h-16 w-16 inline-block inline-flex items-center justify-center">
                      2
                    </span>
                    <span className="block mt-1 text-sm font-medium uppercase text-blue-800 dark:text-blue-100">
                      {t('skipped')}
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="text-3xl font-bold text-gray-800 bg-gray-100 rounded-full h-16 w-16 inline-block inline-flex items-center justify-center">
                      1
                    </span>
                    <span className="block mt-1 text-sm font-medium uppercase text-gray-800 dark:text-gray-100">
                      {t('not-started')}
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <div className="overflow-hidden h-4 text-xs flex bg-gray-200">
                    <div
                      className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-green-500"
                      style={{ width: '50%' }}
                    />
                    <div
                      className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-yellow-300"
                      style={{ width: '25%' }}
                    />
                    <div
                      className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500"
                      style={{ width: '16.66667%' }}
                    />
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold inline-block text-gray-800 dark:text-gray-300">
                      {t('total')}: 12
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
