// Site-wide level (класова група) — behaves like the language switcher:
// chosen once, persisted, and filters which categories every section shows
// (docs/Structure.md). Never part of the URL.
import * as React from 'react';
import { DEFAULT_LEVEL, Level, LEVELS } from '../../content/ordering';

const LEVEL_STORAGE_KEY = 'olympiads:level';
// pre-restructure key stored SectionIDs like 'physics/9-10'
const LEGACY_GRADE_KEY = 'olympiads:grade';

const LEGACY_TO_LEVEL: { [key: string]: Level } = {
  'physics/7-8': '7-8',
  'physics/9-10': '9-10',
  'physics/11-12': '11-12',
  'physics/olymp': 'olymp',
};

function readStoredLevel(): Level | null {
  try {
    const stored = window.localStorage.getItem(LEVEL_STORAGE_KEY);
    if (stored && (LEVELS as string[]).includes(stored)) {
      return stored as Level;
    }
    const legacy = window.localStorage.getItem(LEGACY_GRADE_KEY);
    if (legacy && LEGACY_TO_LEVEL[legacy]) {
      return LEGACY_TO_LEVEL[legacy];
    }
  } catch (e) {
    // storage unavailable
  }
  return null;
}

export const LevelContext = React.createContext<{
  level: Level;
  // false until the stored choice is read after hydration — render
  // level-independent markup while this is false to avoid SSR mismatches
  levelReady: boolean;
  setLevel: (level: Level) => void;
}>({
  level: DEFAULT_LEVEL,
  levelReady: false,
  setLevel: () => {
    // no-op outside provider
  },
});

export function LevelProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [level, setLevelState] = React.useState<Level>(DEFAULT_LEVEL);
  const [levelReady, setLevelReady] = React.useState(false);

  React.useEffect(() => {
    const stored = readStoredLevel();
    if (stored) setLevelState(stored);
    setLevelReady(true);
  }, []);

  const setLevel = React.useCallback((next: Level) => {
    setLevelState(next);
    try {
      window.localStorage.setItem(LEVEL_STORAGE_KEY, next);
    } catch (e) {
      // selection just won't persist
    }
  }, []);

  const value = React.useMemo(
    () => ({ level, levelReady, setLevel }),
    [level, levelReady, setLevel]
  );

  return (
    <LevelContext.Provider value={value}>{children}</LevelContext.Provider>
  );
}

export function useLevel() {
  return React.useContext(LevelContext);
}
