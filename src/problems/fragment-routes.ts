/** Hashes belong to the browser; Gatsby/server redirects never receive them. */
export type ProblemFragmentRoute = {
  fromFragment: string;
  toUrl: string;
  label: string;
};

export function decodedFragment(hash: string): string | null {
  if (!hash || hash[0] !== '#') return null;
  try {
    const fragment = decodeURIComponent(hash.slice(1));
    return fragment && !/[\u0000-\u0020\u007f]/.test(fragment)
      ? fragment
      : null;
  } catch {
    return null;
  }
}

type FragmentLocation = { hash: string; search: string; pathname: string };

/** Resolve exact approved fragments only; retained tasks and unknown hashes stay. */
export function movedFragmentTarget(
  routes: readonly ProblemFragmentRoute[],
  location: FragmentLocation
): string | null {
  const fragment = decodedFragment(location.hash);
  const route = fragment && routes.find(x => x.fromFragment === fragment);
  if (!route || !route.toUrl.startsWith('/problems/')) return null;
  const target = new URL(route.toUrl, 'https://fragment-route.invalid');
  if (
    target.origin !== 'https://fragment-route.invalid' ||
    !target.pathname.endsWith('/solution') ||
    target.search ||
    !decodedFragment(target.hash)
  )
    return null;
  const url = target.pathname + location.search + target.hash;
  return url === location.pathname + location.search + location.hash
    ? null
    : url;
}

type FragmentBrowser = {
  location: FragmentLocation;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
};

/** Also used by the React provider, so initial/hashchange/back behavior is tested. */
export function watchMovedFragments(
  routes: readonly ProblemFragmentRoute[],
  browser: FragmentBrowser,
  navigate: (url: string) => void
): () => void {
  const resolve = () => {
    const target = movedFragmentTarget(routes, browser.location);
    if (target) navigate(target);
  };
  browser.addEventListener('hashchange', resolve);
  browser.addEventListener('popstate', resolve);
  resolve();
  return () => {
    browser.removeEventListener('hashchange', resolve);
    browser.removeEventListener('popstate', resolve);
  };
}
