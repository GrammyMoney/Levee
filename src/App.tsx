import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Player from './components/Player';
import { SuiteProvider } from './contexts/SuiteContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { ProxyProvider } from './contexts/ProxyContext';

export default function App() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [siblingFiles, setSiblingFiles] = useState<string[]>([]);

  const openFile = useCallback(async (path: string) => {
    setFilePath(path);
    const siblings = await invoke<string[]>('get_sibling_files', { path }).catch(() => []);
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
    getCurrentWindow()
      .listen<string[]>('open-file', e => { if (e.payload[0]) openFile(e.payload[0]); })
      .then(u => { cleanup = u; });
    getCurrentWindow()
      .onDragDropEvent(e => {
        if (e.payload.type === 'drop' && e.payload.paths.length > 0) openFile(e.payload.paths[0]);
      })
      .then(u => { const prev = cleanup; cleanup = () => { prev?.(); u(); }; });
    return () => cleanup?.();
  }, [openFile]);

  const providers = (node: React.ReactNode) => (
    <SettingsProvider>
      <SuiteProvider>
        <ProxyProvider>
          {node}
        </ProxyProvider>
      </SuiteProvider>
    </SettingsProvider>
  );

  if (!filePath) {
    return providers(
      <DropZone onPickFile={async () => {
        const path = await invoke<string | null>('pick_file').catch(() => null);
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
    <div
      className="flex flex-col items-center justify-center w-full h-full bg-black gap-6 cursor-default"
      onClick={onPickFile}
    >
      <div className="flex flex-col items-center gap-3 opacity-40">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="white" strokeWidth="1.5">
          <path d="M8 36V14a2 2 0 0 1 2-2h28a2 2 0 0 1 2 2v22" strokeLinecap="round" />
          <path d="M4 36h40" strokeLinecap="round" />
          <circle cx="24" cy="24" r="7" />
          <path d="M21 24l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-white text-sm tracking-widest uppercase">Levee</p>
      </div>
      <p className="text-white/30 text-xs">Click to open a file · Drop a file here</p>
    </div>
  );
}
