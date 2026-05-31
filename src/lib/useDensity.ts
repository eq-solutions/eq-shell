import { useCallback, useEffect, useState } from 'react';

const DENSITY_KEY = 'eq-density';
const COMPACT_ATTR = 'compact';

function readStored(): boolean {
  try {
    return localStorage.getItem(DENSITY_KEY) === COMPACT_ATTR;
  } catch {
    return false;
  }
}

function applyDensity(compact: boolean): void {
  if (compact) {
    document.body.setAttribute('data-density', COMPACT_ATTR);
  } else {
    document.body.removeAttribute('data-density');
  }
}

export function useDensity(): { compact: boolean; toggle: () => void } {
  const [compact, setCompact] = useState<boolean>(() => {
    const stored = readStored();
    applyDensity(stored);
    return stored;
  });

  useEffect(() => {
    applyDensity(compact);
    try {
      if (compact) {
        localStorage.setItem(DENSITY_KEY, COMPACT_ATTR);
      } else {
        localStorage.removeItem(DENSITY_KEY);
      }
    } catch {
      // localStorage unavailable — ignore.
    }
  }, [compact]);

  const toggle = useCallback(() => setCompact((v) => !v), []);

  return { compact, toggle };
}
