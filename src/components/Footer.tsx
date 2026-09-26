// Site footer, rendered on every page by layout.tsx (it used to exist only on
// the home page). The main links, the contact form and the licence notice.
import classNames from 'classnames';
import { Link } from 'gatsby';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import ContactUsSlideover from './ContactUsSlideover/ContactUsSlideover';

const linkClasses =
  'underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-current dark:decoration-gray-600 dark:hover:text-dark-high-emphasis transition';

export default function Footer({
  sidebarOffset = false,
}: {
  /** Leaves room for the fixed 20rem sidebar of module and problem pages. */
  sidebarOffset?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const [isContactUsActive, setIsContactUsActive] = React.useState(false);
  return (
    <footer
      className={classNames(
        'bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800',
        sidebarOffset && 'lg:pl-80'
      )}
    >
      <div className="max-w-screen-xl mx-auto py-10 px-4 text-center text-sm leading-6 text-gray-600 dark:text-dark-med-emphasis">
        <nav
          aria-label={t('footer_nav')}
          className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-base font-medium"
        >
          <Link to="/problems/" className={linkClasses}>
            {t('top-nav_problems')}
          </Link>
          <Link to="/archive/" className={linkClasses}>
            {t('top-nav_archive')}
          </Link>
          <Link to="/license" className={linkClasses}>
            {t('footer_license')}
          </Link>
          <button
            type="button"
            className={linkClasses}
            onClick={() => setIsContactUsActive(true)}
          >
            {t('top-nav_contact-us')}
          </button>
          <a
            href="https://github.com/OlympiadsXYZ/olympiads-xyz"
            target="_blank"
            rel="noreferrer"
            className={linkClasses}
          >
            GitHub
          </a>
        </nav>
        <p className="mt-6">
          &copy; {new Date().getFullYear()} Olympiads XYZ.{' '}
          {t('index_powered-by')}
          <br />
          {t('index_copyright')}{' '}
          <Link to="/license" className={linkClasses}>
            {t('index_learn-more')}
          </Link>
        </p>
      </div>
      <ContactUsSlideover
        isOpen={isContactUsActive}
        onClose={() => setIsContactUsActive(false)}
      />
    </footer>
  );
}
