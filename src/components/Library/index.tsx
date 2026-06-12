import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assetUrl,
  deleteProxy,
  getProxiesBatch,
  getThumbnail,
  listDirectory,
  listDrives,
  type DirListing,
} from '../../api/tauri';
import { useSuite } from '../../contexts/SuiteContext';
import { useProxy } from '../../contexts/ProxyContext';
import { getAssetType } from '../../domain/media';
import {
  getDirName,
  getFileName,
  getParentDir,
  normalizeDriveRoot,
  normalizePath,
} from '../../domain/path';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import DriveSettingsPanel from './DriveSettingsPanel';
import {
  BackIcon,
  CloudCheckIcon,
  CloudIcon,
  CloseIcon,
  FolderIcon,
  GearIcon,
  ProxyIcon,
  SpinnerIcon,
} from '../icons';

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

const EXT_COLORS: Record<string, string> = {
  mp4: '#1e3a5f',
  mov: '#1e3a5f',
  mkv: '#1e3a5f',
  avi: '#1e3a5f',
  webm: '#1e3a5f',
  mxf: '#2a2060',
  mp3: '#1a3d2b',
  wav: '#1a3d2b',
  aiff: '#1a3d2b',
  aac: '#1a3d2b',
  flac: '#1a3d2b',
  ogg: '#1a3d2b',
  jpg: '#3d1a2b',
  jpeg: '#3d1a2b',
  png: '#3d1a2b',
  tiff: '#3d1a2b',
  tif: '#3d1a2b',
  webp: '#3d1a2b',
};

export default function Library({
  isOpen,
  initialPath,
  currentFilePath,
  onboarding,
  onOnboardingDone,
  onOpenFile,
  onClose,
}: Props) {
  const {
    suiteRoots,
    updateSuiteRoots,
    isSuitePath,
    isPrecached,
    precachedEntryFor,
    isLoading: isSuiteLoading,
    addToPrecache,
    removeFromPrecache,
    togglePrecache,
  } = useSuite();
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
  const thumbQueue = useRef<string[]>([]);
  const thumbWorkers = useRef(0);
  const THUMB_CONCURRENCY = 3;

  const processThumbQueue = useCallback(async () => {
    if (thumbWorkers.current >= THUMB_CONCURRENCY || thumbQueue.current.length === 0) return;
    thumbWorkers.current++;
    const file = thumbQueue.current.shift()!;
    try {
      const p = await getThumbnail(file);
      setThumbnails((prev) => ({ ...prev, [file]: assetUrl(p) }));
    } catch {
      setThumbnails((prev) => ({ ...prev, [file]: null }));
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
      const dir = await listDirectory(path);
      setListing(dir);
      if (dir.mediaFiles.length > 0) {
        const batch = await getProxiesBatch(dir.mediaFiles);
        setProxies(batch);
      } else {
        setProxies({});
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isOpen) loadDir(getParentDir(initialPath));
  }, [isOpen, initialPath]);

  // Queue thumbnail extraction whenever listing changes
  useEffect(() => {
    if (!listing || !isOpen) return;
    const toLoad = listing.mediaFiles.filter(
      (f) => getAssetType(f) === 'video' && thumbnails[f] === undefined,
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
        const batch = await getProxiesBatch(listing.mediaFiles).catch(() => ({}));
        setProxies(batch);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [isOpen, listing]);

  const handleGenerateAll = useCallback(async () => {
    if (!listing) return;
    const videoFiles = listing.mediaFiles.filter((f) => getAssetType(f) === 'video' && !proxies[f]);
    for (const f of videoFiles) {
      queueProxy(f)
        .then((proxyPath) => {
          setProxies((prev) => ({ ...prev, [f]: proxyPath }));
        })
        .catch(() => {});
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

  // Fetch drives when settings panel first opens
  useEffect(() => {
    if (!showSettings || allDrives.length > 0) return;
    listDrives()
      .then(setAllDrives)
      .catch(() => {});
  }, [showSettings, allDrives.length]);

  const toggleSuiteRoot = useCallback(
    (drive: string) => {
      const dNorm = normalizeDriveRoot(drive);
      const isActive = suiteRoots.some((r) => normalizeDriveRoot(r) === dNorm);
      const next = isActive
        ? suiteRoots.filter((r) => normalizeDriveRoot(r) !== dNorm)
        : [...suiteRoots, drive.endsWith('\\') || drive.endsWith('/') ? drive : drive + '\\'];
      updateSuiteRoots(next);
    },
    [suiteRoots, updateSuiteRoots],
  );

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

  const buildContextItems = useCallback(
    (menu: ContextMenuState): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];

      if (menu.type === 'folder') {
        const isSuite = isSuitePath(menu.target);
        const cached = isPrecached(menu.target);
        const loading = isSuiteLoading(menu.target);
        items.push({
          label: 'Open Folder',
          onClick: () => loadDir(menu.target),
        });
        if (isSuite) {
          items.push({ label: '──────────', disabled: true, onClick: () => {} });
          items.push({
            label: loading ? 'Working…' : cached ? 'Remove from Pre-cache' : 'Pre-cache Folder',
            disabled: loading,
            variant: cached ? 'danger' : 'default',
            onClick: () =>
              cached ? removeFromPrecache([menu.target]) : addToPrecache([menu.target]),
          });
        }
        return items;
      }

      // File context menu
      const filePath = menu.target;
      const isVideo = getAssetType(filePath) === 'video';
      const hasProxy = !!proxies[filePath];
      const isSuite = isSuitePath(filePath);
      const cached = isPrecached(filePath);
      const loading = isSuiteLoading(filePath);

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
              queueProxy(filePath)
                .then((p) => setProxies((prev) => ({ ...prev, [filePath]: p })))
                .catch(() => {});
            },
          });
        } else {
          items.push({
            label: 'Delete Proxy',
            variant: 'danger',
            onClick: async () => {
              await deleteProxy(filePath).catch(() => {});
              setProxies((prev) => {
                const n = { ...prev };
                delete n[filePath];
                return n;
              });
            },
          });
        }
      }

      items.push({ label: '──────────', disabled: true, onClick: () => {} });
      if (isSuite) {
        items.push({
          label: loading ? 'Working…' : cached ? 'Remove from Pre-cache' : 'Pre-cache File',
          disabled: loading,
          variant: cached ? 'danger' : 'default',
          onClick: () => togglePrecache(filePath),
        });
        const parentDir = getParentDir(filePath);
        const folderCached = isPrecached(parentDir);
        const folderLoading = isSuiteLoading(parentDir);
        items.push({
          label: folderLoading
            ? 'Working…'
            : folderCached
              ? 'Remove Folder Pre-cache'
              : 'Pre-cache Parent Folder',
          disabled: folderLoading,
          onClick: () =>
            folderCached ? removeFromPrecache([parentDir]) : addToPrecache([parentDir]),
        });
      } else {
        items.push({ label: 'Pre-cache File', disabled: true, onClick: () => {} });
      }

      return items;
    },
    [
      proxies,
      isSuitePath,
      isPrecached,
      isSuiteLoading,
      queueProxy,
      addToPrecache,
      removeFromPrecache,
      togglePrecache,
      onOpenFile,
      loadDir,
    ],
  );

  const currentDir = listing?.path ?? '';
  const isFolderSuite = isSuitePath(currentDir);
  const isFolderCached = isPrecached(currentDir);
  const isFolderLoading = isSuiteLoading(currentDir);
  const videoFilesWithoutProxy =
    listing?.mediaFiles.filter((f) => getAssetType(f) === 'video' && !proxies[f]) ?? [];

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

          <span
            className="flex-1 text-xs text-white/50 truncate font-mono"
            title={showSettings ? 'Settings' : currentDir}
          >
            {showSettings ? 'Suite Drive Settings' : currentDir || '…'}
          </span>

          <button
            onClick={() => setShowSettings((v) => !v)}
            title="Settings"
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              showSettings
                ? 'bg-white/15 text-white'
                : 'text-white/50 hover:text-white hover:bg-white/10'
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
        {!showSettings && (
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

            {isFolderSuite &&
              (isFolderCached ? (
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
              ))}
          </div>
        )}

        {/* Settings panel */}
        {showSettings && (
          <DriveSettingsPanel
            allDrives={allDrives}
            suiteRoots={suiteRoots}
            onboarding={!!onboarding}
            onOnboardingDone={onOnboardingDone}
            onToggle={toggleSuiteRoot}
          />
        )}

        {/* Two-column body */}
        <div className={`flex flex-1 overflow-hidden ${showSettings ? 'hidden' : ''}`}>
          {/* Left: subdirectories */}
          <div className="w-40 shrink-0 border-r border-white/8 overflow-y-auto py-1">
            {listing?.subdirs.map((dir) => {
              const dirSuite = isSuitePath(dir);
              const dirCached = isPrecached(dir);
              return (
                <button
                  key={dir}
                  onClick={() => loadDir(dir)}
                  onContextMenu={(e) => openFolderContextMenu(e, dir)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs text-white/60 hover:text-white hover:bg-white/8 transition-colors"
                >
                  <FolderIcon />
                  <span className="truncate flex-1">{getDirName(dir)}</span>
                  {dirSuite && dirCached && (
                    <CloudCheckIcon size={11} className="shrink-0 text-sky-400/70" />
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
              {listing?.mediaFiles.map((file) => {
                const ext = file.split('.').pop()?.toLowerCase() ?? '';
                const isPlaying = file === currentFilePath;
                const isSelected = selectedFiles.has(file);
                const hasProxy = !!proxies[file];
                const isSuite = isSuitePath(file);
                const cached = isPrecached(file);
                const cacheLoading = isSuiteLoading(file);
                const isVideo = getAssetType(file) === 'video';
                const cachedEntry = precachedEntryFor(file);
                const folderCached =
                  cachedEntry !== null && normalizePath(cachedEntry) !== normalizePath(file);

                const handleClick = (e: React.MouseEvent) => {
                  if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd+click: toggle this file in selection
                    setSelectedFiles((prev) => {
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
                    onContextMenu={(e) => openFileContextMenu(e, file)}
                  >
                    {/* Thumbnail or colored type block */}
                    <div
                      className="shrink-0 w-28 h-16 rounded overflow-hidden relative"
                      style={{ background: EXT_COLORS[ext] ?? '#2a2a2a' }}
                    >
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
                              ? 'Not a Suite asset'
                              : cacheLoading
                                ? 'Working…'
                                : folderCached
                                  ? 'Cached via parent folder'
                                  : cached
                                    ? 'Cached — click to remove'
                                    : 'Not pre-cached — click to add'
                          }
                          disabled={!isSuite || cacheLoading || folderCached}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSuite && !cacheLoading && !folderCached) togglePrecache(file);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                            !isSuite
                              ? 'text-white/12 cursor-default'
                              : cacheLoading
                                ? 'text-white/40 cursor-wait'
                                : folderCached
                                  ? 'text-sky-400 cursor-default'
                                  : cached
                                    ? 'text-sky-400 hover:text-red-400'
                                    : 'text-white/25 hover:text-sky-400'
                          }`}
                        >
                          {cacheLoading ? (
                            <SpinnerIcon size={11} />
                          ) : cached ? (
                            <CloudCheckIcon size={11} />
                          ) : (
                            <CloudIcon size={11} />
                          )}
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
