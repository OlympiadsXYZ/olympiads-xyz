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
import {
  ProblemsTreeData,
  TreeCompetition,
  TreePaper,
  TreeProblem,
  TreeSubject,
  TreeYear,
} from '../../problems/tree';

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

export function problemLabel(p: TreeProblem): string {
  return `Задача ${p.number}${p.title ? '. ' + p.title : ''}`;
}

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
      className={`ml-2 flex-shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500 ${className}`}
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

  React.useEffect(() => {
    let cancelled = false;
    loadTree().then(data => {
      if (!cancelled) setTree(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Once the tree is in: restore the stored expansion state and open the
  // path to the current problem on top of it. Everything else starts collapsed.
  React.useEffect(() => {
    if (!tree) return;
    const path = pathTo(tree, currentProblemId);
    setExpanded(prev => {
      const next: Expanded = { ...(prev ?? readStoredExpanded()) };
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
    if (activeRef.current) {
      scrolledFor.current = currentProblemId;
      activeRef.current.scrollIntoView({ block: 'center' });
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
              <span className="text-sm tabular-nums text-gray-400 group-hover:text-gray-500 dark:text-gray-500">
                {tree.count}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
      <div className="flex-1 h-0 overflow-y-auto">
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
                  chevronClass="h-5 w-5 text-gray-600"
                />
                {sOpen &&
                  subject.competitions.map(comp => {
                    const cKey = competitionKey(subject, comp);
                    const cOpen = isOpen(cKey);
                    return (
                      <div key={cKey}>
                        <ToggleRow
                          label={comp.short}
                          title={comp.name}
                          count={comp.count}
                          open={cOpen}
                          onPath={path.has(cKey)}
                          onToggle={() => toggle(cKey)}
                          rowClass="pl-6 py-2 font-medium"
                          textClass="text-gray-700 dark:text-dark-med-emphasis"
                          onPathTextClass="text-gray-900 dark:text-dark-high-emphasis"
                          chevronClass="h-4 w-4 text-gray-400"
                        />
                        {cOpen &&
                          comp.years.map(year => {
                            const yKey = yearKey(subject, comp, year);
                            const yOpen = isOpen(yKey);
                            return (
                              <div key={yKey}>
                                <ToggleRow
                                  label={String(year.year)}
                                  count={year.count}
                                  open={yOpen}
                                  onPath={path.has(yKey)}
                                  onToggle={() => toggle(yKey)}
                                  rowClass="pl-8 py-2"
                                  textClass="text-gray-600 dark:text-dark-med-emphasis"
                                  onPathTextClass="text-gray-900 font-medium dark:text-dark-high-emphasis"
                                  chevronClass="h-4 w-4 text-gray-400"
                                />
                                {yOpen &&
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
                                          rowClass="pl-10 py-2"
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
                                  })}
                              </div>
                            );
                          })}
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
