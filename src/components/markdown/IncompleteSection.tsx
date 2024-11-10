import * as React from 'react';
import Danger from './Danger';
import { useTranslation } from 'react-i18next';

export const IncompleteSection = ({
  children,
}: {
  children?: React.ReactNode;
}): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Danger title={t('incomplete-section')}>
      {t('incomplete-section-text')} {' '}
      <a
        href="https://github.com/cpinitiative/usaco-guide"
        target="_blank"
        rel="noreferrer"
      >
        GitHub
      </a>
      .{children && <div className="h-2 mb-0" />}
      {children}
    </Danger>
  );
};
