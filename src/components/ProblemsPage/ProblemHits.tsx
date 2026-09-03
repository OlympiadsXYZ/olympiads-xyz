import { Link } from 'gatsby';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { moduleIDToSectionMap } from '../../../content/ordering';
import { ConfettiProvider } from '../../context/ConfettiContext';
import {
  useHideDifficultySetting,
  useHideModulesSetting,
  useShowTagsSetting,
} from '../../context/UserDataContext/properties/simpleProperties';
import { ProblemDifficulty, ProblemInfo } from '../../models/problem';
import type { ProblemsIndexEntry } from '../../problems/index-node';
import DifficultyBox from '../DifficultyBox';
import Info from '../markdown/Info';
import ProblemStatusCheckbox from '../markdown/ProblemsList/ProblemStatusCheckbox';

/**
 * Renders `text`, with every case-insensitive occurrence of `query` marked.
 * Replaces Algolia's <Highlight>, which needs a search-response hit.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const haystack = text.toLowerCase();
  const lowered = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(lowered, from);
    if (at === -1) break;
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark
        key={at}
        className="bg-transparent text-current font-semibold underline"
      >
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  if (parts.length === 0) return <>{text}</>;
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export function ProblemHit({
  problem,
  query = '',
}: {
  problem: ProblemsIndexEntry;
  query?: string;
}) {
  const hideDifficulty = useHideDifficultySetting();
  const showTags = useShowTagsSetting();
  const hideModules = useHideModulesSetting();
  const { t } = useTranslation();
  const solution = problem.solution;
  // A transcribed problem's own page (statement, figures, official solution)
  // is the primary destination; the source PDF becomes the secondary link.
  const internalURL =
    solution?.kind === 'internal' ? `${problem.problemURL}/solution` : null;
  const solutionURL = solution?.kind === 'link' ? solution.url : null;
  return (
    <div className="bg-white dark:bg-gray-900 shadow p-4 sm:p-6 rounded-lg ">
      <div className="flex flex-row justify-between w-full">
        <span>
          <span className="text-blue-700 dark:text-blue-400 font-medium text-sm">
            {problem.source}
          </span>
          <p className="text-xl leading-6 mt-1 mb-2">
            {internalURL ? (
              <Link to={internalURL} className="hover:underline">
                <Highlighted text={problem.name} query={query} />
              </Link>
            ) : (
              <a
                href={problem.url}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                <Highlighted text={problem.name} query={query} />
              </a>
            )}
            {problem.isStarred && (
              <svg
                className="h-6 w-4 text-blue-400 ml-2 pb-1 inline-block"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            )}
          </p>
        </span>
        <ConfettiProvider>
          <ProblemStatusCheckbox
            problem={problem as unknown as ProblemInfo}
            size="large"
          />
        </ConfettiProvider>
      </div>

      {(internalURL || solutionURL) && (
        <a
          href={internalURL ? problem.url : (solutionURL as string)}
          target="_blank"
          rel="noreferrer"
          className="text-gray-500 dark:text-dark-med-emphasis text-sm"
        >
          {internalURL ? t('original-pdf') : t('view-solution')}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 inline ml-0.5 mb-1"
          >
            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
          </svg>
        </a>
      )}
      {!hideModules && problem.problemModules.length > 0 && (
        <>
          <p className="text-sm text-gray-500 dark:text-dark-med-emphasis  mt-2">
            {t('appears-in')}:
          </p>
          <ul className="list-disc ml-6">
            {problem.problemModules.map(
              ({ id: moduleID, title: moduleLabel }) => (
                <li key={moduleID}>
                  {moduleIDToSectionMap[moduleID] ? (
                    <Link
                      to={`/${moduleIDToSectionMap[moduleID]}/${moduleID}/#problem-${problem.uniqueId}`}
                      className="text-sm text-blue-600 dark:text-blue-400"
                    >
                      {moduleLabel}
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-500 dark:text-dark-med-emphasis">
                      {moduleLabel}
                    </span>
                  )}
                </li>
              )
            )}
          </ul>
        </>
      )}

      <div className="pt-4">
        {!hideDifficulty && (
          <DifficultyBox difficulty={problem.difficulty as ProblemDifficulty} />
        )}
        {showTags &&
          problem.tags?.map(tag => (
            <span
              className="mr-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium leading-4 bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-dark-high-emphasis"
              key={tag}
            >
              {tag}
            </span>
          ))}
      </div>
    </div>
  );
}

export default function ProblemHits({
  problems,
  query = '',
}: {
  problems: ProblemsIndexEntry[];
  query?: string;
}) {
  const { t } = useTranslation();
  if (!problems.length) {
    return (
      <Info title={t('no-problems-found')}>
        {t('no-problems-found-description')}
      </Info>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {problems.map(problem => (
        <ProblemHit problem={problem} query={query} key={problem.uniqueId} />
      ))}
    </div>
  );
}
