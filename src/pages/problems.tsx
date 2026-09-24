import { PageProps } from 'gatsby';
import React from 'react';
import { useTranslation } from 'react-i18next';
import Layout from '../components/layout';
import ProblemHits from '../components/ProblemsPage/ProblemHits';
import {
  SUBJECT_ORDER,
  competitionLabel,
  loadProblemsIndex,
  matchesAllTokens,
  problemSearchText,
  problemSourceLabel,
  searchTokens,
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

const DIFFICULTY_ORDER = [
  'Very Easy',
  'Easy',
  'Normal',
  'Hard',
  'Very Hard',
  'Insane',
  'N/A',
];

type Filters = { [attribute: string]: string[] };

const HITS_PER_PAGE_OPTIONS = [24, 32, 48];

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
  const [page, setPage] = React.useState(0);
  const [hitsPerPage, setHitsPerPage] = React.useState(
    HITS_PER_PAGE_OPTIONS[0]
  );

  // /problems/?q=… (e.g. from the search modal) starts with that search term.
  // Re-read on every navigation, including to the same URL from this page.
  React.useEffect(() => {
    setSearchTerm(new URLSearchParams(location?.search ?? '').get('q') ?? '');
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

  const selectionMetadata = React.useMemo(() => {
    // Competitions by subject (in SUBJECT_ORDER), then by number of problems.
    const competitionCount = new Map<string, number>();
    const competitionSubject = new Map<string, string>();
    const sourceLabels = new Map<string, string>();
    all.forEach(p => {
      if (p.competition) {
        competitionCount.set(
          p.competition,
          (competitionCount.get(p.competition) ?? 0) + 1
        );
        if (p.subject && !competitionSubject.has(p.competition)) {
          competitionSubject.set(p.competition, p.subject);
        }
      }
      if (p.source && !sourceLabels.has(p.source)) {
        sourceLabels.set(p.source, problemSourceLabel(p));
      }
    });
    const subjectRank = (subject: string | undefined) => {
      const i = SUBJECT_ORDER.indexOf(subject ?? '');
      return i === -1 ? SUBJECT_ORDER.length : i;
    };
    const competitions = [...competitionCount.keys()].sort(
      (a, b) =>
        subjectRank(competitionSubject.get(a)) -
          subjectRank(competitionSubject.get(b)) ||
        (competitionCount.get(b) ?? 0) - (competitionCount.get(a) ?? 0) ||
        a.localeCompare(b)
    );
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
        items: competitions.map(code => ({
          label: competitionLabel(code),
          value: code,
        })),
      },
      {
        attribute: 'difficulty',
        placeholder: t('difficulty'),
        searchable: false,
        isMulti: true,
        items: toOptions(
          uniqueSorted(
            all.map(p => p.difficulty),
            DIFFICULTY_ORDER
          )
        ),
      },
      {
        attribute: 'source',
        placeholder: t('source'),
        searchable: true,
        isMulti: true,
        items: [...sourceLabels.entries()]
          .map(([source, label]) => ({ label, value: source }))
          .sort((a, b) =>
            a.label.localeCompare(b.label, 'bg', { numeric: true })
          ),
      },
      {
        attribute: 'tags',
        placeholder: t('tags'),
        searchable: true,
        isMulti: true,
        items: toLabelledOptions(all.flatMap(p => p.tags ?? []), tagLabel),
      },
      {
        attribute: 'fields',
        placeholder: t('classification-fields', { defaultValue: 'Област' }),
        searchable: true,
        isMulti: true,
        items: toOptions(uniqueSorted(all.flatMap(p => p.fields ?? []))),
      },
      {
        attribute: 'assessmentLabel',
        placeholder: t('classification-difficulty', { defaultValue: 'Оценена трудност' }),
        searchable: false,
        isMulti: true,
        items: toOptions(uniqueSorted(all.map(p => p.assessmentLabel ?? ''))),
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
  }, [problems, t]);

  const matches = React.useMemo(() => {
    const tokens = searchTokens(query);
    const sets: { [attribute: string]: Set<string> } = {};
    Object.keys(filters).forEach(attribute => {
      if (filters[attribute]?.length) {
        sets[attribute] = new Set(filters[attribute]);
      }
    });
    return all.filter(problem => {
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
      if (sets['difficulty'] && !sets['difficulty'].has(problem.difficulty)) {
        return false;
      }
      if (sets['source'] && !sets['source'].has(problem.source)) return false;
      if (sets['assessmentLabel'] && !sets['assessmentLabel'].has(problem.assessmentLabel ?? '')) return false;
      if (sets['fields'] && !(problem.fields ?? []).some(field => sets['fields'].has(field))) return false;
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
  }, [problems, query, filters, userProgress]);

  // Any change to the result set puts you back on the first page.
  React.useEffect(() => {
    setPage(0);
  }, [query, filters, hitsPerPage]);

  const pageCount = Math.max(1, Math.ceil(matches.length / hitsPerPage));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = matches.slice(
    currentPage * hitsPerPage,
    (currentPage + 1) * hitsPerPage
  );

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

  return (
    <Layout>
      <SEO title={t('problems_all-problems-title')} />

      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <main>

        <div className="py-16 bg-blue-600 dark:bg-blue-900 px-5">
          <div className="max-w-3xl mx-auto mb-6">
            <h1 className="text-center text-3xl sm:text-5xl font-bold text-white dark:text-dark-high-emphasis mb-6">
              {t('problems_title')}
            </h1>
            <SearchBox value={searchTerm} onChange={setSearchTerm} />
          </div>
        </div>
        <div className="pt-3 px-9 pb-4 grid grid-cols-10">
          <div className="py-0.5 px-1 col-span-10">
            <div className="mb-5 items-center grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-x-5 gap-y-3">
              {selectionMetadata.map(props => (
                <div
                  className="sm:col-span-3 col-span-2 md:col-span-1 lg:col-span-2 tw-forms-disable-all-descendants"
                  key={props.attribute}
                >
                  <Selection
                    {...props}
                    selected={filters[props.attribute] ?? []}
                    onChange={values =>
                      setFilters(prev => ({
                        ...prev,
                        [props.attribute]: values,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            {problems === null ? (
              <p className="text-gray-500 dark:text-dark-med-emphasis text-center py-8">
                …
              </p>
            ) : (
              <ProblemHits problems={visible} query={query} />
            )}
            {problems !== null && matches.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center items-center">
                <div className="pr-4 flex flex-wrap items-center">
                  <button
                    type="button"
                    aria-label="Предишна страница"
                    className={pageButtonClass(false)}
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    ‹
                  </button>
                  {pageButtons.map(i => (
                    <button
                      type="button"
                      key={i}
                      className={pageButtonClass(i === currentPage)}
                      onClick={() => setPage(i)}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="Следваща страница"
                    className={pageButtonClass(false)}
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    ›
                  </button>
                </div>
                <select
                  aria-label="Задачи на страница"
                  className="mt-1 lg:mt-0 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-dark-high-emphasis text-sm px-2 py-1"
                  value={hitsPerPage}
                  onChange={e => setHitsPerPage(parseInt(e.target.value, 10))}
                >
                  {HITS_PER_PAGE_OPTIONS.map(n => (
                    <option key={n} value={n}>
                      {`${n} ${t('problems_items-per-page')}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        </main>
      </div>
    </Layout>
  );
}
