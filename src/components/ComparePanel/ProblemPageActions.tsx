import { FlagIcon, ViewBoardsIcon } from '@heroicons/react/solid';
import classNames from 'classnames';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useProblemSolutions } from '../../context/ProblemSolutionContext';
import { COMPARE_MEDIA_QUERY, useComparePanel } from './ComparePanelContext';
import { pdfFileName } from './ComparePanel';

/**
 * Actions in a problem page's top box, next to "Оригинал на условието (PDF)".
 * Both need ProblemSolutionContext, and the toggle needs ComparePanelProvider,
 * so they are only rendered on problem pages (solutionTemplate).
 */

const actionClass =
  'text-sm font-medium my-0 group inline-flex items-center space-x-1.5 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 dark:focus-visible:ring-offset-gray-900 focus-visible:ring-blue-500';
const idleClass =
  'text-gray-800 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100';
const iconClass =
  'h-5 w-5 text-gray-400 group-hover:text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-300';

/**
 * Toggles the side-by-side PDF panel. Below the md breakpoint there is no room
 * for a split view, so the button opens the problems PDF in a new tab instead.
 */
export function CompareToggleButton(): JSX.Element {
  const { t } = useTranslation();
  const { problem } = useProblemSolutions();
  const compare = useComparePanel();

  const onClick = () => {
    if (window.matchMedia(COMPARE_MEDIA_QUERY).matches) {
      compare.toggle();
    } else {
      window.open(problem.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={compare.isSplit}
      className={classNames(
        actionClass,
        compare.isSplit
          ? 'text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
          : idleClass
      )}
    >
      <span>{t('compare_with_original')}</span>
      <ViewBoardsIcon
        className={classNames(
          'h-5 w-5',
          compare.isSplit
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-gray-400 group-hover:text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-300'
        )}
        aria-hidden="true"
      />
    </button>
  );
}

const ISSUES_NEW_URL =
  'https://github.com/OlympiadsXYZ/olympiads-xyz/issues/new';
const MAX_ISSUE_URL_LENGTH = 1500;

export function buildIssueUrl({
  pageUrl,
  uniqueId,
  problemsPdf,
  solutionsPdf,
}: {
  pageUrl: string | null;
  uniqueId: string;
  problemsPdf: string;
  solutionsPdf?: string;
}): string {
  type Format = (url: string) => string;
  const build = (problems: Format, solutions: Format) => {
    const lines = [
      ...(pageUrl ? [`Страница: ${pageUrl}`] : []),
      `Задача: ${uniqueId}`,
      `Условие (PDF): ${problems(problemsPdf)}`,
      ...(solutionsPdf ? [`Решения (PDF): ${solutions(solutionsPdf)}`] : []),
      '',
      'Какво не съвпада с оригинала?',
      '- [ ] условие',
      '- [ ] отговор',
      '- [ ] решение',
      '- [ ] фигура',
      '- [ ] точки',
      '',
      'Описание:',
      '',
    ];
    const params = new URLSearchParams({
      title: `Задача: ${uniqueId}`,
      body: lines.join('\n'),
    });
    return `${ISSUES_NEW_URL}?${params.toString()}`;
  };
  // Percent-encoded Cyrillic archive paths triple in size once URL-encoded
  // again, so decode them first. If the result is still too long, shorten the
  // solutions PDF to its file name (it sits next to the problems PDF), then
  // both.
  const decoded: Format = url => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  };
  const attempts: [Format, Format][] = [
    [decoded, decoded],
    [decoded, pdfFileName],
    [pdfFileName, pdfFileName],
  ];
  for (const [problems, solutions] of attempts) {
    const href = build(problems, solutions);
    if (href.length <= MAX_ISSUE_URL_LENGTH) return href;
  }
  return build(pdfFileName, pdfFileName);
}

/**
 * "Съобщи за грешка": opens a prefilled GitHub issue for this problem — page
 * URL, problem id, PDF URL(s) and a what-is-wrong checklist.
 */
export function ReportIssueLink(): JSX.Element {
  const { t } = useTranslation();
  const { problem } = useProblemSolutions();
  // window.location is only known on the client
  const [pageUrl, setPageUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    setPageUrl(window.location.origin + window.location.pathname);
  }, []);

  const href = buildIssueUrl({
    pageUrl,
    uniqueId: problem.uniqueId,
    problemsPdf: problem.url,
    solutionsPdf: problem.solutionUrl,
  });

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={classNames(actionClass, idleClass)}
    >
      <span>{t('report_issue')}</span>
      <FlagIcon className={iconClass} aria-hidden="true" />
    </a>
  );
}
