// Site-wide level selector — same UX as the language switcher: pick your
// класова група once and every section shows the categories for that level
// (docs/Structure.md). Selecting a level never navigates.
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/solid';
import classNames from 'classnames';
import * as React from 'react';
import { LEVEL_LABELS, LEVELS } from '../../content/ordering';
import { useLevel } from '../context/LevelContext';

export default function LevelSwitcher({
  noDarkMode = false,
}: {
  noDarkMode?: boolean;
}): JSX.Element {
  const { level, levelReady, setLevel } = useLevel();

  return (
    <Menu as="div">
      {({ open }) => (
        <div className="relative h-full">
          <Menu.Button
            className={`group ${
              open ? 'text-gray-900' : 'text-gray-500'
            } inline-flex items-center h-full space-x-2 text-base leading-6 font-medium hover:text-gray-900 focus:outline-none focus:text-gray-900 transition ease-in-out duration-150 ${
              !noDarkMode && 'dark:text-dark-high-emphasis'
            }`}
          >
            <span>{levelReady ? LEVEL_LABELS[level] : 'Ниво'}</span>
            <ChevronDownIcon
              className={`${
                open ? 'text-gray-500' : 'text-gray-400'
              } h-5 w-5 group-hover:text-gray-500 group-focus:text-gray-500 transition ease-in-out duration-150 ${
                !noDarkMode &&
                'dark:text-dark-med-emphasis dark:group-hover:text-dark-med-emphasis dark:group-focus:text-dark-med-emphasis'
              }`}
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
              className="origin-top-right absolute z-30 right-0 mt-2 w-56 rounded-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 shadow-lg focus:outline-none"
            >
              <div className="py-1">
                {LEVELS.map(option => (
                  <Menu.Item key={option}>
                    {({ active }) => (
                      <button
                        onClick={() => setLevel(option)}
                        className={classNames(
                          'w-full text-left flex items-center px-4 py-2 text-base font-medium leading-6 focus:outline-none',
                          active
                            ? 'bg-gray-100 text-gray-900 dark:text-gray-100 dark:bg-gray-700'
                            : 'text-gray-700 dark:text-gray-100'
                        )}
                      >
                        {LEVEL_LABELS[option]}
                        {option === level && (
                          <span className="ml-auto text-blue-500">✓</span>
                        )}
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
