import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export const appearances = ['auto', 'dark', 'bright'] as const;
export type Appearance = typeof appearances[number];
const key = 'parcelhub.appearance';
const isAppearance = (value: unknown): value is Appearance => appearances.some(item => item === value);
function readAppearance(): Appearance {
  try { const value = localStorage.getItem(key); return isAppearance(value) ? value : 'auto'; } catch { return 'auto'; }
}
const AppearanceContext = createContext<{ appearance: Appearance; setAppearance: (value: Appearance) => void } | null>(null);
export function AppearanceProvider({children}: {children: ReactNode}) {
  const [appearance, setState] = useState<Appearance>(readAppearance);
  useLayoutEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'auto' && system.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.documentElement.dataset.appearance = appearance;
    };
    apply();
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [appearance]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      try { if (event.storageArea !== localStorage) return; } catch { return; }
      if (event.key === key || event.key === null) setState(readAppearance());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const setAppearance = useCallback((value: Appearance) => {
    setState(value);
    try { localStorage.setItem(key, value); } catch { /* Keep the choice for this visit. */ }
  }, []);
  const value = useMemo(() => ({appearance, setAppearance}), [appearance, setAppearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('AppearanceProvider is required');
  return value;
}
