import { Link, navigate } from 'gatsby';
import * as React from 'react';
import {
  decodedFragment,
  ProblemFragmentRoute,
  watchMovedFragments,
} from '../../problems/fragment-routes';

const EMPTY_ROUTES: ProblemFragmentRoute[] = [];
const FragmentContext = React.createContext<string | null | undefined>(
  undefined
);

function useBrowserFragment(routeHash?: string, enabled = true) {
  // The empty first render also matches the static HTML during hydration.
  const [fragment, setFragment] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    const read = () => setFragment(decodedFragment(window.location.hash));
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    read();
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, [routeHash, enabled]);
  return fragment;
}

export function useProblemFragment(): string | null {
  const provided = React.useContext(FragmentContext);
  const browser = useBrowserFragment(undefined, provided === undefined);
  return provided === undefined ? browser : provided;
}

export function childrenHaveFragment(
  children: React.ReactNode,
  fragment: string | null
): boolean {
  if (!fragment) return false;
  return React.Children.toArray(children).some(
    child =>
      React.isValidElement(child) &&
      (child.props.id === fragment ||
        childrenHaveFragment(child.props.children, fragment))
  );
}

export function ProblemFragmentProvider({
  routes = EMPTY_ROUTES,
  routeHash,
  children,
}: {
  routes?: ProblemFragmentRoute[];
  routeHash?: string;
  children: React.ReactNode;
}) {
  const fragment = useBrowserFragment(routeHash);
  React.useEffect(
    () =>
      watchMovedFragments(routes, window, url => {
        void navigate(url, { replace: true });
      }),
    [routes, routeHash]
  );
  return (
    <FragmentContext.Provider value={fragment}>
      {children}
    </FragmentContext.Provider>
  );
}

/** Real retained anchors with usable links also exist in static/no-JS HTML. */
export function MovedProblemSections({
  routes,
}: {
  routes?: ProblemFragmentRoute[];
}) {
  if (!routes?.length) return null;
  return (
    <nav aria-label="Преместени задачи" className="mt-6 border-t pt-4">
      {routes.map(route => (
        <p key={route.fromFragment} id={route.fromFragment}>
          <Link
            to={route.toUrl}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            {route.label}
          </Link>
        </p>
      ))}
    </nav>
  );
}
