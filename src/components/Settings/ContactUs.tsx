// Settings home for «Свържете се с нас» — the top-nav button moved here
// (and into the avatar menu); the slideover instance is local to this card.
import * as React from 'react';
import ContactUsSlideover from '../ContactUsSlideover/ContactUsSlideover';
import { useTranslation } from 'react-i18next';

export default function ContactUs(): JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false);
  const { t } = useTranslation();
  return (
    <div>
      <div className="space-y-1">
        <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
          {t('top-nav_contact-us')}
        </h3>
        <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Въпроси, обратна връзка, грешка в модул или файл в Архива — пишете
          ни, четем всичко.
        </p>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {t('top-nav_contact-us')}
        </button>
      </div>
      <ContactUsSlideover isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  );
}
