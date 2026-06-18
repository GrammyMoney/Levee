import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

const PREFS_KEY = 'levee_prefs';

function loadPrefs(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs(prefs: Record<string, unknown>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

interface SettingsContextValue {
  preferProxies: boolean;
  setPreferProxies: (v: boolean) => void;
  /// Whether the one-time "set as default player" prompt has been shown.
  defaultPlayerPrompted: boolean;
  setDefaultPlayerPrompted: (v: boolean) => void;
  /// Whether the one-time Suite-drive onboarding tooltip has been shown.
  suiteOnboarded: boolean;
  setSuiteOnboarded: (v: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [preferProxies, _setPreferProxies] = useState<boolean>(
    () => (loadPrefs().preferProxies as boolean) ?? false,
  );
  const [defaultPlayerPrompted, _setDefaultPlayerPrompted] = useState<boolean>(
    () => (loadPrefs().defaultPlayerPrompted as boolean) ?? false,
  );
  const [suiteOnboarded, _setSuiteOnboarded] = useState<boolean>(
    () => (loadPrefs().suiteOnboarded as boolean) ?? false,
  );

  const setPreferProxies = useCallback((v: boolean) => {
    _setPreferProxies(v);
    const prefs = loadPrefs();
    prefs.preferProxies = v;
    savePrefs(prefs);
  }, []);

  const setDefaultPlayerPrompted = useCallback((v: boolean) => {
    _setDefaultPlayerPrompted(v);
    const prefs = loadPrefs();
    prefs.defaultPlayerPrompted = v;
    savePrefs(prefs);
  }, []);

  const setSuiteOnboarded = useCallback((v: boolean) => {
    _setSuiteOnboarded(v);
    const prefs = loadPrefs();
    prefs.suiteOnboarded = v;
    savePrefs(prefs);
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        preferProxies,
        setPreferProxies,
        defaultPlayerPrompted,
        setDefaultPlayerPrompted,
        suiteOnboarded,
        setSuiteOnboarded,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be inside <SettingsProvider>');
  return ctx;
}
