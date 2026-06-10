import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSuite } from '../../contexts/SuiteContext';
import { useProxy } from '../../contexts/ProxyContext';
import { getAssetType } from '../../types';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

interface DirListing {
  path: string;
  parentPath: string | null;
  subdirs: string[];
  mediaFiles: string[];
}

interface ContextMenuState {
  x: number;
  y: number;
  filePath: string;
}

interface Props {
  isOpen: boolean;
  initialPath: string;
  currentFilePath: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

function getFileName(p: string) {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

function getDirName(p: string) {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

function getDirPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  parts.pop();
  const dir = filePath.includes('\\') ? parts.join('\\') : parts.join('/') || '/';
  return /^[A-Za-z]:$/.test(dir) ? dir + '\\' : dir;
}

const EXT_COLORS: Record<string, string> = {
  mp4: '#1e3a5f', mov: '#1e3a5f', mkv: '#1e3a5f', avi: '#1e3a5f',
  webm: '#1e3a5f', mxf: '#2a2060',
  mp3: '#1a3d2b', wav: '#1a3d2b', aiff: '#1a3d2b', aac: '#1a3d2b',
  flac: '#1a3d2b', ogg: '#1a3d2b',
  jpg: '#3d1a2b', jpeg: '#3d1a2b', png: '#3d1a2b',
  tiff: '#3d1a2b', tif: '#3d1a2b', webp: '#3d1a2b',
};

export default function Library({
  isOpen, initialPath, currentFilePath, onOpenFile, onClose,
}: Props) {
  const { isSuitePath, isPrecached, isLoading: isSuiteLoading, addToPrecache, removeFromPrecache } = useSuite();
  const { queueProxy } = useProxy();

  const [listing, setListing] = useState<DirListing | null>(null);
  const [proxies, setProxies] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const loadDir = useCallback(async (path: string) => {
    try {
      const dir = await invoke<DirListing>('list_directory', { path });
      setListing(dir);
      if (dir.mediaFiles.length > 0) {
        const batch = await invoke<Record<string, string>>('get_proxies_batch', { filePaths: dir.mediaFiles });
        setProxies(batch);
      } else {
        setProxies({});
      }
    } catch {}
  }, []);

  // Load initial dir when panel opens
  useEffect(() => {
    if (isOpen) loadDir(getDirPath(initialPath));
  }, [isOpen, initialPath]);

  // Reload proxies when a new proxy job completes (poll every 3s while open)
  useEffect(() => {
    if (!isOpen || !listing) return;
    const id = setInterval(async () => {
      if (listing.mediaFiles.length > 0) {
        const batch = await invoke<Record<string, string>>('get_proxies_batch', { filePaths: listing.mediaFiles }).catch(() => ({}));
        setProxies(batch);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [isOpen, listing]);

  const handleGenerateAll = useCallback(async () => {
    if (!listing) return;
    const videoFiles = listing.mediaFiles.filter(f => getAssetType(f) === 'video' && !proxies[f]);
    for (const f of videoFiles) {
      queueProxy(f).then(proxyPath => {
        setProxies(prev => ({ ...prev, [f]: proxyPath }));
      }).catch(() => {});
    }
  }, [listing, proxies, queueProxy]);

  const handlePrecacheFolder = useCallback(async () => {
    if (!listing) return;
    addToPrecache([listing.path]);
  }, [listing, addToPrecache]);

  const handleRemovePrecacheFolder = useCallback(async () => {
    if (!listing) return;
    removeFromPrecache([listing.path]);
  }, [listing, removeFromPrecache]);

  const openContextMenu = useCallback((e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, filePath });
  }, []);

  const buildContextItems = useCallback((filePath: string): ContextMenuItem[] => {
    const isVideo = getAssetType(filePath) === 'video';
    const hasProxy = !!proxies[filePath];
    const isSuite = isSuitePath(filePath);
    const cached = isPrecached(filePath);
    const loading = isSuiteLoading(filePath);
    const items: ContextMenuItem[] = [];

    if (isVideo) {
      if (!hasProxy) {
        items.push({
          label: 'Generate Proxy',
          onClick: () => {
            queueProxy(filePath).then(p => setProxies(prev => ({ ...prev, [filePath]: p }))).catch(() => {});
          },
        });
      } else {
        items.push({
          label: 'Delete Proxy',
          variant: 'danger',
          onClick: async () => {
            await invoke('delete_proxy', { originalPath: filePath }).catch(() => {});
            setProxies(prev => { const n = { ...prev }; delete n[filePath]; return n; });
          },
        });
      }
    }

    if (isSuite) {
      if (items.length > 0) items.push({ label: '──────────', disabled: true, onClick: () => {} });
      if (cached) {
        items.push({
          label: loading ? 'Working…' : 'Remove from Pre-cache',
          disabled: loading,
          onClick: () => removeFromPrecache([filePath]),
        });
      } else {
        items.push({
          label: loading ? 'Working…' : 'Pre-cache this File',
          disabled: loading,
          onClick: () => addToPrecache([filePath]),
        });
      }
    }

    return items;
  }, [proxies, isSuitePath, isPrecached, isSuiteLoading, queueProxy, addToPrecache, removeFromPrecache]);

  const currentDir = listing?.path ?? '';
  const isFolderSuite = isSuitePath(currentDir);
  const isFolderCached = isPrecached(currentDir);
  const isFolderLoading = isSuiteLoading(currentDir);
  const videoFilesWithoutProxy = listing?.mediaFiles.filter(
    f => getAssetType(f) === 'video' && !proxies[f]
  ) ?? [];

  return (
    <>
      <div
        className={`absolute top-0 left-0 bottom-0 z-30 w-[480px] flex flex-col glass border-r border-white/8 transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8 shrink-0">
          {/* Back button */}
          <button
            onClick={() => listing?.parentPath && loadDir(listing.parentPath)}
            disabled={!listing?.parentPath}
            className="flex items-center justify-center w-7 h-7 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-20 disabled:pointer-events-none"
            title="Go up"
          >
            <BackIcon />
          </button>

          {/* Current path */}
          <span className="flex-1 text-xs text-white/50 truncate font-mono" title={currentDir}>
            {currentDir || '…'}
          </span>

          {/* Close */}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Folder toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8 shrink-0">
          <button
            onClick={handleGenerateAll}
            disabled={videoFilesWithoutProxy.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <ProxyIcon />
            Generate All Proxies
            {videoFilesWithoutProxy.length > 0 && (
              <span className="bg-violet-500/40 text-violet-200 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                {videoFilesWithoutProxy.length}
              </span>
            )}
          </button>

          {isFolderSuite && (
            isFolderCached ? (
              <button
                onClick={handleRemovePrecacheFolder}
                disabled={isFolderLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-sky-500/25 text-sky-300 hover:bg-sky-500/35 transition-colors disabled:opacity-50"
              >
                {isFolderLoading ? <SpinnerIcon /> : <CloudCheckIcon />}
                Folder Cached
              </button>
            ) : (
              <button
                onClick={handlePrecacheFolder}
                disabled={isFolderLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/10 text-white/50 hover:bg-white/18 hover:text-white/80 transition-colors disabled:opacity-50"
              >
                {isFolderLoading ? <SpinnerIcon /> : <CloudIcon />}
                Pre-cache Folder
              </button>
            )
          )}
        </div>

        {/* Two-column body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: subdirectories */}
          <div className="w-40 shrink-0 border-r border-white/8 overflow-y-auto py-1">
            {listing?.subdirs.map(dir => (
              <button
                key={dir}
                onClick={() => loadDir(dir)}
                className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs text-white/60 hover:text-white hover:bg-white/8 transition-colors truncate"
              >
                <FolderIcon />
                <span className="truncate">{getDirName(dir)}</span>
              </button>
            ))}
            {listing && listing.subdirs.length === 0 && (
              <p className="px-3 py-3 text-[10px] text-white/20">No folders</p>
            )}
          </div>

          {/* Right: media files */}
          <div className="flex-1 overflow-y-auto p-2">
            {listing && listing.mediaFiles.length === 0 && (
              <p className="px-2 py-4 text-xs text-white/20 text-center">No media files</p>
            )}
            <div className="flex flex-col gap-1">
              {listing?.mediaFiles.map(file => {
                const ext = file.split('.').pop()?.toLowerCase() ?? '';
                const isPlaying = file === currentFilePath;
                const hasProxy = !!proxies[file];
                const isSuite = isSuitePath(file);
                const cached = isPrecached(file);
                const isVideo = getAssetType(file) === 'video';

                return (
                  <div
                    key={file}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                      isPlaying
                        ? 'bg-white/12 text-white'
                        : 'text-white/70 hover:text-white hover:bg-white/8'
                    }`}
                    onClick={() => onOpenFile(file)}
                    onContextMenu={e => openContextMenu(e, file)}
                  >
                    {/* Colored type block */}
                    <div
                      className="shrink-0 w-8 h-8 rounded flex items-center justify-center text-[9px] font-bold text-white/60 uppercase"
                      style={{ background: EXT_COLORS[ext] ?? '#2a2a2a' }}
                    >
                      {ext}
                    </div>

                    {/* Filename */}
                    <span className="flex-1 text-xs truncate">{getFileName(file)}</span>

                    {/* Status badges */}
                    <div className="flex items-center gap-1 shrink-0">
                      {isVideo && (
                        <span
                          title={hasProxy ? 'Proxy exists' : 'No proxy'}
                          className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded transition-colors ${
                            hasProxy
                              ? 'bg-violet-500/30 text-violet-300'
                              : 'bg-white/6 text-white/20'
                          }`}
                        >
                          P
                        </span>
                      )}
                      {isSuite && (
                        <span
                          title={cached ? 'Cached locally' : 'Not cached'}
                          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                            cached ? 'text-sky-400' : 'text-white/20'
                          }`}
                        >
                          {cached ? <CloudCheckIconSm /> : <CloudIconSm />}
                        </span>
                      )}
                      {isPlaying && (
                        <span className="text-[9px] font-semibold text-white/40 uppercase tracking-wider">
                          ▶
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextItems(contextMenu.filePath)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 2l12 12M14 2L2 14" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-white/30">
      <path d="M1.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V5.5a.5.5 0 0 0-.5-.5H7.707L6.354 3.646A.5.5 0 0 0 6 3.5H1.5z" />
    </svg>
  );
}

function ProxyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="14" height="10" rx="1" />
      <path d="M6 8l3-2v4l-3-2z" fill="currentColor" stroke="none" />
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

function CloudIconSm() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function CloudCheckIconSm() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
