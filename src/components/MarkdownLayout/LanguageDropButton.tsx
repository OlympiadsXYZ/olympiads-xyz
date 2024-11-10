import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/solid';
import classNames from 'classnames';

const LANGUAGES = ['en', 'bg', 'de'];
const LANGUAGE_LABELS = {
  en: 'English',
  bg: 'Български',
  de: 'Deutsch',
};

export default function LanguageDropdown({
  currentLanguage = 'bg',
  sidebarNav = false,
  onSelect = null as ((section: string) => void) | null,
  noDarkMode = false,
}): JSX.Element {
  const { i18n } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState(currentLanguage);

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    setSelectedLanguage(lng);
  };

  return (
    <Menu as="div">
      {({ open }) => (
        <div className="relative h-full">
          <Menu.Button
            className={`group flex-1 flex items-center p-2 text-sm leading-4 font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-dark-med-emphasis dark:hover:text-dark-high-emphasis dark:focus:text-dark-high-emphasis dark:hover:bg-gray-900 dark:focus:bg-gray-900 focus:outline-none focus:bg-gray-100 transition ease-in-out duration-150`}
          >
            <span>
              {LANGUAGE_LABELS[selectedLanguage]}
            </span>
            <ChevronDownIcon
              className={`ml-2 h-4 w-4 text-gray-400 group-hover:text-gray-500 group-focus:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400 transition ease-in-out duration-150`}
              aria-hidden="true"
            />
          </Menu.Button>
          <Transition
            show={open}
            as={React.Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items
              static
              className={`origin-top-left absolute z-20 left-0 w-30 -ml-4 rounded-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 shadow-lg focus:outline-none ${
                sidebarNav ? 'mt-2' : '-mt-2'
              }`}
            >
              <div className="py-1">
                {LANGUAGES.map(language => (
                  <Menu.Item key={language}>
                    {({ active }) => (
                      <button
                        onClick={() => changeLanguage(language)}
                        className={classNames(
                          'w-full text-left block px-4 py-2 text-base font-medium leading-6 focus:outline-none',
                          active
                            ? 'bg-gray-100 text-gray-900 dark:text-gray-100 dark:bg-gray-700'
                            : 'text-gray-700 dark:text-gray-100'
                        )}
                      >
                        {LANGUAGE_LABELS[language]}
                      </button>
                    )}
                  </Menu.Item>
                ))}
              </div>
            </Menu.Items>
          </Transition>
        </div>
      )}
    </Menu>
  );
}