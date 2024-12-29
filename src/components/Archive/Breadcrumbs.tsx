import { Link } from 'gatsby';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { createGlobalStyle } from 'styled-components';

export type BreadcrumbItem = {
  name: string;
  path?: string;
  onClick?: () => void;
};

const Breadcrumbs: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => {
  const { t } = useTranslation();
  
  return (
    <nav className="flex items-center mb-6 overflow-x-auto max-w-full pb-2 hide-scrollbar">
      <div className="flex-shrink-0">
        <Link
          to="/archive"
          className="flex items-center text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
        >
          <svg
            className="flex-shrink-0 h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
          </svg>
          <span className="ml-2 whitespace-nowrap">{t('archive')}</span>
        </Link>
      </div>

      {items.map((item, index) => (
        <div key={item.name} className="flex items-center flex-shrink-0">
          <svg
            className="flex-shrink-0 h-5 w-5 text-gray-400 dark:text-gray-500 mx-2"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <button
            onClick={item.onClick}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
          >
            {item.name}
          </button>
        </div>
      ))}
    </nav>
  );
};

export default Breadcrumbs;

const GlobalStyle = createGlobalStyle`
  .hide-scrollbar {
    -ms-overflow-style: none;  /* IE and Edge */
    scrollbar-width: none;  /* Firefox */
    &::-webkit-scrollbar {
      display: none;  /* Chrome, Safari and Opera */
    }
  }
`;