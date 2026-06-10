import { invoke } from '@tauri-apps/api/core';
import { useSuite } from '../../contexts/SuiteContext';

interface Props {
  fileName: string;
  filePath: string;
  visible: boolean;
  hasProxy?: boolean;
  isPlayingProxy?: boolean;
  onToggleProxy?: () => void;
  onOpenFile: () => void;
  onOpenLibrary: () => void;
}

export default function TopBar({
  fileName, filePath, visible, hasProxy, isPlayingProxy, onToggleProxy, onOpenFile, onOpenLibrary,
}: Props) {
  const { isSuitePath, isPrecached, precachedEntryFor, isLoading, togglePrecache } = useSuite();
  const isSuiteFile    = isSuitePath(filePath);
  const precached      = isPrecached(filePath);
  const loading        = isLoading(filePath);
  const norm           = (p: string) => p.toLowerCase().replace(/\\/g, '/');
  const cachedEntry    = precachedEntryFor(filePath);
  // True when cached via a parent folder entry — show active state but disable interaction
  const folderCached   = cachedEntry !== null && norm(cachedEntry) !== norm(filePath);

  const openInExplorer = () => {
    invoke('open_folder', { path: filePath }).catch(() => {});
  };

  return (
    <div
      className={`chrome absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-3 glass ${
        visible ? 'chrome-visible' : 'chrome-hidden'
      }`}
    >
      {/* Library browser */}
      <button
        className="flex items-center justify-center w-7 h-7 rounded hover:bg-white/15 transition-colors text-white/80 hover:text-white shrink-0"
        onClick={onOpenLibrary}
        title="Browse folder"
      >
        <FolderIcon />
      </button>

      {/* Filename + explorer shortcut */}
      <span className="flex-1 text-sm font-medium text-white truncate">{fileName}</span>
      <button
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 transition-colors text-white/30 hover:text-white/70 shrink-0"
        onClick={openInExplorer}
        title="Show in Explorer"
      >
        <ExternalLinkIcon />
      </button>

      {/* Proxy toggle */}
      {hasProxy && (
        <button
          onClick={onToggleProxy}
          title={isPlayingProxy
            ? 'Playing proxy · press P to switch to original'
            : 'Original · press P to switch to proxy'}
          className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm font-bold transition-all shrink-0 ${
            isPlayingProxy
              ? 'bg-violet-500/35 text-violet-300 ring-1 ring-violet-400/40 hover:bg-violet-500/50'
              : 'bg-white/8 text-white/30 hover:bg-white/15 hover:text-white/60'
          }`}
        >
          P
        </button>
      )}

      {/* Suite pre-cache badge — always visible; interactive for Suite files only */}
      <button
        onClick={() => { if (isSuiteFile && !loading && !folderCached) togglePrecache(filePath); }}
        disabled={!isSuiteFile || loading || folderCached}
        title={
          !isSuiteFile
            ? 'Not a Suite asset'
            : loading
              ? 'Working…'
              : folderCached
                ? 'Cached via parent folder'
                : precached
                  ? 'Cached locally — click to remove from pre-cache'
                  : 'Click to pre-cache this asset'
        }
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
          !isSuiteFile
            ? 'bg-white/6 text-white/20 cursor-default'
            : loading
              ? 'bg-white/10 text-white/40 cursor-wait'
              : folderCached
                ? 'bg-sky-500/25 text-sky-300 cursor-default'
                : precached
                  ? 'bg-sky-500/25 text-sky-300 hover:bg-sky-500/35'
                  : 'bg-white/10 text-white/50 hover:bg-white/18 hover:text-white/80'
        }`}
      >
        {loading ? <SpinnerIcon /> : precached ? <CloudCheckIcon /> : <CloudIcon />}
        <span>{!isSuiteFile ? 'Local' : loading ? 'Working…' : precached ? 'Cached' : 'Pre-cache'}</span>
      </button>

      {/* Open file */}
      <button
        className="flex items-center justify-center w-7 h-7 rounded hover:bg-white/15 transition-colors text-white/80 hover:text-white shrink-0"
        onClick={onOpenFile}
        title="Open file"
      >
        <OpenFileIcon />
      </button>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V5.5a.5.5 0 0 0-.5-.5H7.707L6.354 3.646A.5.5 0 0 0 6 3.5H1.5z" />
    </svg>
  );
}

function OpenFileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M5 3V2M8 3V2M11 3V2" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" />
      <path d="M10 2h4v4M14 2L8 8" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function CloudCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
