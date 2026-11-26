import { useSyncExternalStore } from 'react';

/**
 * Document theme for wiki page CONTENT (editor + rendered markdown) — independent of the
 * app's (dark) chrome. A wiki page is a document, so it can be read/written on a white
 * "paper" surface or on the system (dark) surface. The choice is a single GLOBAL preference
 * persisted in localStorage and applied to every page's content.
 *
 *  - `system` — content follows the app theme (dark).
 *  - `white`  — content is a light/white document surface, even in the dark app.
 */
export type DocTheme = 'system' | 'white';

const KEY = 'loopscale:wiki:doc-theme';

function read(): DocTheme {
  try {
    return localStorage.getItem(KEY) === 'white' ? 'white' : 'system';
  } catch {
    return 'system';
  }
}

let current: DocTheme = read();
const listeners = new Set<() => void>();

export function setDocTheme(theme: DocTheme): void {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // ignore — non-persistent (private mode); the in-memory value still drives this session.
  }
  listeners.forEach((l) => l());
}

/** Global document-theme preference, reactive across every component that reads it. */
export function useDocTheme(): readonly [DocTheme, (theme: DocTheme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => 'system' as DocTheme,
  );
  return [theme, setDocTheme] as const;
}
