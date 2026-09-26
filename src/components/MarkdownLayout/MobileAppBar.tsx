import { SearchIcon } from '@heroicons/react/solid';
import { Link } from 'gatsby';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useMarkdownLayout } from '../../context/MarkdownLayoutContext';
import { SolutionInfo } from '../../models/solution';
import LogoSquare from '../LogoSquare';
import MobileMenuButtonContainer from '../MobileMenuButtonContainer';
import { SearchModal } from '../TopNavigationBar/SearchModal';
import NavBar from './NavBar';

export default function MobileAppBar() {
  const { t } = useTranslation();
  const { setIsMobileNavOpen, markdownLayoutInfo } = useMarkdownLayout();
  // A problem page has no module prev/next for the bar: it gets the logo (the
  // way home) and the search, as /problems has; its previous/next problem is
  // at the bottom of the page.
  const isProblemPage = markdownLayoutInfo instanceof SolutionInfo;
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);

  return (
    <div className="sticky top-0 inset-x-0 bg-white dark:bg-dark-surface z-10 shadow lg:hidden pl-1 pt-1 flex items-center">
      <MobileMenuButtonContainer
        className="flex-shrink-0 -ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center"
        aria-label="Отвори страничното меню"
        onClick={() => setIsMobileNavOpen(true)}
      >
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </MobileMenuButtonContainer>
      {isProblemPage ? (
        <>
          <Link
            to="/"
            aria-label="Olympiads XYZ — начална страница"
            className="ml-2 -mt-0.5 flex-shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <LogoSquare className="h-9 w-9" />
          </Link>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="mr-2 -mt-0.5 inline-flex items-center h-10 px-3 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-dark-high-emphasis dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <SearchIcon
              className="h-5 w-5 text-gray-400 dark:text-gray-300"
              aria-hidden="true"
            />
            <span className="ml-2 text-sm font-medium">
              {t('top-nav_search')}
            </span>
          </button>
          <SearchModal
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
          />
        </>
      ) : (
        <div className="flex-1 ml-4 mr-4 sm:mr-6">
          <NavBar />
        </div>
      )}
    </div>
  );
}
