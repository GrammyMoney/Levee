import { useState, useCallback, useEffect } from 'react';
import Player from './components/Player';
import Splash from './components/Splash';
import DefaultPlayerPrompt from './components/DefaultPlayerPrompt';
import { SuiteProvider } from './contexts/SuiteContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { ProxyProvider } from './contexts/ProxyContext';
import { getSiblingFiles, pickFile, takeLaunchFile } from './api/tauri';
import { closeWindow, listenForDroppedFile, listenForOpenFile, minimizeWindow, showMainWindowWhenReady } from './api/window';
import { CloseIcon, MinimizeIcon } from './components/icons';

export default function App() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [siblingFiles, setSiblingFiles] = useState<string[]>([]);
  // False until we've checked for a launch file; gates the splash vs DropZone.
  const [checkedLaunch, setCheckedLaunch] = useState(false);
  const [windowShown, setWindowShown] = useState(false);

  const openFile = useCallback(async (path: string) => {
    setFilePath(path);
    const siblings = await getSiblingFiles(path).catch(() => []);
    setSiblingFiles(siblings);
  }, []);

  const navigateFile = useCallback((delta: number) => {
    if (!filePath || siblingFiles.length === 0) return;
    const idx = siblingFiles.indexOf(filePath);
    if (idx === -1) return;
    const next = siblingFiles[(idx + delta + siblingFiles.length) % siblingFiles.length];
    if (next) openFile(next);
  }, [filePath, siblingFiles, openFile]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    // Cold start: pull any file the app was launched with (file association / CLI).
    // Race-free — works regardless of how long the webview took to mount.
    // Keep the splash up (don't reveal DropZone) until we know there's no file.
    takeLaunchFile()
      .then(p => { if (p) openFile(p); else setCheckedLaunch(true); })
      .catch(() => setCheckedLaunch(true));
    // Running instance: a second launch forwards the file via this event.
    listenForOpenFile(openFile).then(u => { cleanup = u; });
    listenForDroppedFile(openFile).then(u => {
      const prev = cleanup;
      cleanup = () => { prev?.(); u(); };
    });
    return () => cleanup?.();
  }, [openFile]);

  useEffect(() => {
    if (windowShown || (!checkedLaunch && !filePath)) return;

    let cancelled = false;
    showMainWindowWhenReady().then(() => {
      if (!cancelled) setWindowShown(true);
    });

    return () => { cancelled = true; };
  }, [checkedLaunch, filePath, windowShown]);

  const providers = (node: React.ReactNode) => (
    <SettingsProvider>
      <SuiteProvider>
        <ProxyProvider>
          {node}
          <DefaultPlayerPrompt />
        </ProxyProvider>
      </SuiteProvider>
    </SettingsProvider>
  );

  if (!filePath) {
    // Splash until we've confirmed there's no launch file — avoids the
    // DropZone flashing when Levee is opened as the default player.
    if (!checkedLaunch) {
      return providers(<Splash />);
    }
    return providers(
      <DropZone onPickFile={async () => {
        const path = await pickFile().catch(() => null);
        if (path) openFile(path);
      }} />
    );
  }

  return providers(
    <Player
      filePath={filePath}
      onOpenFile={openFile}
      onPrevFile={() => navigateFile(-1)}
      onNextFile={() => navigateFile(1)}
    />
  );
}

function DropZone({ onPickFile }: { onPickFile: () => void }) {
  return (
    <div className="flex flex-col w-full h-full bg-black cursor-default">
      {/* Drag region + window controls (frameless window) */}
      <div data-tauri-drag-region className="flex items-center justify-end px-2 py-2 shrink-0">
        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { void minimizeWindow(); }}
            className="flex items-center justify-center w-6 h-6 rounded text-white/30 hover:text-white hover:bg-white/15 transition-colors"
            title="Minimize"
          >
            <MinimizeIcon />
          </button>
          <button
            onClick={() => { void closeWindow(); }}
            className="flex items-center justify-center w-6 h-6 rounded text-white/30 hover:text-white hover:bg-red-500/70 transition-colors"
            title="Close"
          >
            <CloseIcon size={10} />
          </button>
        </div>
      </div>

      {/* Drop area */}
      <div className="flex flex-col items-center justify-center flex-1 gap-6" onClick={onPickFile}>
        <img
          src="/levee-logo.png"
          alt="Levee"
          className="w-44 opacity-90 select-none pointer-events-none"
          draggable={false}
        />
        <p className="text-white/30 text-xs">Click to open a file · Drop a file here</p>
      </div>
    </div>
  );
}
