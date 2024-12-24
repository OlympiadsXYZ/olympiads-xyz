import { Menu } from '@headlessui/react';
import classNames from 'classnames';
import type { User } from 'firebase/auth';
import { Link } from 'gatsby';
import React from 'react';
import Transition from '../Transition';
import '../../i18n';
import { useTranslation } from 'react-i18next';
import { FaUser } from "react-icons/fa6";

export interface UserAvatarMenuProps {
  firebaseUser: User;
  onSignOut: () => void;
}

export const UserAvatarMenu: React.FC<UserAvatarMenuProps> = props => {
  const { t } = useTranslation();

  return (
    <Menu as="div" className="relative inline-block text-left">
      {({ open }) => (
        <>
          <div>
            <Menu.Button className="flex text-sm border-2 border-transparent rounded-full focus:outline-none dark:focus:border-white focus:border-blue-500 transition">
              <span className="sr-only">{t('user-avatar-menu_open-user-menu')}</span>
              {props.firebaseUser.photoURL && props.firebaseUser.photoURL.startsWith('https://') ? (
                <img
                  className="h-8 w-8 rounded-full"
                  src={props.firebaseUser.photoURL}
                  loading="lazy"
                  decoding="async"
                  alt="User avatar"
                />
              ) : (
                <FaUser className="h-8 w-8 p-1 rounded-full bg-gray-200 dark:bg-gray-700" />
              )}
            </Menu.Button>
          </div>

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
              className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 focus:outline-none"
            >
              <div className="py-1">
                <Menu.Item>
                  {({ active }) => (
                    <Link
                      to="/settings"
                      className={classNames(
                        active && 'bg-gray-100 dark:bg-gray-700',
                        'block w-full text-left px-4 py-2 text-sm leading-5 text-gray-700 dark:text-gray-100 focus:outline-none'
                      )}
                    >
                      {t('top-nav_settings')}
                    </Link>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={() => {
                        props.onSignOut();
                      }}
                      className={classNames(
                        active && 'bg-gray-100 dark:bg-gray-700',
                        'block w-full text-left px-4 py-2 text-sm leading-5 text-gray-700 dark:text-gray-100 focus:outline-none'
                      )}
                      role="menuitem"
                    >
                      {t('user-avatar-menu_sign-out')}
                    </button>
                  )}
                </Menu.Item>
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  );
};
