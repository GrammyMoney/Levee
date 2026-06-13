import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Cloud file-streaming provider for a drive. (Context name kept as "Suite" for
// import stability; it now covers Suite *and* LucidLink.)
export type Provider = 'local' | 'suite' | 'lucidlink';

const STORAGE_KEY = 'levee_drive_providers';
const LEGACY_SUITE_KEY = 'levee_suite_roots';

const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/');

/// Normalize a drive root to a stable key: "S:\" / "s:/" / "S:" → "s:\\".
function driveKey(drive: string): string {
  let d = drive.toLowerCase().replace(/\//g, '\\');
  if (!d.endsWith('\\')) d += '\\';
  return d;
}
function driveRootOf(path: string): string | null {
  const m = path.match(/^([a-zA-Z]:)[\\/]/);
  return m ? driveKey(m[1]) : null;
}

function loadProviders(): Record<string, Provider> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // One-time migration from the old Suite-only roots list.
    const legacy = localStorage.getItem(LEGACY_SUITE_KEY);
    if (legacy) {
      const roots: string[] = JSON.parse(legacy);
      const map: Record<string, Provider> = {};
      for (const r of roots) map[driveKey(r)] = 'suite';
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
      return map;
    }
  } catch {}
  return {};
}

interface SuiteContextValue {
  driveProviders: Record<string, Provider>;
  setDriveProvider: (drive: string, provider: Provider) => void;
  providerFor: (path: string) => Provider;
  isManaged: (path: string) => boolean;
  precachedPaths: Set<string>;
  loadingPaths: Set<string>;
  isPrecached: (path: string) => boolean;
  precachedEntryFor: (path: string) => string | null;
  isLoading: (path: string) => boolean;
  addToPrecache: (paths: string[]) => Promise<void>;
  removeFromPrecache: (paths: string[]) => Promise<void>;
  togglePrecache: (path: string) => Promise<void>;
  refreshPrecache: () => Promise<void>;
}

const SuiteContext = createContext<SuiteContextValue | null>(null);

export function SuiteProvider({ children }: { children: ReactNode }) {
  const [driveProviders, setDriveProviders] = useState<Record<string, Provider>>(loadProviders);
  const [precachedPaths, setPrecachedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

  const hasManaged = Object.values(driveProviders).some(p => p !== 'local');

  const refreshPrecache = useCallback(async () => {
    if (!hasManaged) { setPrecachedPaths(new Set()); return; }
    try {
      const paths = await invoke<string[]>('precache_list');
      setPrecachedPaths(new Set(paths));
    } catch {}
  }, [hasManaged]);

  // Sync providers to Rust (DB routing + CLI dispatch), then refresh the pinned
  // list — order matters so the backend knows the providers before we query.
  useEffect(() => {
    invoke('set_drive_providers', { providers: driveProviders })
      .then(() => refreshPrecache())
      .catch(() => {});
  }, [driveProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDriveProvider = useCallback((drive: string, provider: Provider) => {
    setDriveProviders(prev => {
      const next = { ...prev };
      const key = driveKey(drive);
      if (provider === 'local') delete next[key];
      else next[key] = provider;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const providerFor = useCallback((path: string): Provider => {
    const root = driveRootOf(path);
    return (root && driveProviders[root]) || 'local';
  }, [driveProviders]);

  const isManaged = useCallback((path: string) => providerFor(path) !== 'local', [providerFor]);

  const isPrecached = useCallback((path: string) => {
    const nPath = norm(path);
    return [...precachedPaths].some(cached => {
      const nCached = norm(cached);
      return nPath === nCached || nPath.startsWith(nCached.endsWith('/') ? nCached : nCached + '/');
    });
  }, [precachedPaths]);

  // The actual registered cache entry covering `path` (may be a parent folder).
  const precachedEntryFor = useCallback((path: string): string | null => {
    const nPath = norm(path);
    for (const cached of precachedPaths) {
      const nCached = norm(cached);
      if (nPath === nCached || nPath.startsWith(nCached.endsWith('/') ? nCached : nCached + '/')) {
        return cached;
      }
    }
    return null;
  }, [precachedPaths]);

  const isLoading = useCallback((path: string) => loadingPaths.has(path), [loadingPaths]);

  const addToPrecache = useCallback(async (paths: string[]) => {
    setPrecachedPaths(prev => new Set([...prev, ...paths]));
    setLoadingPaths(prev => new Set([...prev, ...paths]));
    try {
      await invoke('precache_add', { paths });
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
      await invoke('precache_remove', { paths });
    } catch {
      setPrecachedPaths(prev => new Set([...prev, ...paths]));
    } finally {
      setLoadingPaths(prev => { const n = new Set(prev); paths.forEach(p => n.delete(p)); return n; });
      refreshPrecache(); // resync to catch path-format mismatches
    }
  }, [refreshPrecache]);

  const togglePrecache = useCallback(async (path: string) => {
    if (isPrecached(path)) {
      const entry = precachedEntryFor(path);
      await removeFromPrecache([entry ?? path]);
    } else {
      await addToPrecache([path]);
    }
  }, [isPrecached, precachedEntryFor, addToPrecache, removeFromPrecache]);

  return (
    <SuiteContext.Provider value={{
      driveProviders, setDriveProvider, providerFor, isManaged,
      precachedPaths, loadingPaths,
      isPrecached, precachedEntryFor, isLoading,
      addToPrecache, removeFromPrecache, togglePrecache, refreshPrecache,
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
