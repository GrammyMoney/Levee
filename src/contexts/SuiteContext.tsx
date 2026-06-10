import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'levee_suite_roots';

const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/');

function loadSaved(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

interface SuiteContextValue {
  suiteRoots: string[];
  precachedPaths: Set<string>;
  loadingPaths: Set<string>;
  isSuitePath: (path: string) => boolean;
  isPrecached: (path: string) => boolean;
  isLoading: (path: string) => boolean;
  addToPrecache: (paths: string[]) => Promise<void>;
  removeFromPrecache: (paths: string[]) => Promise<void>;
  togglePrecache: (path: string) => Promise<void>;
  updateSuiteRoots: (roots: string[]) => void;
  refreshPrecache: () => Promise<void>;
}

const SuiteContext = createContext<SuiteContextValue | null>(null);

export function SuiteProvider({ children }: { children: ReactNode }) {
  const [suiteRoots,     setSuiteRoots]     = useState<string[]>(loadSaved() ?? []);
  const [precachedPaths, setPrecachedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths,   setLoadingPaths]   = useState<Set<string>>(new Set());

  // Auto-detect Suite mounts only if user hasn't configured anything yet
  useEffect(() => {
    if (loadSaved() !== null) return;
    invoke<string[]>('get_suite_mounts')
      .then(roots => { if (roots.length > 0) setSuiteRoots(roots); })
      .catch(() => {});
  }, []);

  // Keep Rust DB-routing state in sync with React state
  useEffect(() => {
    invoke('set_suite_roots', { roots: suiteRoots }).catch(() => {});
  }, [suiteRoots]);

  const refreshPrecache = useCallback(async () => {
    if (suiteRoots.length === 0) return;
    try {
      const paths = await invoke<string[]>('suite_precache_list');
      setPrecachedPaths(new Set(paths));
    } catch {}
  }, [suiteRoots]);

  useEffect(() => { refreshPrecache(); }, [refreshPrecache]);

  const updateSuiteRoots = useCallback((roots: string[]) => {
    setSuiteRoots(roots);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(roots)); } catch {}
  }, []);

  const isSuitePath = useCallback((path: string) =>
    suiteRoots.some(root => norm(path).startsWith(norm(root))),
  [suiteRoots]);

  const isPrecached = useCallback((path: string) => {
    const nPath = norm(path);
    return [...precachedPaths].some(cached => {
      const nCached = norm(cached);
      return nPath === nCached || nPath.startsWith(nCached.endsWith('/') ? nCached : nCached + '/');
    });
  }, [precachedPaths]);

  const isLoading = useCallback((path: string) =>
    loadingPaths.has(path),
  [loadingPaths]);

  const addToPrecache = useCallback(async (paths: string[]) => {
    setPrecachedPaths(prev => new Set([...prev, ...paths]));
    setLoadingPaths(prev => new Set([...prev, ...paths]));
    try {
      await invoke('suite_precache_add', { paths });
    } catch {
      setPrecachedPaths(prev => { const n = new Set(prev); paths.forEach(p => n.delete(p)); return n; });
    } finally {
      setLoadingPaths(prev => { const n = new Set(prev); paths.forEach(p => n.delete(p)); return n; });
    }
  }, []);

  const removeFromPrecache = useCallback(async (paths: string[]) => {
    setPrecachedPaths(prev => { const n = new Set(prev); paths.forEach(p => n.delete(p)); return n; });
    setLoadingPaths(prev => new Set([...prev, ...paths]));
    try {
      await invoke('suite_precache_remove', { paths });
    } catch {
      setPrecachedPaths(prev => new Set([...prev, ...paths]));
    } finally {
      setLoadingPaths(prev => { const n = new Set(prev); paths.forEach(p => n.delete(p)); return n; });
    }
  }, []);

  const togglePrecache = useCallback(async (path: string) => {
    if (isPrecached(path)) await removeFromPrecache([path]);
    else await addToPrecache([path]);
  }, [isPrecached, addToPrecache, removeFromPrecache]);

  return (
    <SuiteContext.Provider value={{
      suiteRoots, precachedPaths, loadingPaths,
      isSuitePath, isPrecached, isLoading,
      addToPrecache, removeFromPrecache, togglePrecache,
      updateSuiteRoots, refreshPrecache,
    }}>
      {children}
    </SuiteContext.Provider>
  );
}

export function useSuite() {
  const ctx = useContext(SuiteContext);
  if (!ctx) throw new Error('useSuite must be inside <SuiteProvider>');
  return ctx;
}
