// Sidebar of problem pages: a browsable tree of the problems corpus
// (subject → competition → year → paper → problems), replacing the module
// navigation that is irrelevant there. The data is written at build time to
// /problems-data/tree.json (src/problems/index-node.ts → writeProblemsTree)
// and fetched once on the client, like /problems does with index.json.
//
// Visual language follows SidebarNav (Accordion.tsx / ItemLink.tsx): same
// paddings, text sizes, hover and active colours, dark mode.
import { Link } from 'gatsby';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  problemLabel,
  ProblemsTreeData,
  TreeCompetition,
  TreePaper,
  TreeProblem,
  TreeSubject,
  TreeYear,
} from '../../problems/tree';
import { problemCount, sidebarScrollTop } from './sidebarScroll';

const TREE_URL = '/problems-data/tree.json';
const STORAGE_KEY = 'problems-tree:expanded';

type Expanded = { [key: string]: boolean };

// One fetch per page session: the layout remounts on every navigation, so
// cache the promise at module level instead of re-fetching each time.
let treePromise: Promise<ProblemsTreeData | null> | null = null;
function loadTree(): Promise<ProblemsTreeData | null> {
  if (!treePromise) {
    treePromise = fetch(TREE_URL)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(data =>
        data && Array.isArray(data.subjects) ? (data as ProblemsTreeData) : null
      )
      .catch(() => {
        // Missing or malformed tree: render the empty state, don't crash.
        treePromise = null;
        return null;
      });
  }
  return treePromise;
}

function readStoredExpanded(): Expanded {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeStoredExpanded(value: Expanded) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (e) {
    // Storage unavailable (private mode, quota): the tree still works.
  }
}

const subjectKey = (s: TreeSubject) => `s:${s.id}`;
const competitionKey = (s: TreeSubject, c: TreeCompetition) =>
  `c:${s.id}/${c.code}`;
const yearKey = (s: TreeSubject, c: TreeCompetition, y: TreeYear) =>
  `y:${s.id}/${c.code}/${y.year}`;
const paperKey = (p: TreePaper) => `p:${p.id}`;

/** Keys of every ancestor of the given problem, or [] when it is not in the tree. */
function pathTo(tree: ProblemsTreeData, problemId: string | null): string[] {
  if (!problemId) return [];
  for (const s of tree.subjects) {
    for (const c of s.competitions) {
      for (const y of c.years) {
        for (const p of y.papers) {
          if (p.problems.some(x => x.id === problemId)) {
            return [
              subjectKey(s),
              competitionKey(s, c),
              yearKey(s, c, y),
              paperKey(p),
            ];
          }
        }
      }
    }
  }
  return [];
}

export { problemLabel };

// ---------------------------------------------------------------------------

function Chevron({ open, className }: { open: boolean; className: string }) {
  return (
    <svg
      className={`flex-shrink-0 ${className}`}
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      {open ? (
        <path
          fillRule="evenodd"
          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      ) : (
        <path
          fillRule="evenodd"
          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}

function Count({
  value,
  className = '',
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      className={`ml-2 flex-shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400 ${className}`}
      title={problemCount(value)}
    >
      {value}
    </span>
  );
}

type ToggleProps = {
  label: React.ReactNode;
  count: number;
  open: boolean;
  onPath: boolean;
  onToggle: () => void;
  /** Tailwind classes for the row's padding / weight, per depth. */
  rowClass: string;
  textClass: string;
  onPathTextClass: string;
  chevronClass: string;
  title?: string;
};

function ToggleRow({
  label,
  count,
  open,
  onPath,
  onToggle,
  rowClass,
  textClass,
  onPathTextClass,
  chevronClass,
  title,
}: ToggleProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      title={title}
      onClick={onToggle}
      className={`w-full flex items-center pr-4 text-sm leading-5 text-left focus:outline-none transition ease-in-out duration-150 hover:bg-blue-50 focus:bg-blue-100 dark:hover:bg-gray-900 dark:focus:bg-gray-800 ${rowClass} ${
        onPath ? onPathTextClass : textClass
      }`}
    >
      <span className="flex-1 min-w-0">{label}</span>
      <Count value={count} />
      <Chevron open={open} className={chevronClass} />
    </button>
  );
}

function ProblemRow({
  problem,
  isActive,
  activeRef,
}: {
  problem: TreeProblem;
  isActive: boolean;
  activeRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={isActive ? activeRef : undefined}>
      <Link
        to={problem.url}
        aria-current={isActive ? 'page' : undefined}
        className={`flex items-center pl-12 pr-4 py-2 text-sm leading-5 focus:outline-none transition ease-in-out duration-150 hover:text-blue-700 hover:bg-blue-50 focus:bg-blue-100 dark:hover:bg-gray-900 dark:hover:text-dark-high-emphasis dark:focus:bg-gray-800 ${
          isActive
            ? 'text-blue-700 font-medium bg-blue-50 dark:text-blue-400 dark:bg-gray-900'
            : 'text-gray-600 dark:text-dark-med-emphasis'
        }`}
      >
        <span className="flex-1 min-w-0">{problemLabel(problem)}</span>
      </Link>
    </div>
  );
}

/** A native picker keeps decades of years out of the document's tab/scroll flow. */
export function YearBrowser({
  competition,
  selectedYear,
  onSelect,
  children,
}: {
  competition: TreeCompetition;
  selectedYear: number | undefined;
  onSelect: (year: number) => void;
  children: (year: TreeYear) => React.ReactNode;
}) {
  const { i18n } = useTranslation();
  const english = i18n.language?.startsWith('en');
  const years = competition.years;
  const selected = years.find(year => year.year === selectedYear) ?? years[0];
  if (!selected) return null;
  const index = years.indexOf(selected);
  const stepClass =
    'flex h-10 w-9 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-400';
  return (
    <div className="mb-2">
      {/* sticky: scrolling through a long year keeps its picker in view */}
      <div className="sticky top-0 z-10 bg-white pt-1 pb-1 dark:bg-dark-surface">
        <div className="mx-4 ml-6 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-dark-surface">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={english ? 'Newer year' : 'По-нова година'}
              disabled={index === 0}
              onClick={() => onSelect(years[index - 1].year)}
              className={stepClass}
            >
              <span aria-hidden="true">←</span>
            </button>
            <label className="min-w-0 flex-1">
              <span className="block pl-2 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {english ? 'Year' : 'Година'}
              </span>
              <select
                aria-label={`${competition.short} · ${
                  english ? 'Year' : 'Година'
                }`}
                value={selected.year}
                onChange={event => onSelect(Number(event.target.value))}
                className="block w-full cursor-pointer rounded border-0 bg-transparent py-0 pl-2 pr-7 text-sm font-semibold tabular-nums text-gray-800 focus:ring-2 focus:ring-blue-500 dark:bg-dark-surface dark:text-dark-high-emphasis"
              >
                {years.map(year => (
                  <option key={year.year} value={year.year}>
                    {year.year} · {problemCount(year.count, english)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={english ? 'Older year' : 'По-стара година'}
              disabled={index === years.length - 1}
              onClick={() => onSelect(years[index + 1].year)}
              className={stepClass}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>
      {children(selected)}
    </div>
  );
}

function Skeleton() {
  const widths = ['w-24', 'w-40', 'w-32', 'w-36', 'w-28', 'w-44', 'w-32'];
  return (
    <div className="animate-pulse" aria-hidden="true">
      {widths.map((w, i) => (
        <div
          key={i}
          className={`flex items-center py-3 pr-4 ${i === 0 ? 'px-4' : 'pl-6'}`}
        >
          <div className={`h-3 rounded bg-gray-200 dark:bg-gray-800 ${w}`} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function ProblemsTree({
  currentProblemId,
}: {
  currentProblemId: string | null;
}) {
  // undefined = loading, null = unavailable
  const [tree, setTree] = React.useState<ProblemsTreeData | null | undefined>(
    undefined
  );
  const [expanded, setExpanded] = React.useState<Expanded | null>(null);
  const activeRef = React.useRef<HTMLDivElement>(null);
  const scrolledFor = React.useRef<string | null>(null);

  const navRef = React.useRef<HTMLElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // On a phone the desktop sidebar stays mounted but hidden (display: none): the 1.3 MB tree is loaded once the
  // sidebar is actually shown, not on every mobile page view.
  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      loadTree().then(data => {
        if (!cancelled) setTree(data);
      });
    const nav = navRef.current;
    if (
      !nav ||
      typeof ResizeObserver === 'undefined' ||
      nav.getClientRects().length
    ) {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new ResizeObserver(() => {
      if (!nav.getClientRects().length) return;
      observer.disconnect();
      load();
    });
    observer.observe(nav);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  // Once the tree is in: restore the stored expansion state and open the
  // path to the current problem on top of it. Everything else starts collapsed.
  React.useEffect(() => {
    if (!tree) return;
    const path = pathTo(tree, currentProblemId);
    setExpanded(prev => {
      const next: Expanded = { ...(prev ?? readStoredExpanded()) };
      // Migrate old sessions with many expanded years/competitions. Keep the
      // current problem visible, with just one competition and year per branch.
      for (const subject of tree.subjects) {
        const selectedCompetition =
          subject.competitions.find(comp =>
            path.includes(competitionKey(subject, comp))
          ) ??
          subject.competitions.find(
            comp => next[competitionKey(subject, comp)]
          );
        for (const comp of subject.competitions) {
          next[competitionKey(subject, comp)] = comp === selectedCompetition;
          const selectedYear =
            comp.years.find(year =>
              path.includes(yearKey(subject, comp, year))
            ) ??
            comp.years.find(year => next[yearKey(subject, comp, year)]) ??
            comp.years[0];
          for (const year of comp.years) {
            next[yearKey(subject, comp, year)] = year === selectedYear;
          }
        }
      }
      for (const key of path) next[key] = true;
      return next;
    });
  }, [tree, currentProblemId]);

  React.useEffect(() => {
    if (expanded) writeStoredExpanded(expanded);
  }, [expanded]);

  // Bring the current problem into view the first time it is rendered.
  React.useEffect(() => {
    if (!expanded || !currentProblemId) return;
    if (scrolledFor.current === currentProblemId) return;
    const item = activeRef.current;
    const container = scrollRef.current;
    if (item && container) {
      scrolledFor.current = currentProblemId;
      // Scroll the sidebar only (scrollIntoView could also scroll the page),
      // keeping the competition row and its year picker above the problem.
      const base = container.getBoundingClientRect().top - container.scrollTop;
      const anchor = item.closest('[data-tree-competition]');
      const itemRect = item.getBoundingClientRect();
      container.scrollTop = sidebarScrollTop({
        anchorTop: anchor ? anchor.getBoundingClientRect().top - base : null,
        itemTop: itemRect.top - base,
        itemHeight: itemRect.height,
        viewHeight: container.clientHeight,
      });
    }
  }, [expanded, currentProblemId]);

  const isOpen = (key: string) => !!(expanded && expanded[key]);
  const toggle = (key: string) =>
    setExpanded(prev => ({ ...(prev ?? {}), [key]: !(prev && prev[key]) }));

  const path = React.useMemo(
    () => new Set(tree ? pathTo(tree, currentProblemId) : []),
    [tree, currentProblemId]
  );

  return (
    <nav
      ref={navRef}
      className="flex-grow bg-white dark:bg-dark-surface flex flex-col h-0"
      aria-label="Задачи"
    >
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800">
        <div className="flex justify-center my-4">
          <Link
            to="/problems/"
            className="group inline-flex items-center h-full space-x-2 text-base leading-6 font-medium text-gray-900 hover:text-blue-700 focus:outline-none focus:text-blue-700 transition ease-in-out duration-150 dark:text-dark-high-emphasis dark:hover:text-blue-400 dark:focus:text-blue-400"
          >
            <span>Задачи</span>
            {tree ? (
              <span
                className="text-sm tabular-nums text-gray-500 group-hover:text-gray-600 dark:text-gray-400"
                title={problemCount(tree.count)}
              >
                {tree.count}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 h-0 overflow-y-auto">
        {tree === undefined ? (
          <Skeleton />
        ) : tree === null ? (
          <p className="px-4 py-3 text-sm text-gray-500 dark:text-dark-med-emphasis">
            Списъкът със задачи не е наличен.
          </p>
        ) : (
          tree.subjects.map(subject => {
            const sKey = subjectKey(subject);
            const sOpen = isOpen(sKey);
            const sOnPath = path.has(sKey);
            return (
              <div
                key={sKey}
                className={`border-b border-gray-200 dark:border-gray-800 ${
                  sOnPath ? 'bg-[#f7faff] dark:bg-[#16191f]' : ''
                }`}
              >
                <ToggleRow
                  label={subject.label}
                  count={subject.count}
                  open={sOpen}
                  onPath={sOnPath}
                  onToggle={() => toggle(sKey)}
                  rowClass="pl-4 py-3 font-semibold"
                  textClass="text-gray-800 dark:text-dark-high-emphasis"
                  onPathTextClass="text-gray-800 dark:text-dark-high-emphasis"
                  chevronClass="h-5 w-5 text-gray-600 dark:text-gray-400"
                />
                {sOpen &&
                  subject.competitions.map(comp => {
                    const cKey = competitionKey(subject, comp);
                    const cOpen = isOpen(cKey);
                    return (
                      <div key={cKey} data-tree-competition={comp.code}>
                        <ToggleRow
                          label={comp.short}
                          title={comp.name}
                          count={comp.count}
                          open={cOpen}
                          onPath={path.has(cKey)}
                          onToggle={() =>
                            setExpanded(prev => {
                              const next = { ...(prev ?? {}) };
                              for (const sibling of subject.competitions) {
                                const key = competitionKey(subject, sibling);
                                next[key] = key === cKey && !prev?.[cKey];
                              }
                              return next;
                            })
                          }
                          rowClass="pl-6 py-2 font-medium"
                          textClass="text-gray-700 dark:text-dark-med-emphasis"
                          onPathTextClass="text-gray-900 dark:text-dark-high-emphasis"
                          chevronClass="h-4 w-4 text-gray-400"
                        />
                        {cOpen && (
                          <YearBrowser
                            competition={comp}
                            selectedYear={
                              comp.years.find(year =>
                                isOpen(yearKey(subject, comp, year))
                              )?.year ?? comp.years[0]?.year
                            }
                            onSelect={year => {
                              setExpanded(prev => {
                                const next = { ...(prev ?? {}) };
                                for (const item of comp.years) {
                                  next[yearKey(subject, comp, item)] =
                                    item.year === year;
                                }
                                return next;
                              });
                            }}
                          >
                            {year =>
                              year.papers.map(paper => {
                                const pKey = paperKey(paper);
                                const pOpen = isOpen(pKey);
                                return (
                                  <div key={pKey}>
                                    <ToggleRow
                                      label={paper.label}
                                      count={paper.count}
                                      open={pOpen}
                                      onPath={path.has(pKey)}
                                      onToggle={() => toggle(pKey)}
                                      rowClass="pl-8 py-2"
                                      textClass="text-gray-600 dark:text-dark-med-emphasis"
                                      onPathTextClass="text-gray-900 font-medium dark:text-dark-high-emphasis"
                                      chevronClass="h-4 w-4 text-gray-400"
                                    />
                                    {pOpen &&
                                      paper.problems.map(problem => (
                                        <ProblemRow
                                          key={problem.id}
                                          problem={problem}
                                          isActive={
                                            problem.id === currentProblemId
                                          }
                                          activeRef={activeRef}
                                        />
                                      ))}
                                  </div>
                                );
                              })
                            }
                          </YearBrowser>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </nav>
  );
}
