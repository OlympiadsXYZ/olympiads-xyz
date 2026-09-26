import { PageProps } from 'gatsby';
import React from 'react';
import { useTranslation } from 'react-i18next';
import Layout from '../components/layout';
import ProblemHits from '../components/ProblemsPage/ProblemHits';
import {
  DEFAULT_SORT,
  DIFFICULTY_ORDER,
  ProblemSort,
  SORT_OPTIONS,
  SUBJECT_ORDER,
  competitionChipLabel,
  competitionLabel,
  loadProblemsIndex,
  matchesAllTokens,
  parseProblemsUrl,
  problemDifficulty,
  problemSearchText,
  resultsCountLabel,
  problemsUrlSearch,
  searchTokens,
  sortProblems,
  subjectLabel,
  tagLabel,
} from '../components/ProblemsPage/problemSearch';
import SearchBox from '../components/ProblemsPage/SearchBox';
import Selection, {
  SelectionOption,
} from '../components/ProblemsPage/Selection';
import SEO from '../components/seo';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import { useUserProgressOnProblems } from '../context/UserDataContext/properties/userProgress';
import useDebounce from '../hooks/useDebounce';
import { PROBLEM_PROGRESS_OPTIONS, ProblemProgress } from '../models/problem';
import type { ProblemsIndexEntry } from '../problems/index-node';
import '../i18n';

// The problems come from the static index written at build time by
// gatsby-node (see src/problems/index-node.ts), loaded through
// loadProblemsIndex(). This page used to query Algolia, which was never
// configured for this project, so it always rendered zero problems.

type Filters = { [attribute: string]: string[] };

const HITS_PER_PAGE_OPTIONS = [24, 32, 48];

// No counts here: the page's meta description is fixed at build time, and a
// number written into it would go stale with the next tranche of problems.
const PAGE_DESCRIPTION =
  'Задачи от олимпиади и състезания по физика, астрономия, химия и география — условията дословно, както са отпечатани, с официалните решения, където ги има. Търсене и филтри по предмет, състезание, година и трудност.';

const uniqueSorted = (values: string[], order?: string[]): string[] => {
  const out = [...new Set(values.filter(Boolean))];
  if (order) {
    return out.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    });
  }
  return out.sort((a, b) => a.localeCompare(b));
};

const toOptions = (values: string[]): SelectionOption[] =>
  values.map(value => ({ label: value, value }));

/**
 * One option per distinct label; values that share a label (e.g. the tags
 * "Optics" and "Оптика") become a single option selecting all of them.
 */
const toLabelledOptions = (
  values: string[],
  label: (value: string) => string
): SelectionOption[] => {
  const byLabel = new Map<string, string[]>();
  uniqueSorted(values).forEach(value => {
    const key = label(value);
    byLabel.set(key, [...(byLabel.get(key) ?? []), value]);
  });
  return [...byLabel.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'bg'))
    .map(([key, group]) => ({
      label: key,
      value: group.length === 1 ? group[0] : group,
    }));
};

export default function ProblemsPage({ location }: PageProps) {
  const { t } = useTranslation();
  const userProgress = useUserProgressOnProblems();

  const [problems, setProblems] = React.useState<ProblemsIndexEntry[] | null>(
    null
  );
  const [searchTerm, setSearchTerm] = React.useState('');
  const query = useDebounce(searchTerm, 200);
  const [filters, setFilters] = React.useState<Filters>({});
  const [sort, setSort] = React.useState<ProblemSort>(DEFAULT_SORT);
  const [page, setPage] = React.useState(0);
  const [hitsPerPage, setHitsPerPage] = React.useState(
    HITS_PER_PAGE_OPTIONS[0]
  );
  // phones: the facets fold behind one button, so the list starts on screen
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const resultsRef = React.useRef<HTMLDivElement>(null);

  // The search term, facets, order and page live in the URL
  // (/problems/?q=…&subject=physics&year=2019&page=3): a reload, a shared link
  // or Back restores the list. Re-read on every navigation, including to the
  // same URL from this page (the search modal's "all results" link).
  React.useEffect(() => {
    const state = parseProblemsUrl(location?.search ?? '');
    setSearchTerm(state.q);
    setFilters(state.filters);
    setSort(state.sort);
    setPage(state.page);
    setHitsPerPage(
      state.perPage && HITS_PER_PAGE_OPTIONS.includes(state.perPage)
        ? state.perPage
        : HITS_PER_PAGE_OPTIONS[0]
    );
  }, [location?.search, location?.key]);

  React.useEffect(() => {
    let cancelled = false;
    loadProblemsIndex()
      .then(data => {
        if (cancelled) return;
        setProblems(data);
      })
      .catch(() => {
        // Missing or malformed index: render the empty state, don't crash.
        if (cancelled) return;
        setProblems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = problems ?? [];

  const progressLabels: { [key in ProblemProgress]: string } = {
    'Not Attempted': t('not-attempted'),
    Solving: t('solving'),
    Solved: t('solved'),
    Reviewing: t('reviewing'),
    Skipped: t('skipped'),
    Ignored: t('ignored'),
  };

  // Competitions by subject (in SUBJECT_ORDER), then by number of problems:
  // the facet's order and the order of competitions within a year.
  const competitionOrder = React.useMemo(() => {
    const competitionCount = new Map<string, number>();
    const competitionSubject = new Map<string, string>();
    all.forEach(p => {
      if (!p.competition) return;
      competitionCount.set(
        p.competition,
        (competitionCount.get(p.competition) ?? 0) + 1
      );
      if (p.subject && !competitionSubject.has(p.competition)) {
        competitionSubject.set(p.competition, p.subject);
      }
    });
    const subjectRank = (subject: string | undefined) => {
      const i = SUBJECT_ORDER.indexOf(subject ?? '');
      return i === -1 ? SUBJECT_ORDER.length : i;
    };
    return [...competitionCount.keys()].sort(
      (a, b) =>
        subjectRank(competitionSubject.get(a)) -
          subjectRank(competitionSubject.get(b)) ||
        (competitionCount.get(b) ?? 0) - (competitionCount.get(a) ?? 0) ||
        a.localeCompare(b)
    );
  }, [problems]);

  const selectionMetadata = React.useMemo(() => {
    const years = [
      ...new Set(
        all.map(p => p.year).filter((y): y is number => typeof y === 'number')
      ),
    ].sort((a, b) => b - a);
    return [
      {
        attribute: 'subject',
        placeholder: 'Предмет',
        searchable: false,
        isMulti: true,
        items: uniqueSorted(
          all.map(p => p.subject ?? ''),
          SUBJECT_ORDER
        ).map(subject => ({ label: subjectLabel(subject), value: subject })),
      },
      {
        attribute: 'competition',
        placeholder: 'Състезание',
        searchable: true,
        isMulti: true,
        items: competitionOrder.map(code => ({
          label: competitionLabel(code),
          chipLabel: competitionChipLabel(code),
          value: code,
        })),
      },
      {
        attribute: 'year',
        placeholder: 'Година',
        searchable: true,
        isMulti: true,
        items: years.map(year => ({
          label: String(year),
          value: String(year),
        })),
      },
      {
        // one scale for every problem: an estimated level where the
        // classification has one, else the recorded difficulty
        attribute: 'difficulty',
        placeholder: t('difficulty'),
        searchable: false,
        isMulti: true,
        items: toOptions(
          uniqueSorted(all.map(problemDifficulty), DIFFICULTY_ORDER)
        ),
      },
      {
        attribute: 'tags',
        placeholder: t('tags'),
        searchable: true,
        isMulti: true,
        items: toLabelledOptions(
          all.flatMap(p => p.tags ?? []),
          tagLabel
        ),
      },
      {
        attribute: 'fields',
        placeholder: t('classification-fields', { defaultValue: 'Област' }),
        searchable: true,
        isMulti: true,
        items: toOptions(uniqueSorted(all.flatMap(p => p.fields ?? []))),
      },
      {
        attribute: 'isStarred',
        placeholder: t('starred'),
        searchable: false,
        isMulti: false,
        items: [
          { label: t('yes'), value: 'true' },
          { label: t('no'), value: 'false' },
        ],
      },
      {
        attribute: 'progress',
        placeholder: t('status'),
        searchable: false,
        isMulti: true,
        items: PROBLEM_PROGRESS_OPTIONS.map(progress => ({
          label: progressLabels[progress],
          value: progress as string,
        })),
      },
    ];
  }, [problems, competitionOrder, t]);

  const matches = React.useMemo(() => {
    const tokens = searchTokens(query);
    const sets: { [attribute: string]: Set<string> } = {};
    Object.keys(filters).forEach(attribute => {
      if (filters[attribute]?.length) {
        sets[attribute] = new Set(filters[attribute]);
      }
    });
    const found = all.filter(problem => {
      if (
        tokens.length &&
        !matchesAllTokens(problemSearchText(problem), tokens)
      ) {
        return false;
      }
      if (sets['subject'] && !sets['subject'].has(problem.subject ?? '')) {
        return false;
      }
      if (
        sets['competition'] &&
        !sets['competition'].has(problem.competition ?? '')
      ) {
        return false;
      }
      if (sets['year'] && !sets['year'].has(String(problem.year ?? ''))) {
        return false;
      }
      if (
        sets['difficulty'] &&
        !sets['difficulty'].has(problemDifficulty(problem))
      ) {
        return false;
      }
      if (
        sets['fields'] &&
        !(problem.fields ?? []).some(field => sets['fields'].has(field))
      ) {
        return false;
      }
      if (
        sets['tags'] &&
        !(problem.tags ?? []).some(tag => sets['tags'].has(tag))
      ) {
        return false;
      }
      if (
        sets['isStarred'] &&
        !sets['isStarred'].has(String(!!problem.isStarred))
      ) {
        return false;
      }
      if (
        sets['progress'] &&
        !sets['progress'].has(userProgress[problem.uniqueId] ?? 'Not Attempted')
      ) {
        return false;
      }
      return true;
    });
    const rank = new Map(competitionOrder.map((code, i) => [code, i]));
    return sortProblems(
      found,
      sort,
      code => rank.get(code ?? '') ?? competitionOrder.length
    );
  }, [problems, query, filters, sort, userProgress, competitionOrder]);

  const pageCount = Math.max(1, Math.ceil(matches.length / hitsPerPage));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = matches.slice(
    currentPage * hitsPerPage,
    (currentPage + 1) * hitsPerPage
  );

  // State → URL. Only once the index is in: until then the page number
  // cannot be checked against the page count. replaceState keeps Gatsby's
  // history entry (its scroll restoration key) and adds no Back steps.
  React.useEffect(() => {
    if (problems === null || typeof window === 'undefined') return;
    const search = problemsUrlSearch({
      q: searchTerm,
      filters,
      sort,
      page: currentPage,
      perPage: hitsPerPage === HITS_PER_PAGE_OPTIONS[0] ? null : hitsPerPage,
    });
    if (search === window.location.search) return;
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + search + window.location.hash
    );
  }, [problems, searchTerm, filters, sort, currentPage, hitsPerPage]);

  const selectedCount = Object.values(filters).reduce(
    (n, values) => n + (values?.length ? 1 : 0),
    0
  );

  // Any change to the result set puts you back on the first page.
  const updateFilters = (attribute: string, values: string[]) => {
    setFilters(prev => ({ ...prev, [attribute]: values }));
    setPage(0);
  };
  const goToPage = (next: number) => {
    setPage(next);
    const results = resultsRef.current;
    if (results && results.getBoundingClientRect().top < 0) {
      results.scrollIntoView({ block: 'start' });
    }
  };

  const pageButtons: number[] = [];
  for (
    let i = Math.max(0, currentPage - 3);
    i < Math.min(pageCount, Math.max(0, currentPage - 3) + 7);
    i++
  ) {
    pageButtons.push(i);
  }

  const pageButtonClass = (active: boolean) =>
    `px-3 py-1 mx-0.5 rounded text-sm ${
      active
        ? 'bg-blue-600 text-white'
        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-dark-high-emphasis hover:bg-gray-200 dark:hover:bg-gray-800'
    } disabled:opacity-40 disabled:cursor-default`;
  const controlClass =
    'rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-dark-high-emphasis text-sm pl-2 pr-8 py-1';

  return (
    <Layout>
      <SEO
        title={t('problems_all-problems-title')}
        description={PAGE_DESCRIPTION}
      />

      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <main>
          <div className="py-8 sm:py-16 bg-blue-600 dark:bg-blue-900 px-5">
            <div className="max-w-3xl mx-auto sm:mb-6">
              <h1 className="text-center text-3xl sm:text-5xl font-bold text-white dark:text-dark-high-emphasis mb-4 sm:mb-6">
                {t('problems_title')}
              </h1>
              <SearchBox
                value={searchTerm}
                onChange={value => {
                  setSearchTerm(value);
                  setPage(0);
                }}
              />
            </div>
          </div>
          <div className="pt-3 px-4 sm:px-9 pb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 md:hidden">
              <button
                type="button"
                aria-expanded={filtersOpen}
                aria-controls="problems-filters"
                onClick={() => setFiltersOpen(open => !open)}
                className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-800 dark:text-dark-high-emphasis focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <svg
                  className="mr-1.5 h-4 w-4 text-gray-500 dark:text-gray-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z"
                    clipRule="evenodd"
                  />
                </svg>
                {selectedCount > 0 ? `Филтри (${selectedCount})` : 'Филтри'}
              </button>
            </div>
            <div
              id="problems-filters"
              className={`${
                filtersOpen ? 'grid' : 'hidden'
              } md:grid mb-4 items-start grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-3`}
            >
              {selectionMetadata.map(props => (
                <div
                  className="min-w-0 tw-forms-disable-all-descendants"
                  key={props.attribute}
                >
                  <Selection
                    {...props}
                    selected={filters[props.attribute] ?? []}
                    onChange={values => updateFilters(props.attribute, values)}
                  />
                </div>
              ))}
            </div>
            <div
              ref={resultsRef}
              className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
            >
              <p
                className="min-h-[1.25rem] text-sm font-medium text-gray-700 dark:text-dark-high-emphasis"
                aria-live="polite"
              >
                {problems === null ? null : resultsCountLabel(matches, all)}
                {selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilters({});
                      setPage(0);
                    }}
                    className="ml-3 text-blue-700 hover:underline dark:text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
                  >
                    Изчисти филтрите
                  </button>
                )}
              </p>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-high-emphasis">
                <span>Подреди:</span>
                <select
                  className={controlClass}
                  value={sort}
                  onChange={e => {
                    setSort(e.target.value as ProblemSort);
                    setPage(0);
                  }}
                >
                  {SORT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {problems === null ? (
              <p className="text-gray-500 dark:text-dark-med-emphasis text-center py-8">
                …
              </p>
            ) : (
              <ProblemHits problems={visible} query={query} />
            )}
            {problems !== null && matches.length > 0 && (
              <nav
                aria-label="Страници"
                className="mt-4 flex flex-wrap justify-center items-center gap-y-2"
              >
                <div className="flex flex-wrap items-center">
                  <button
                    type="button"
                    aria-label="Първа страница"
                    className={pageButtonClass(false)}
                    disabled={currentPage === 0}
                    onClick={() => goToPage(0)}
                  >
                    «
                  </button>
                  <button
                    type="button"
                    aria-label="Предишна страница"
                    className={pageButtonClass(false)}
                    disabled={currentPage === 0}
                    onClick={() => goToPage(currentPage - 1)}
                  >
                    ‹
                  </button>
                  {pageButtons.map(i => (
                    <button
                      type="button"
                      key={i}
                      aria-current={i === currentPage ? 'page' : undefined}
                      className={`hidden sm:inline-block ${pageButtonClass(
                        i === currentPage
                      )}`}
                      onClick={() => goToPage(i)}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="Следваща страница"
                    className={pageButtonClass(false)}
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => goToPage(currentPage + 1)}
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    aria-label="Последна страница"
                    className={pageButtonClass(false)}
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => goToPage(pageCount - 1)}
                  >
                    »
                  </button>
                </div>
                <span className="mx-3 text-sm tabular-nums text-gray-700 dark:text-dark-high-emphasis">
                  стр. {currentPage + 1} от {pageCount}
                </span>
                <select
                  aria-label="Задачи на страница"
                  className={controlClass}
                  value={hitsPerPage}
                  onChange={e => {
                    setHitsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                >
                  {HITS_PER_PAGE_OPTIONS.map(n => (
                    <option key={n} value={n}>
                      {`${n} ${t('problems_items-per-page')}`}
                    </option>
                  ))}
                </select>
              </nav>
            )}
          </div>
        </main>
      </div>
    </Layout>
  );
}
