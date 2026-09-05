import * as React from 'react';

/**
 * State of the "compare with the original" PDF panel on problem pages.
 *
 * The preference (open, which PDF, panel width) is persisted in localStorage
 * under one key so it survives navigation through the problems tree: a quality
 * tester turns the panel on once and clicks through the papers.
 *
 * isSplit is what the layout actually renders: the preference is on AND the
 * viewport is at least Tailwind's md breakpoint. Below md the panel is never
 * rendered (the toggle button opens the PDF in a new tab instead). It is false
 * during SSR and the first client render, then follows the media query.
 */

export type CompareDoc = 'problems' | 'solutions';

const STORAGE_KEY = 'oxyz.comparePanel.v1';
/** Tailwind `md` — below it the split view is never rendered. */
export const COMPARE_MEDIA_QUERY = '(min-width: 768px)';
export const MIN_PANEL_WIDTH = 30;
export const MAX_PANEL_WIDTH = 70;
export const DEFAULT_PANEL_WIDTH = 50;

export const clampPanelWidth = (width: number): number =>
  Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));

type Persisted = { open: boolean; doc: CompareDoc; width: number };

const DEFAULTS: Persisted = {
  open: false,
  doc: 'problems',
  width: DEFAULT_PANEL_WIDTH,
};

function readPersisted(): Persisted {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      open: parsed.open === true,
      doc: parsed.doc === 'solutions' ? 'solutions' : 'problems',
      width:
        typeof parsed.width === 'number' && Number.isFinite(parsed.width)
          ? clampPanelWidth(parsed.width)
          : DEFAULT_PANEL_WIDTH,
    };
  } catch {
    return DEFAULTS;
  }
}

function writePersisted(value: Persisted): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // private mode / quota / disabled storage: the panel still works for
    // this page, it just will not remember its state
  }
}

export type ComparePanelContextValue = {
  /** The persisted preference. */
  isOpen: boolean;
  /** isOpen && viewport >= md; what the layout renders. */
  isSplit: boolean;
  doc: CompareDoc;
  /** Panel width as a percentage of the area right of the sidebar. */
  width: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setDoc: (doc: CompareDoc) => void;
  setWidth: (width: number) => void;
};

const ComparePanelContext =
  React.createContext<ComparePanelContextValue | null>(null);

/**
 * The provider lives in the problem page template, so it remounts on every
 * client-side navigation through the problems tree. Without this the first
 * render of the new page would show the panel closed (SSR defaults) until the
 * effect below has read localStorage: a flash of the single-column layout on
 * every click. Seeding the state from the last mounted provider keeps the
 * split view stable; the first mount after SSR still starts from DEFAULTS so
 * hydration matches the server markup.
 */
let lastKnown: { state: Persisted; isDesktop: boolean } | null = null;

export function ComparePanelProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [state, setState] = React.useState<Persisted>(
    () => lastKnown?.state ?? DEFAULTS
  );
  const [isDesktop, setIsDesktop] = React.useState(
    () => lastKnown?.isDesktop ?? false
  );
  // don't persist the SSR defaults before the stored preference is read
  const loadedRef = React.useRef(lastKnown !== null);

  React.useEffect(() => {
    setState(readPersisted());
    loadedRef.current = true;
    const media = window.matchMedia(COMPARE_MEDIA_QUERY);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  React.useEffect(() => {
    if (loadedRef.current) writePersisted(state);
  }, [state]);

  React.useEffect(() => {
    if (loadedRef.current) lastKnown = { state, isDesktop };
  }, [state, isDesktop]);

  const value = React.useMemo<ComparePanelContextValue>(
    () => ({
      isOpen: state.open,
      isSplit: state.open && isDesktop,
      doc: state.doc,
      width: state.width,
      open: () => setState(s => ({ ...s, open: true })),
      close: () => setState(s => ({ ...s, open: false })),
      toggle: () => setState(s => ({ ...s, open: !s.open })),
      setDoc: doc => setState(s => ({ ...s, doc })),
      setWidth: width =>
        setState(s => ({ ...s, width: clampPanelWidth(width) })),
    }),
    [state, isDesktop]
  );

  return (
    <ComparePanelContext.Provider value={value}>
      {children}
    </ComparePanelContext.Provider>
  );
}

/** The compare panel state; throws outside a problem page. */
export function useComparePanel(): ComparePanelContextValue {
  const context = React.useContext(ComparePanelContext);
  if (!context) {
    throw new Error(
      'useComparePanel must be used within a ComparePanelProvider'
    );
  }
  return context;
}

/** The compare panel state, or null on pages without it (module pages). */
export function useComparePanelOptional(): ComparePanelContextValue | null {
  return React.useContext(ComparePanelContext);
}
