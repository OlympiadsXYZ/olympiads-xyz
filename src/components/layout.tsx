import * as React from 'react';
import { useAnalyticsEffect } from '../hooks/useAnalyticsEffect';
import { useUpdateStreakEffect } from '../hooks/useUpdateStreakEffect';
import Footer from './Footer';

const Layout = ({
  children,
  setLastViewedModule,
  footer = 'default',
}: {
  children?: React.ReactNode;
  /**
   * If specified, in addition to updating number of pageviews,
   * we will also update lastViewedModule
   */
  setLastViewedModule?: string;
  /**
   * The site footer: 'sidebar' shifts it clear of the fixed sidebar of module
   * and problem pages, 'none' leaves it out (the full-screen editor).
   */
  footer?: 'default' | 'sidebar' | 'none';
}): JSX.Element => {
  useAnalyticsEffect();
  useUpdateStreakEffect({ setLastViewedModule });
  return (
    <div className="font-sans">
      {children}
      {footer !== 'none' && <Footer sidebarOffset={footer === 'sidebar'} />}
    </div>
  );
};

export default Layout;
