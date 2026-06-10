import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';

interface ProxyJob {
  id: string;
  fileName: string;
  originalPath: string;
  status: 'generating' | 'done' | 'error';
  error?: string;
}

interface ProxyContextValue {
  queueProxy: (originalPath: string) => Promise<string>;
  jobs: ProxyJob[];
}

const ProxyContext = createContext<ProxyContextValue | null>(null);

export function ProxyProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ProxyJob[]>([]);
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const queueProxy = useCallback(async (originalPath: string): Promise<string> => {
    const id = crypto.randomUUID();
    const fileName = originalPath.replace(/\\/g, '/').split('/').pop() ?? originalPath;

    setJobs(prev => [...prev, { id, fileName, originalPath, status: 'generating' }]);

    try {
      const proxyPath = await invoke<string>('generate_proxy', { originalPath });
      setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'done' } : j));

      const t = setTimeout(() => {
        setJobs(prev => prev.filter(j => j.id !== id));
        dismissTimers.current.delete(id);
      }, 3000);
      dismissTimers.current.set(id, t);

      invoke('precache_proxies_folder', { originalPath }).catch(() => {});
      return proxyPath;
    } catch (err) {
      setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'error', error: String(err) } : j));

      const t = setTimeout(() => {
        setJobs(prev => prev.filter(j => j.id !== id));
        dismissTimers.current.delete(id);
      }, 6000);
      dismissTimers.current.set(id, t);

      throw err;
    }
  }, []);

  return (
    <ProxyContext.Provider value={{ queueProxy, jobs }}>
      {children}
      {jobs.length > 0 && createPortal(<ProxyToastPanel jobs={jobs} />, document.body)}
    </ProxyContext.Provider>
  );
}

export function useProxy() {
  const ctx = useContext(ProxyContext);
  if (!ctx) throw new Error('useProxy must be used inside ProxyProvider');
  return ctx;
}

function ProxyToastPanel({ jobs }: { jobs: ProxyJob[] }) {
  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {jobs.map(job => (
        <div
          key={job.id}
          className="flex items-center gap-3 bg-[#1e1e1e] border border-white/12 rounded-xl px-3.5 py-2.5 shadow-2xl min-w-[260px] max-w-[320px] backdrop-blur-sm"
        >
          <StatusIcon status={job.status} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-white/80 truncate">{job.fileName}</p>
            <p className="text-[10px] text-white/35 mt-0.5">
              {job.status === 'generating' ? 'Creating proxy…'
                : job.status === 'done' ? 'Proxy ready'
                : 'Failed to create proxy'}
            </p>
          </div>
          {job.status === 'generating' && (
            <div className="w-16 h-0.5 rounded-full bg-violet-500/30 shrink-0 overflow-hidden">
              <div className="h-full bg-violet-400 rounded-full animate-pulse w-full" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: ProxyJob['status'] }) {
  if (status === 'generating') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" className="animate-spin shrink-0 text-violet-400">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    );
  }
  if (status === 'done') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-400">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-400">
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}
