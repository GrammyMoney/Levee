import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMpvPlayer } from '../../hooks/useMpvPlayer';
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
  const { state, controls, openFile } = useMpvPlayer();
  const { isVisible, show, hide } = useAutoHide(2000);
  const { isManaged, refreshPrecache } = useSuite();
  const {
    preferProxies, setPreferProxies,
    defaultPlayerPrompted, suiteOnboarded, setSuiteOnboarded,
  } = useSettings();
  const { queueProxy } = useProxy();

  const [proxyPath, setProxyPath] = useState<string | null>(null);
  const [metaPanelOpen, setMetaPanelOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);

  // After the "set as default" prompt, walk new users through setting their
  // Suite drive: open the library settings with a highlighted tooltip.
  useEffect(() => {
    if (defaultPlayerPrompted && !suiteOnboarded) {
      setLibraryOpen(true);
      setOnboarding(true);
    }
  }, [defaultPlayerPrompted, suiteOnboarded]);

  const currentTimeRef = useRef(0);
  useEffect(() => { currentTimeRef.current = state.currentTime; }, [state.currentTime]);

  // Check for an existing proxy when the original file changes
  useEffect(() => {
    if (isManaged(filePath)) refreshPrecache();
    if (getAssetType(filePath) !== 'video') { setProxyPath(null); return; }
    let cancelled = false;
    invoke<string | null>('get_proxy', { originalPath: filePath })
      .then(p => { if (!cancelled) setProxyPath(p ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filePath]);

  // The path actually fed to mpv (proxy is just a lighter file mpv plays natively)
  const activePath = (preferProxies && proxyPath) ? proxyPath : filePath;

  // Load into mpv whenever the active path changes
  const prevPathRef = useRef('');
  useEffect(() => {
    if (activePath === prevPathRef.current) return;
    prevPathRef.current = activePath;
    openFile(activePath);
  }, [activePath, openFile]);

  const handleToggleProxy = useCallback(() => {
    if (!proxyPath) return;
    const resume = currentTimeRef.current;
    const next = (!preferProxies && proxyPath) ? proxyPath : filePath;
    setPreferProxies(!preferProxies);
    prevPathRef.current = next;
    openFile(next, resume);
  }, [proxyPath, preferProxies, setPreferProxies, filePath, openFile]);

  const handleGenerateProxy = useCallback(async () => {
    try {
      const path = await queueProxy(filePath);
      setProxyPath(path);
    } catch {}
  }, [filePath, queueProxy]);

  // P key: toggle proxy/original if proxy exists, else generate one
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
    // No bg — mpv renders behind the transparent WebView via DirectComposition.
    <div
      className="relative w-full h-full overflow-hidden"
      onMouseMove={show}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ cursor: chromeVisible ? 'default' : 'none' }}
    >
      <VideoElement onClick={controls.toggle} />

      <TopBar
        fileName={fileName}
        filePath={filePath}
        visible={chromeVisible}
        libraryOpen={libraryOpen}
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
        onboarding={onboarding}
        onOnboardingDone={() => { setOnboarding(false); setSuiteOnboarded(true); }}
        onOpenFile={path => { onOpenFile(path); setLibraryOpen(false); }}
        onClose={() => setLibraryOpen(false)}
      />
    </div>
  );
}
