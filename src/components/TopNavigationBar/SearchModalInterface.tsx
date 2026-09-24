import { SearchIcon } from '@heroicons/react/solid';
import { Link, navigate } from 'gatsby';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useDebounce from '../../hooks/useDebounce';
import type { ProblemsIndexEntry } from '../../problems/index-node';
import {
  hasWordStartingWith,
  loadProblemsIndex,
  matchesAllTokens,
  normalizeSearchText,
  problemLink,
  problemSearchText,
  problemSourceLabel,
  searchTokens,
  subjectLabel,
} from '../ProblemsPage/problemSearch';

// Site search without an external service (it used to query Algolia, which
// was never configured for this site, so it never returned anything). Modules
// come from a static query in SearchModal; problems from the static index at
// /problems-data/index.json, fetched the first time the modal opens.

/** A module page, as the search modal lists it. */
export type SearchModule = {
  id: string;
  title: string;
  description: string;
  url: string;
  /** Label of the module's section ("Механика"). */
  section: string;
  /** Names of the chapters that list the module ("Кинематика"). */
  chapters: string[];
};

export interface SearchModalInterfaceProps {
  modules: SearchModule[];
  onClose: () => void;
}

const MAX_MODULES = 5;
const MAX_PROBLEMS = 8;

type Result = { key: string; href: string; internal: boolean };

function searchModules(modules: SearchModule[], tokens: string[]) {
  return modules
    .map(module => {
      const title = normalizeSearchText(module.title);
      const text = normalizeSearchText(
        [
          module.title,
          module.description,
          module.section,
          ...module.chapters,
        ].join(' ')
      );
      if (!matchesAllTokens(text, tokens)) return null;
      const score = tokens.filter(token =>
        hasWordStartingWith(title, token)
      ).length;
      return { module, score };
    })
    .filter((hit): hit is { module: SearchModule; score: number } => !!hit)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MODULES)
    .map(hit => hit.module);
}

/** Problems matching every token; those with the tokens in the name first. */
function searchProblems(problems: ProblemsIndexEntry[], tokens: string[]) {
  const hits: { problem: ProblemsIndexEntry; score: number; at: number }[] = [];
  problems.forEach((problem, at) => {
    if (!matchesAllTokens(problemSearchText(problem), tokens)) return;
    const name = normalizeSearchText(problem.name ?? '');
    const score = tokens.filter(token =>
      hasWordStartingWith(name, token)
    ).length;
    hits.push({ problem, score, at });
  });
  hits.sort((a, b) => b.score - a.score || a.at - b.at);
  return {
    total: hits.length,
    problems: hits.slice(0, MAX_PROBLEMS).map(hit => hit.problem),
  };
}

const SearchModalInterface: React.FC<SearchModalInterfaceProps> = ({
  modules,
  onClose,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');
  const [problems, setProblems] = React.useState<ProblemsIndexEntry[] | null>(
    null
  );
  const [loadFailed, setLoadFailed] = React.useState(false);
  // Keyboard selection: index into `results`, -1 = none (Enter then opens the
  // full results on /problems).
  const [active, setActive] = React.useState(-1);
  const itemRefs = React.useRef<(HTMLAnchorElement | null)[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    loadProblemsIndex()
      .then(data => {
        if (!cancelled) setProblems(data);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = query.trim();
  const tokens = React.useMemo(() => searchTokens(query), [query]);
  // The problem search goes over ~8k rows: let typing settle first.
  const problemQuery = useDebounce(query, 150);

  const moduleHits = React.useMemo(
    () => (tokens.length ? searchModules(modules, tokens) : []),
    [modules, tokens]
  );
  const problemHits = React.useMemo(() => {
    const problemTokens = searchTokens(problemQuery);
    if (!problems || !problemTokens.length) {
      return { total: 0, problems: [] };
    }
    return searchProblems(problems, problemTokens);
  }, [problems, problemQuery]);
  const problemsPending =
    tokens.length > 0 && !loadFailed && (!problems || problemQuery !== query);

  const allResultsURL = `/problems/?q=${encodeURIComponent(trimmed)}`;
  const results: Result[] = [
    ...moduleHits.map(module => ({
      key: `module-${module.id}`,
      href: module.url,
      internal: true,
    })),
    ...problemHits.problems.map(problem => ({
      key: `problem-${problem.uniqueId}`,
      ...problemLink(problem),
    })),
    ...(problemHits.total > 0
      ? [{ key: 'all-problems', href: allResultsURL, internal: true }]
      : []),
  ];
  const indexOf = (key: string) => results.findIndex(r => r.key === key);

  React.useEffect(() => setActive(-1), [query]);
  React.useEffect(() => {
    if (active >= 0) {
      itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);

  const open = (result: Result) => {
    if (result.internal) {
      onClose();
      navigate(result.href);
    } else {
      window.open(result.href, '_blank', 'noopener,noreferrer');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && results[active]) {
        open(results[active]);
      } else if (trimmed) {
        open({ key: 'all', href: allResultsURL, internal: true });
      }
    }
  };

  const itemClass = (key: string) =>
    `block py-3 px-5 transition hover:bg-blue-100 dark:hover:bg-gray-700 ${
      indexOf(key) === active ? 'bg-blue-100 dark:bg-gray-700' : ''
    }`;
  const itemRef = (key: string) => (el: HTMLAnchorElement | null) => {
    itemRefs.current[indexOf(key)] = el;
  };
  const heading = (text: string) => (
    <p className="px-5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {text}
    </p>
  );
  const note = (text: string) => (
    <p className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">{text}</p>
  );

  return (
    <div>
      <div className="flex items-center p-2">
        <input
          type="search"
          placeholder={t('search')}
          className="focus:outline-none focus:ring-0 text-gray-700 dark:bg-dark-surface dark:text-gray-200 dark:placeholder-gray-400 border-0 flex-1"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoFocus
        />
        <span className="p-2">
          <SearchIcon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
        </span>
      </div>
      {trimmed !== '' && (
        <div className="max-h-[20rem] sm:max-h-[40rem] overflow-y-auto border-t border-gray-200 dark:border-gray-700">
          {moduleHits.length > 0 && (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {heading('Модули')}
              {moduleHits.map(module => {
                const key = `module-${module.id}`;
                return (
                  <Link
                    to={module.url}
                    className={itemClass(key)}
                    key={key}
                    innerRef={itemRef(key)}
                    onClick={onClose}
                  >
                    <h3 className="text-gray-600 dark:text-gray-200 font-medium">
                      {module.title} - {module.section}
                    </h3>
                    <p className="text-sm leading-4 mt-1 text-gray-700 dark:text-gray-300">
                      {module.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {heading('Задачи')}
            {problemHits.problems.map(problem => {
              const key = `problem-${problem.uniqueId}`;
              const link = problemLink(problem);
              const body = (
                <>
                  <h3 className="text-gray-600 dark:text-gray-200 font-medium">
                    {problem.name}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {[
                      problemSourceLabel(problem),
                      problem.subject ? subjectLabel(problem.subject) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </>
              );
              return link.internal ? (
                <Link
                  to={link.href}
                  className={itemClass(key)}
                  key={key}
                  innerRef={itemRef(key)}
                  onClick={onClose}
                >
                  {body}
                </Link>
              ) : (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className={itemClass(key)}
                  key={key}
                  ref={itemRef(key)}
                >
                  {body}
                </a>
              );
            })}
            {problemHits.total > 0 && (
              <Link
                to={allResultsURL}
                className={`${itemClass(
                  'all-problems'
                )} text-sm font-medium text-blue-700 dark:text-blue-400`}
                innerRef={itemRef('all-problems')}
                onClick={onClose}
              >
                {`Всички ${problemHits.total} задачи за „${trimmed}“ →`}
              </Link>
            )}
            {loadFailed && note('Задачите не можаха да се заредят.')}
            {problemsPending &&
              problemHits.total === 0 &&
              note('Търсене в задачите…')}
            {!problemsPending &&
              !loadFailed &&
              problemHits.total === 0 &&
              note(
                moduleHits.length > 0
                  ? 'Няма намерени задачи.'
                  : `Няма резултати за „${trimmed}“.`
              )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchModalInterface;
