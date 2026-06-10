import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useVideoPlayer } from '../../hooks/useVideoPlayer';
import { useAutoHide } from '../../hooks/useAutoHide';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { getFileName, getAssetType } from '../../types';
import { useSuite } from '../../contexts/SuiteContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useProxy } from '../../contexts/ProxyContext';
import VideoElement from './VideoElement';
import TopBar from './TopBar';
import Controls from './Controls';
import ChevronNav from './ChevronNav';
import MetadataPanel from '../MetadataPanel';
import Library from '../Library';

interface Props {
  filePath: string;
  onOpenFile: (path: string) => void;
  onPrevFile: () => void;
  onNextFile: () => void;
}

export default function Player({ filePath, onOpenFile, onPrevFile, onNextFile }: Props) {
  const { videoRef, state, controls, eventHandlers } = useVideoPlayer();
  const { isVisible, show, hide } = useAutoHide(2000);
  const { isSuitePath, refreshPrecache } = useSuite();
  const { preferProxies, setPreferProxies } = useSettings();
  const { queueProxy } = useProxy();

  const [proxyPath, setProxyPath] = useState<string | null>(null);
  const [metaPanelOpen, setMetaPanelOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Check for existing proxy when file changes
  useEffect(() => {
    if (isSuitePath(filePath)) refreshPrecache();
    if (getAssetType(filePath) !== 'video') { setProxyPath(null); return; }
    let cancelled = false;
    invoke<string | null>('get_proxy', { originalPath: filePath })
      .then(p => { if (!cancelled) setProxyPath(p ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filePath]);

  const activeSrc = (preferProxies && proxyPath)
    ? convertFileSrc(proxyPath)
    : convertFileSrc(filePath);

  // Restore playback position after proxy/original swap
  const pendingSeekRef = useRef<{ time: number; playing: boolean } | null>(null);
  useEffect(() => { pendingSeekRef.current = null; }, [filePath]);
  useEffect(() => {
    const video = videoRef.current;
    const pending = pendingSeekRef.current;
    if (!video || !pending) return;
    const onLoaded = () => {
      video.currentTime = pending.time;
      if (pending.playing) video.play().catch(() => {});
      pendingSeekRef.current = null;
    };
    video.addEventListener('loadedmetadata', onLoaded);
    return () => video.removeEventListener('loadedmetadata', onLoaded);
  }, [activeSrc]);

  const handleToggleProxy = useCallback(() => {
    if (!proxyPath) return;
    const video = videoRef.current;
    if (video) {
      pendingSeekRef.current = { time: video.currentTime, playing: !video.paused };
    }
    setPreferProxies(!preferProxies);
  }, [proxyPath, preferProxies, setPreferProxies]);

  const handleGenerateProxy = useCallback(async () => {
    try {
      const path = await queueProxy(filePath);
      setProxyPath(path);
    } catch {}
  }, [filePath, queueProxy]);

  // P key: toggle proxy/original if proxy exists, or generate one
  useEffect(() => {
    if (getAssetType(filePath) !== 'video') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      if (proxyPath) handleToggleProxy();
      else handleGenerateProxy();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filePath, proxyPath, handleToggleProxy, handleGenerateProxy]);

  const chromeVisible = isVisible || !state.isPlaying || libraryOpen;
  const fileName = getFileName(filePath);

  const handleOpenFile = useCallback(async () => {
    const path = await invoke<string | null>('pick_file').catch(() => null);
    if (path) onOpenFile(path);
  }, [onOpenFile]);

  useKeyboardShortcuts({
    ...controls,
    prevFile: onPrevFile,
    nextFile: onNextFile,
  });

  return (
    <div
      className="relative w-full h-full bg-black overflow-hidden"
      onMouseMove={show}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ cursor: chromeVisible ? 'default' : 'none' }}
    >
      <VideoElement
        ref={videoRef}
        src={activeSrc}
        onClick={controls.toggle}
        {...eventHandlers}
      />

      <TopBar
        fileName={fileName}
        filePath={filePath}
        visible={chromeVisible}
        hasProxy={!!proxyPath}
        isPlayingProxy={preferProxies && !!proxyPath}
        onToggleProxy={handleToggleProxy}
        onOpenFile={handleOpenFile}
        onOpenLibrary={() => setLibraryOpen(true)}
      />

      <ChevronNav
        visible={chromeVisible}
        metaPanelOpen={metaPanelOpen}
        libraryOpen={libraryOpen}
        onPrev={onPrevFile}
        onNext={onNextFile}
      />

      <Controls
        state={state}
        controls={controls}
        visible={chromeVisible}
        metaPanelOpen={metaPanelOpen}
        onToggleMetadata={() => setMetaPanelOpen(v => !v)}
      />

      <MetadataPanel
        isOpen={metaPanelOpen}
        filePath={filePath}
        onClose={() => setMetaPanelOpen(false)}
      />

      <Library
        isOpen={libraryOpen}
        initialPath={filePath}
        currentFilePath={filePath}
        onOpenFile={path => { onOpenFile(path); setLibraryOpen(false); }}
        onClose={() => setLibraryOpen(false)}
      />
    </div>
  );
}
