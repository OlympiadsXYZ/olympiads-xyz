// Persistent grade/level selector, mirroring the language switcher UX:
// pick your level once, the site remembers it and takes you to that
// level's topic overview (see the index doc: "select your grade level,
// then choose a topic").
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/solid';
import classNames from 'classnames';
import { navigate } from 'gatsby';
import * as React from 'react';

export const GRADE_STORAGE_KEY = 'olympiads:grade';

export type GradeOption = {
  name: string;
  href: string;
  key: string;
  icon?: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
    'aria-hidden'?: boolean | 'true' | 'false';
  }>;
  iconColor?: string;
};

export function getStoredGrade(): string | null {
  try {
    return window.localStorage.getItem(GRADE_STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

export function storeGrade(key: string): void {
  try {
    window.localStorage.setItem(GRADE_STORAGE_KEY, key);
  } catch (e) {
    // storage unavailable — selection just won't persist
  }
}

export default function GradeSwitcher({
  options,
}: {
  options: GradeOption[];
}): JSX.Element {
  const [selected, setSelected] = React.useState<string | null>(null);
  React.useEffect(() => {
    setSelected(getStoredGrade());
  }, []);
  const current = options.find(o => o.key === selected) ?? null;

  const choose = (o: GradeOption) => {
    storeGrade(o.key);
    setSelected(o.key);
    navigate(o.href);
  };

  return (
    <Menu as="div">
      {({ open }) => (
        <div className="relative">
          <Menu.Button className="group inline-flex items-center space-x-1 text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 focus:outline-none">
            <span>{current ? current.name : 'Избери ниво'}</span>
            <ChevronDownIcon
              className={`${
                open ? 'text-gray-500' : 'text-gray-400'
              } h-5 w-5 group-hover:text-gray-500`}
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
              className="origin-top-left absolute z-30 left-0 mt-2 w-64 rounded-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 shadow-lg focus:outline-none"
            >
              <div className="py-1">
                {options.map(o => (
                  <Menu.Item key={o.key}>
                    {({ active }) => (
                      <button
                        onClick={() => choose(o)}
                        className={classNames(
                          'w-full text-left flex items-center px-4 py-2 text-base font-medium leading-6 focus:outline-none',
                          active
                            ? 'bg-gray-100 text-gray-900 dark:text-gray-100 dark:bg-gray-700'
                            : 'text-gray-700 dark:text-gray-100'
                        )}
                      >
                        {o.icon && (
                          <o.icon
                            className="flex-shrink-0 h-5 w-5 mr-2"
                            style={{ color: o.iconColor }}
                            aria-hidden="true"
                          />
                        )}
                        {o.name}
                        {o.key === selected && (
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
