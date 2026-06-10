import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

const PREFS_KEY = 'levee_prefs';

function loadPrefs(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'); }
  catch { return {}; }
}

function savePrefs(prefs: Record<string, unknown>) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

interface SettingsContextValue {
  preferProxies: boolean;
  setPreferProxies: (v: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [preferProxies, _setPreferProxies] = useState<boolean>(
    () => (loadPrefs().preferProxies as boolean) ?? false
  );

  const setPreferProxies = useCallback((v: boolean) => {
    _setPreferProxies(v);
    const prefs = loadPrefs();
    prefs.preferProxies = v;
    savePrefs(prefs);
  }, []);

  return (
    <SettingsContext.Provider value={{ preferProxies, setPreferProxies }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be inside <SettingsProvider>');
  return ctx;
}
