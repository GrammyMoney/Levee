import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useSuite, type Provider } from '../../contexts/SuiteContext';
import { useProxy } from '../../contexts/ProxyContext';
import { getAssetType } from '../../types';
import { accentFor, pinVerb } from '../../accent';
import Dropdown from '../Dropdown';
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
  target: string;
  type: 'file' | 'folder';
}

interface Props {
  isOpen: boolean;
  initialPath: string;
  currentFilePath: string;
  onboarding?: boolean;
  onOnboardingDone?: () => void;
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
  isOpen, initialPath, currentFilePath, onboarding, onOnboardingDone, onOpenFile, onClose,
}: Props) {
  const {
    driveProviders, setDriveProvider, providerFor,
    isManaged, isPrecached, precachedEntryFor, isLoading: isSuiteLoading,
    addToPrecache, removeFromPrecache, togglePrecache,
  } = useSuite();
  const normPath = (p: string) => p.toLowerCase().replace(/\\/g, '/');
  const { queueProxy } = useProxy();

  const [listing, setListing] = useState<DirListing | null>(null);
  const [proxies, setProxies] = useState<Record<string, string>>({});
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({});
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [allDrives, setAllDrives] = useState<string[]>([]);

  // Onboarding: jump straight to the drive settings so the tooltip has context.
  useEffect(() => {
    if (onboarding && isOpen) setShowSettings(true);
  }, [onboarding, isOpen]);

  // Thumbnail extraction queue — max 3 concurrent ffmpeg instances
  const thumbQueue   = useRef<string[]>([]);
  const thumbWorkers = useRef(0);
  const THUMB_CONCURRENCY = 3;

  const processThumbQueue = useCallback(async () => {
    if (thumbWorkers.current >= THUMB_CONCURRENCY || thumbQueue.current.length === 0) return;
    thumbWorkers.current++;
    const file = thumbQueue.current.shift()!;
    try {
      const p = await invoke<string>('get_thumbnail', { originalPath: file });
      setThumbnails(prev => ({ ...prev, [file]: convertFileSrc(p) }));
    } catch {
      setThumbnails(prev => ({ ...prev, [file]: null }));
    } finally {
      thumbWorkers.current--;
      processThumbQueue();
    }
  }, []);

  const loadDir = useCallback(async (path: string) => {
    setSelectedFiles(new Set());
    setThumbnails({});
    thumbQueue.current = [];
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

  useEffect(() => {
    if (isOpen) loadDir(getDirPath(initialPath));
  }, [isOpen, initialPath]);

  // Queue thumbnail extraction whenever listing changes
  useEffect(() => {
    if (!listing || !isOpen) return;
    const toLoad = listing.mediaFiles.filter(
      f => getAssetType(f) === 'video' && thumbnails[f] === undefined
    );
    thumbQueue.current.push(...toLoad);
    for (let i = 0; i < Math.min(THUMB_CONCURRENCY, toLoad.length); i++) {
      processThumbQueue();
    }
  }, [listing, isOpen]);

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

  const handlePrecacheFolder = useCallback(() => {
    if (!listing) return;
    addToPrecache([listing.path]);
  }, [listing, addToPrecache]);

  const handleRemovePrecacheFolder = useCallback(() => {
    if (!listing) return;
    removeFromPrecache([listing.path]);
  }, [listing, removeFromPrecache]);

  // Fetch drives when the library opens (needed for the drive switcher + settings)
  useEffect(() => {
    if (!isOpen || allDrives.length > 0) return;
    invoke<string[]>('list_drives').then(setAllDrives).catch(() => {});
  }, [isOpen, allDrives.length]);

  const openFileContextMenu = useCallback((e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target: filePath, type: 'file' });
  }, []);

  const openFolderContextMenu = useCallback((e: React.MouseEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target: dirPath, type: 'folder' });
  }, []);

  const buildContextItems = useCallback((menu: ContextMenuState): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    if (menu.type === 'folder') {
      const isSuite = isManaged(menu.target);
      const cached = isPrecached(menu.target);
      const loading = isSuiteLoading(menu.target);
      const lucid = providerFor(menu.target) === 'lucidlink';
      const v = pinVerb(providerFor(menu.target));
      items.push({
        label: 'Open Folder',
        onClick: () => loadDir(menu.target),
      });
      if (isSuite) {
        items.push({ label: '──────────', disabled: true, onClick: () => {} });
        items.push({
          label: loading ? 'Working…'
            : cached ? (lucid ? 'Unpin Folder' : 'Remove from Pre-cache')
            : `${v.verb} Folder`,
          disabled: loading,
          variant: cached ? 'danger' : 'default',
          onClick: () => cached
            ? removeFromPrecache([menu.target])
            : addToPrecache([menu.target]),
        });
      }
      return items;
    }

    // File context menu
    const filePath = menu.target;
    const isVideo = getAssetType(filePath) === 'video';
    const hasProxy = !!proxies[filePath];
    const isSuite = isManaged(filePath);
    const cached = isPrecached(filePath);
    const loading = isSuiteLoading(filePath);
    const lucid = providerFor(filePath) === 'lucidlink';
    const v = pinVerb(providerFor(filePath));

    items.push({
      label: 'Open',
      onClick: () => onOpenFile(filePath),
    });

    if (isVideo) {
      items.push({ label: '──────────', disabled: true, onClick: () => {} });
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

    items.push({ label: '──────────', disabled: true, onClick: () => {} });
    if (isSuite) {
      items.push({
        label: loading ? 'Working…'
          : cached ? (lucid ? 'Unpin File' : 'Remove from Pre-cache')
          : `${v.verb} File`,
        disabled: loading,
        variant: cached ? 'danger' : 'default',
        onClick: () => togglePrecache(filePath),
      });
      const parentDir = getDirPath(filePath);
      const folderCached = isPrecached(parentDir);
      const folderLoading = isSuiteLoading(parentDir);
      items.push({
        label: folderLoading ? 'Working…'
          : folderCached ? (lucid ? 'Unpin Parent Folder' : 'Remove Folder Pre-cache')
          : `${v.verb} Parent Folder`,
        disabled: folderLoading,
        onClick: () => folderCached
          ? removeFromPrecache([parentDir])
          : addToPrecache([parentDir]),
      });
    } else {
      items.push({ label: `${v.verb} File`, disabled: true, onClick: () => {} });
    }

    return items;
  }, [proxies, isManaged, isPrecached, isSuiteLoading, queueProxy, addToPrecache, removeFromPrecache, togglePrecache, onOpenFile, loadDir]);

  const currentDir = listing?.path ?? '';
  const isFolderSuite = isManaged(currentDir);
  const isFolderCached = isPrecached(currentDir);
  const isFolderLoading = isSuiteLoading(currentDir);
  const videoFilesWithoutProxy = listing?.mediaFiles.filter(
    f => getAssetType(f) === 'video' && !proxies[f]
  ) ?? [];

  // Accent + wording follow the current directory's drive provider
  // (lime for LucidLink, sky for Suite).
  const folderProvider = providerFor(currentDir);
  const a = accentFor(folderProvider);
  const folderVerb = pinVerb(folderProvider);

  // Drive switcher: the current drive letter + the path after it.
  const curDriveLetter = currentDir.match(/^[a-zA-Z]:/)?.[0] ?? '';
  const curDriveRoot = allDrives.find(d => d.toLowerCase().startsWith(curDriveLetter.toLowerCase()))
    ?? (curDriveLetter ? curDriveLetter + '\\' : '');
  const restPath = curDriveRoot ? currentDir.slice(curDriveRoot.length) : currentDir;
  const driveOptions = allDrives.map(d => ({ value: d, label: d.replace(/[/\\]$/, '') }));

  return (
    <>
      <div
        className={`absolute top-0 left-0 bottom-0 z-30 w-[480px] flex flex-col glass border-r border-white/8 transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8 shrink-0">
          {showSettings ? (
            <button
              onClick={() => setShowSettings(false)}
              className="flex items-center justify-center w-7 h-7 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Back"
            >
              <BackIcon />
            </button>
          ) : (
            <button
              onClick={() => listing?.parentPath && loadDir(listing.parentPath)}
              disabled={!listing?.parentPath}
              className="flex items-center justify-center w-7 h-7 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title="Go up"
            >
              <BackIcon />
            </button>
          )}

          {showSettings ? (
            <span className="flex-1 text-xs text-white/50 truncate font-mono">Drive Settings</span>
          ) : (
            <div className="flex-1 flex items-center gap-1.5 min-w-0">
              {curDriveRoot && driveOptions.length > 0 && (
                <Dropdown
                  value={curDriveRoot}
                  options={driveOptions}
                  onChange={d => loadDir(d)}
                  title="Switch drive"
                  triggerClassName={`px-2 py-0.5 rounded-md text-xs font-mono font-semibold border ${
                    folderProvider !== 'local'
                      ? `${a.bg} ${a.text} ${a.border}`
                      : 'bg-white/8 text-white/60 border-white/10 hover:text-white/80'
                  }`}
                />
              )}
              <span className="text-xs text-white/40 truncate font-mono" title={currentDir}>
                {restPath || '…'}
              </span>
            </div>
          )}

          <button
            onClick={() => setShowSettings(v => !v)}
            title="Settings"
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              showSettings ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
          >
            <GearIcon />
          </button>

          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Folder toolbar */}
        {!showSettings && <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8 shrink-0">
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${a.bg} ${a.text} ${a.hover}`}
              >
                {isFolderLoading ? <SpinnerIcon /> : <CloudCheckIcon />}
                Folder {folderVerb.done}
              </button>
            ) : (
              <button
                onClick={handlePrecacheFolder}
                disabled={isFolderLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/10 text-white/50 hover:bg-white/18 hover:text-white/80 transition-colors disabled:opacity-50"
              >
                {isFolderLoading ? <SpinnerIcon /> : <CloudIcon />}
                {folderVerb.verb} Folder
              </button>
            )
          )}
        </div>}

        {/* Settings panel */}
        {showSettings && (
          <DriveSettingsPanel
            allDrives={allDrives}
            driveProviders={driveProviders}
            onboarding={!!onboarding}
            onOnboardingDone={onOnboardingDone}
            onSetProvider={setDriveProvider}
          />
        )}

        {/* Two-column body */}
        <div className={`flex flex-1 overflow-hidden ${showSettings ? 'hidden' : ''}`}>
          {/* Left: subdirectories */}
          <div className="w-40 shrink-0 border-r border-white/8 overflow-y-auto py-1">
            {listing?.subdirs.map(dir => {
              const dirSuite = isManaged(dir);
              const dirCached = isPrecached(dir);
              return (
                <button
                  key={dir}
                  onClick={() => loadDir(dir)}
                  onContextMenu={e => openFolderContextMenu(e, dir)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs text-white/60 hover:text-white hover:bg-white/8 transition-colors"
                >
                  <FolderIcon />
                  <span className="truncate flex-1">{getDirName(dir)}</span>
                  {dirSuite && dirCached && (
                    <CloudCheckIconSm className={`shrink-0 ${a.textStrong}`} />
                  )}
                </button>
              );
            })}
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
                const isSelected = selectedFiles.has(file);
                const hasProxy = !!proxies[file];
                const isSuite = isManaged(file);
                const cached = isPrecached(file);
                const cacheLoading = isSuiteLoading(file);
                const isVideo = getAssetType(file) === 'video';
                const cachedEntry = precachedEntryFor(file);
                const folderCached = cachedEntry !== null && normPath(cachedEntry) !== normPath(file);

                const handleClick = (e: React.MouseEvent) => {
                  if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd+click: toggle this file in selection
                    setSelectedFiles(prev => {
                      const next = new Set(prev);
                      if (next.has(file)) next.delete(file);
                      else next.add(file);
                      return next;
                    });
                  } else {
                    // Plain click: select only this file
                    setSelectedFiles(new Set([file]));
                  }
                };

                return (
                  <div
                    key={file}
                    className={`flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer transition-colors select-none ${
                      isPlaying
                        ? 'bg-white/12 text-white'
                        : isSelected
                          ? 'bg-white/10 text-white ring-1 ring-inset ring-white/20'
                          : 'text-white/70 hover:text-white hover:bg-white/8'
                    }`}
                    onClick={handleClick}
                    onDoubleClick={() => onOpenFile(file)}
                    onContextMenu={e => openFileContextMenu(e, file)}
                  >
                    {/* Thumbnail or colored type block */}
                    <div className="shrink-0 w-28 h-16 rounded overflow-hidden relative"
                      style={{ background: EXT_COLORS[ext] ?? '#2a2a2a' }}>
                      {isVideo && thumbnails[file] ? (
                        <img
                          src={thumbnails[file]!}
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                      ) : isVideo && thumbnails[file] === undefined ? (
                        /* Loading shimmer */
                        <div className="w-full h-full animate-pulse bg-white/5" />
                      ) : (
                        /* Non-video or failed thumbnail: show ext label */
                        <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-white/50 uppercase">
                          {ext}
                        </div>
                      )}
                      {/* Playing indicator overlay */}
                      {isPlaying && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <span className="text-white text-base">▶</span>
                        </div>
                      )}
                    </div>

                    {/* Right col: filename + badges */}
                    <div className="flex-1 flex flex-col justify-between min-w-0 py-0.5">
                      <span className="text-xs font-medium truncate leading-snug">
                        {getFileName(file)}
                      </span>

                      {/* Status badges */}
                      <div className="flex items-center gap-1">
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

                        {/* Cloud badge */}
                        <button
                          title={
                            !isSuite
                              ? 'Not on a cloud-streamed drive'
                              : cacheLoading ? 'Working…'
                              : folderCached ? `${folderVerb.done} via parent folder`
                              : cached ? `${folderVerb.done} — click to remove`
                              : `Click to ${folderVerb.verb.toLowerCase()}`
                          }
                          disabled={!isSuite || cacheLoading || folderCached}
                          onClick={e => {
                            e.stopPropagation();
                            if (isSuite && !cacheLoading && !folderCached) togglePrecache(file);
                          }}
                          onDoubleClick={e => e.stopPropagation()}
                          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                            !isSuite
                              ? 'text-white/12 cursor-default'
                              : cacheLoading ? 'text-white/40 cursor-wait'
                              : folderCached ? `${a.textStrong} cursor-default`
                              : cached ? `${a.textStrong} hover:text-red-400`
                              : `text-white/25 ${a.hoverText}`
                          }`}
                        >
                          {cacheLoading ? <SpinnerIconSm /> : cached ? <CloudCheckIconSm /> : <CloudIconSm />}
                        </button>
                      </div>
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
          items={buildContextItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

// ── Settings panel ────────────────────────────────────────────────────────────

function DriveSettingsPanel({
  allDrives, driveProviders, onboarding, onOnboardingDone, onSetProvider,
}: {
  allDrives: string[];
  driveProviders: Record<string, Provider>;
  onboarding?: boolean;
  onOnboardingDone?: () => void;
  onSetProvider: (drive: string, provider: Provider) => void;
}) {
  const driveKey = (drive: string) => {
    let d = drive.toLowerCase().replace(/\//g, '\\');
    return d.endsWith('\\') ? d : d + '\\';
  };
  const providerOf = (drive: string): Provider => driveProviders[driveKey(drive)] ?? 'local';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {onboarding && (
        <div className="mx-3 mt-3 rounded-xl bg-amber-400/15 ring-1 ring-amber-400/40 px-4 py-3 flex items-start gap-3">
          <div className="text-amber-300 shrink-0 mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-amber-100 text-xs font-semibold mb-0.5">Set your cloud drive</p>
            <p className="text-amber-100/70 text-[11px] leading-relaxed">
              Levee needs to know which drives are cloud-streamed. Set the dropdown to
              <span className="font-semibold text-amber-200"> Suite </span>or
              <span className="font-semibold text-amber-200"> LucidLink </span>
              for your footage drive below — proxy &amp; pre-cache controls only appear for those.
            </p>
          </div>
          <button
            onClick={onOnboardingDone}
            className="shrink-0 text-amber-200/60 hover:text-amber-100 transition-colors"
            title="Got it"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2L2 10" /></svg>
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-b border-white/8 shrink-0">
        <p className="text-xs text-white/40 leading-relaxed">
          Set each drive's streaming provider. Proxy, thumbnail, and pre-cache features only apply to drives marked Suite or LucidLink.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5">
        {allDrives.length === 0 ? (
          <p className="text-xs text-white/25 px-1 py-2">Detecting drives…</p>
        ) : allDrives.map(drive => {
          const label = drive.replace(/[/\\]$/, '');
          const provider = providerOf(drive);
          const managed = provider !== 'local';
          const ra = accentFor(provider);
          return (
            <div
              key={drive}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors w-full ${
                managed ? ra.bgSoft : 'hover:bg-white/6'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className={managed ? ra.textStrong : 'text-white/25'}>
                <rect x="2" y="6" width="20" height="13" rx="2" />
                <path d="M6 11h.01M10 11h.01" />
              </svg>
              <span className={`text-sm font-medium flex-1 ${managed ? 'text-white/90' : 'text-white/50'}`}>
                {label}
              </span>
              <Dropdown
                value={provider}
                align="right"
                minWidth="9rem"
                options={[
                  { value: 'local', label: 'Local' },
                  { value: 'suite', label: 'Suite' },
                  { value: 'lucidlink', label: 'LucidLink' },
                ]}
                onChange={v => onSetProvider(drive, v as Provider)}
                triggerClassName={`text-xs font-medium rounded-md px-2.5 py-1 border ${
                  managed
                    ? `${ra.bg} ${ra.text} ${ra.border}`
                    : 'bg-white/8 text-white/50 border-white/10 hover:text-white/80'
                } ${onboarding && !managed ? 'ring-2 ring-amber-400/60 animate-pulse' : ''}`}
              />
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-white/8 px-4 py-3">
        <button
          onClick={() => invoke('set_as_default_player').catch(() => {})}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-sm text-white/70 hover:text-white transition-colors"
        >
          Set Levee as default video player
        </button>
        <p className="text-[10px] text-white/30 mt-1.5 text-center">Opens Windows Default apps settings</p>
      </div>

      <div className="shrink-0 border-t border-white/8 px-4 py-2.5 flex items-center justify-center">
        <button
          onClick={() => invoke('open_url', { url: 'https://github.com/GrammyMoney/levee' }).catch(() => {})}
          className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
          title="View Levee on GitHub"
        >
          Made with <span className="text-red-400/80">♥</span> in Dallas, TX by Alex Bagheri
        </button>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.475l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
    </svg>
  );
}

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

function CloudIconSm({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function CloudCheckIconSm({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
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

function SpinnerIconSm() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
