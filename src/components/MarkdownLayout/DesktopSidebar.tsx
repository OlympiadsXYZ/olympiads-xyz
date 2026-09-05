import { Link } from 'gatsby';
import * as React from 'react';
import Logo from '../Logo';
import SidebarBottomButtons from './SidebarBottomButtons';
import { SidebarNav } from './SidebarNav/SidebarNav';
import { useSidebarContent } from './useSidebarContent';

export default function DesktopSidebar() {
  const sidebarContent = useSidebarContent();
  return (
    <div
      className="hidden lg:block fixed z-10 top-0 left-0 bottom-0"
      style={{ width: '20rem' }}
    >
      <div
        className="border-r border-gray-200 bg-white dark:bg-dark-surface dark:border-gray-800 h-screen flex flex-col"
        style={{ width: '20rem' }}
      >
        <div className="flex-grow h-0 flex flex-col pt-5">
          <Link
            className="flex items-center flex-shrink-0 px-4 pb-2"
            to="/dashboard/"
          >
            <Logo />
          </Link>
          {/* Module pages: the handbook nav; problem pages: the problems tree */}
          {sidebarContent ?? <SidebarNav />}
        </div>
        <SidebarBottomButtons />
      </div>
    </div>
  );
}
