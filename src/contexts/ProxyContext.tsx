import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { generateProxy, precacheProxiesFolder } from '../api/tauri';
import { createPortal } from 'react-dom';
import { CheckIcon, ClockIcon, ErrorIcon, SpinnerIcon } from '../components/icons';
import { getFileName } from '../domain/path';

type JobStatus = 'queued' | 'generating' | 'done' | 'error';

interface ProxyJob {
  id: string;
  fileName: string;
  originalPath: string;
  status: JobStatus;
  error?: string;
}

interface QueueEntry {
  id: string;
  originalPath: string;
  resolve: (path: string) => void;
  reject: (err: unknown) => void;
}

interface ProxyContextValue {
  queueProxy: (originalPath: string) => Promise<string>;
  jobs: ProxyJob[];
}

const ProxyContext = createContext<ProxyContextValue | null>(null);

export function ProxyProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ProxyJob[]>([]);
  const queue      = useRef<QueueEntry[]>([]);
  const working    = useRef(false);
  const dismissRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scheduleBatchDismiss = useCallback(() => {
    const t = setTimeout(() => {
      setJobs([]);
      dismissRef.current.clear();
    }, 4000);
    dismissRef.current.set('__batch__', t);
  }, []);

  const cancelBatchDismiss = useCallback(() => {
    const t = dismissRef.current.get('__batch__');
    if (t != null) { clearTimeout(t); dismissRef.current.delete('__batch__'); }
  }, []);

  // Drain the queue one job at a time
  const processNext = useCallback(async () => {
    if (working.current || queue.current.length === 0) return;
    cancelBatchDismiss();
    working.current = true;

    const entry = queue.current.shift()!;

    setJobs(prev =>
      prev.map(j => j.id === entry.id ? { ...j, status: 'generating' } : j)
    );

    try {
      const proxyPath = await generateProxy(entry.originalPath);

      setJobs(prev =>
        prev.map(j => j.id === entry.id ? { ...j, status: 'done' } : j)
      );
      precacheProxiesFolder(entry.originalPath).catch(() => {});
      entry.resolve(proxyPath);
    } catch (err) {
      setJobs(prev =>
        prev.map(j => j.id === entry.id ? { ...j, status: 'error', error: String(err) } : j)
      );
      entry.reject(err);
    } finally {
      working.current = false;
      if (queue.current.length > 0) {
        processNext();
      } else {
        scheduleBatchDismiss();
      }
    }
  }, [cancelBatchDismiss, scheduleBatchDismiss]);

  const queueProxy = useCallback((originalPath: string): Promise<string> => {
    const id       = crypto.randomUUID();
    const fileName = getFileName(originalPath);

    return new Promise<string>((resolve, reject) => {
      setJobs(prev => [...prev, { id, fileName, originalPath, status: 'queued' }]);
      queue.current.push({ id, originalPath, resolve, reject });
      processNext();
    });
  }, [processNext]);

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

// ── Toast panel ───────────────────────────────────────────────────────────────

function ProxyToastPanel({ jobs }: { jobs: ProxyJob[] }) {
  const total      = jobs.length;
  const done       = jobs.filter(j => j.status === 'done' || j.status === 'error').length;
  const generating = jobs.find(j => j.status === 'generating');
  const allSettled = done === total;
  const pct        = total > 0 ? (done / total) * 100 : 0;

  const errors     = jobs.filter(j => j.status === 'error');

  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <div className="bg-[#1e1e1e] border border-white/12 rounded-xl shadow-2xl min-w-[280px] max-w-[320px] backdrop-blur-sm overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-3 px-3.5 pt-2.5 pb-2">
          <StatusIcon status={allSettled ? (errors.length > 0 ? 'error' : 'done') : 'generating'} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-white/80 truncate">
              {allSettled
                ? errors.length > 0
                  ? `${errors.length} failed, ${done - errors.length} created`
                  : 'All proxies created'
                : (generating?.fileName ?? 'Creating proxy…')}
            </p>
            <p className="text-[10px] text-white/35 mt-0.5">
              {allSettled ? 'Done' : 'Creating proxy…'}
            </p>
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-white/50 shrink-0">
            {done}/{total}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-white/10">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              allSettled
                ? errors.length > 0 ? 'bg-red-400' : 'bg-emerald-400'
                : 'bg-violet-400'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: JobStatus }) {
  if (status === 'queued') return <ClockIcon />;
  if (status === 'generating') return <SpinnerIcon className="animate-spin shrink-0 text-violet-400" />;
  if (status === 'done') return <CheckIcon />;
  return <ErrorIcon />;
}
