import { Link } from 'gatsby';
import * as React from 'react';
import MODULE_ORDERING from '../../../content/ordering';
import { useMarkdownLayout } from '../../context/MarkdownLayoutContext';
import { ProblemSolutionContext } from '../../context/ProblemSolutionContext';
import { MarkdownLayoutSidebarModuleLinkInfo } from '../../models/module';
import { SolutionInfo } from '../../models/solution';
import type { ProblemNeighbour } from '../../problems/page-links';
import Breadcrumbs from './Breadcrumbs';
import { useTranslation } from 'react-i18next';

const ChevronLeft = () => (
  <svg
    className="flex-shrink-0 -ml-0.5 mr-1 h-4 w-4"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    stroke="currentColor"
    aria-hidden="true"
  >
    <path d="M15 19l-7-7 7-7" />
  </svg>
);
const ChevronRight = () => (
  <svg
    className="flex-shrink-0 -mr-0.5 ml-1 h-4 w-4"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    stroke="currentColor"
    aria-hidden="true"
  >
    <path d="M9 5l7 7-7 7" />
  </svg>
);

/**
 * Previous / next problem on a problem page, in the sidebar tree's order
 * (gatsby-node → src/problems/page-links.ts): the neighbour's label, with its
 * paper when that is another paper of the year.
 */
function ProblemNeighbourLink({
  neighbour,
  direction,
}: {
  neighbour: ProblemNeighbour | null | undefined;
  direction: 'prev' | 'next';
}) {
  const { t } = useTranslation();
  const heading = direction === 'prev' ? t('prev_problem') : t('next_problem');
  if (!neighbour) return <span className="flex-1 min-w-0" />;
  const title = neighbour.paper
    ? `${neighbour.paper} · ${neighbour.label}`
    : neighbour.label;
  return (
    <Link
      to={neighbour.url}
      rel={direction}
      title={title}
      className={`group flex-1 min-w-0 flex flex-col rounded-md px-3 py-2 text-sm leading-5 transition hover:bg-gray-50 dark:hover:bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        direction === 'prev'
          ? '-ml-3 items-start text-left'
          : '-mr-3 items-end text-right'
      }`}
    >
      <span className="inline-flex items-center text-xs font-medium text-gray-500 dark:text-dark-med-emphasis">
        {direction === 'prev' && <ChevronLeft />}
        {heading}
        {direction === 'next' && <ChevronRight />}
      </span>
      <span className="max-w-full truncate font-medium text-gray-800 group-hover:text-blue-700 dark:text-dark-high-emphasis dark:group-hover:text-blue-400">
        {neighbour.label}
      </span>
      {neighbour.paper && (
        <span className="max-w-full truncate text-xs text-gray-500 dark:text-dark-med-emphasis">
          {neighbour.paper}
        </span>
      )}
    </Link>
  );
}

const NavBar = ({ alignNavButtonsRight = true }) => {
  const { t } = useTranslation();
  const moduleLayoutInfo = useMarkdownLayout();
  const { markdownLayoutInfo, sidebarLinks } = moduleLayoutInfo;
  // null on module pages
  const problemSolution = React.useContext(ProblemSolutionContext);

  const sortedModuleLinks = React.useMemo(() => {
    if (markdownLayoutInfo instanceof SolutionInfo) return undefined;
    const links: MarkdownLayoutSidebarModuleLinkInfo[] = [];
    for (const group of MODULE_ORDERING[markdownLayoutInfo.section]) {
      for (const id of group.items) {
        const link = sidebarLinks.find(x => x.id === id);
        if (link) links.push(link);
      }
    }
    return links;
  }, [sidebarLinks]);
  const moduleIdx = React.useMemo(
    () => sortedModuleLinks?.findIndex(x => x.id === markdownLayoutInfo.id),
    [markdownLayoutInfo, sortedModuleLinks]
  ) as number;
  if (markdownLayoutInfo instanceof SolutionInfo) {
    if (!problemSolution?.prev && !problemSolution?.next) return null;
    return (
      <nav
        aria-label={`${t('prev_problem')} / ${t('next_problem')}`}
        className="flex items-stretch gap-4"
      >
        <ProblemNeighbourLink
          neighbour={problemSolution?.prev}
          direction="prev"
        />
        <ProblemNeighbourLink
          neighbour={problemSolution?.next}
          direction="next"
        />
      </nav>
    );
  }
  //why the frick was !moduleIdx part of the condition???
  if (!sortedModuleLinks) {
    return null;
  }
  const prevModule = moduleIdx === 0 ? null : sortedModuleLinks[moduleIdx - 1];
  const nextModule =
    moduleIdx === sortedModuleLinks.length - 1
      ? null
      : sortedModuleLinks[moduleIdx + 1];

  const disabledClasses =
    'text-gray-200 pointer-events-none dark:text-dark-disabled-emphasis';
  const activeClasses =
    'text-gray-500 hover:text-gray-800 dark:text-dark-med-emphasis dark:hover:text-dark-high-emphasis transition';
  return (
    <div
      className={`flex ${
        alignNavButtonsRight ? 'sm:justify-between' : 'justify-between'
      }`}
    >
      {alignNavButtonsRight && <div className="flex-1 sm:hidden" />}
      <span className="-ml-4 rounded-md">
        <Link
          to={prevModule === null ? markdownLayoutInfo.url : prevModule.url}
          className={
            'inline-flex items-center px-4 py-2 text-sm leading-5 font-medium rounded-md ' +
            (prevModule === null ? disabledClasses : activeClasses)
          }
        >
          <svg
            className="-ml-0.5 mr-1 h-4 w-4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
          {t('prev')}
        </Link>
      </span>
      <div className="hidden sm:flex items-center">
        <Breadcrumbs />
      </div>
      <span className="rounded-md -mr-4">
        <Link
          to={nextModule === null ? markdownLayoutInfo.url : nextModule.url}
          className={
            'inline-flex items-center px-4 py-2 text-sm leading-5 font-medium rounded-md ' +
            (nextModule === null ? disabledClasses : activeClasses)
          }
        >
          {t('next')}
          <svg
            className="-mr-0.5 ml-1 h-4 w-4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </span>
    </div>
  );
};

export default NavBar;
