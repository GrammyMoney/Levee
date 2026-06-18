import {
  CloudCheckIcon,
  CloudIcon,
  CloseIcon,
  ExternalLinkIcon,
  FolderIcon,
  MaximizeIcon,
  MinimizeIcon,
  OpenFileIcon,
  SpinnerIcon,
} from '../icons';
import { useSuite } from '../../contexts/SuiteContext';
import { openFolder } from '../../api/tauri';
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '../../api/window';
import { accentFor, pinVerb } from '../../accent';

interface Props {
  fileName: string;
  filePath: string;
  visible: boolean;
  libraryOpen?: boolean;
  hasProxy?: boolean;
  isPlayingProxy?: boolean;
  onToggleProxy?: () => void;
  onOpenFile: () => void;
  onOpenLibrary: () => void;
}

export default function TopBar({
  fileName,
  filePath,
  visible,
  libraryOpen,
  hasProxy,
  isPlayingProxy,
  onToggleProxy,
  onOpenFile,
  onOpenLibrary,
}: Props) {
  const { providerFor, isPrecached, precachedEntryFor, isLoading, togglePrecache } = useSuite();
  const provider = providerFor(filePath);
  const isManagedFile = provider !== 'local';
  const precached = isPrecached(filePath);
  const loading = isLoading(filePath);
  const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/');
  const cachedEntry = precachedEntryFor(filePath);
  // True when cached via a parent folder entry — show active state but disable interaction
  const folderCached = cachedEntry !== null && norm(cachedEntry) !== norm(filePath);
  // LucidLink "pins" (lime accent), Suite "pre-caches" (sky accent).
  const a = accentFor(provider);
  const { verb, done: cachedLabel } = pinVerb(provider);

  const openInExplorer = () => {
    openFolder(filePath).catch(() => {});
  };

  return (
    <div
      data-tauri-drag-region
      className={`chrome absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-3 glass ${
        visible ? 'chrome-visible' : 'chrome-hidden'
      }`}
    >
      {/* Library browser + filename — faded out while the library panel is open
          (it overlaps this area and is hard to read otherwise). */}
      <button
        className={`flex items-center justify-center w-7 h-7 rounded hover:bg-white/15 transition-all duration-300 text-white/80 hover:text-white shrink-0 ${
          libraryOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        onClick={onOpenLibrary}
        title="Browse folder"
      >
        <FolderIcon size={16} className={undefined} />
      </button>
      <span
        className={`text-sm font-medium text-white truncate transition-opacity duration-300 ${
          libraryOpen ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {fileName}
      </span>

      <span className="flex-1" />
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
          title={
            isPlayingProxy
              ? 'Playing proxy · press P to switch to original'
              : 'Original · press P to switch to proxy'
          }
          className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm font-bold transition-all shrink-0 ${
            isPlayingProxy
              ? 'bg-violet-500/35 text-violet-300 ring-1 ring-violet-400/40 hover:bg-violet-500/50'
              : 'bg-white/8 text-white/30 hover:bg-white/15 hover:text-white/60'
          }`}
        >
          P
        </button>
      )}

      {/* Cache/pin badge — always visible; interactive for managed drives only */}
      <button
        onClick={() => {
          if (isManagedFile && !loading && !folderCached) togglePrecache(filePath);
        }}
        disabled={!isManagedFile || loading || folderCached}
        title={
          !isManagedFile
            ? 'Not on a cloud-streamed drive'
            : loading
              ? 'Working…'
              : folderCached
                ? 'Cached via parent folder'
                : precached
                  ? `${cachedLabel} locally — click to remove`
                  : `Click to ${verb.toLowerCase()} this asset`
        }
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
          !isManagedFile
            ? 'bg-white/6 text-white/20 cursor-default'
            : loading
              ? 'bg-white/10 text-white/40 cursor-wait'
              : folderCached
                ? `${a.bg} ${a.text} cursor-default`
                : precached
                  ? `${a.bg} ${a.text} ${a.hover}`
                  : 'bg-white/10 text-white/50 hover:bg-white/18 hover:text-white/80'
        }`}
      >
        {loading ? <SpinnerIcon /> : precached ? <CloudCheckIcon /> : <CloudIcon />}
        <span>
          {!isManagedFile ? 'Local' : loading ? 'Working…' : precached ? cachedLabel : verb}
        </span>
      </button>

      {/* Open file */}
      <button
        className="flex items-center justify-center w-7 h-7 rounded hover:bg-white/15 transition-colors text-white/80 hover:text-white shrink-0"
        onClick={onOpenFile}
        title="Open file"
      >
        <OpenFileIcon />
      </button>

      {/* Window controls (frameless window) */}
      <div className="flex items-center gap-0.5 ml-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => {
            void minimizeWindow();
          }}
          className="flex items-center justify-center w-6 h-6 rounded text-white/40 hover:text-white hover:bg-white/15 transition-colors"
          title="Minimize"
        >
          <MinimizeIcon />
        </button>
        <button
          onClick={() => {
            void toggleMaximizeWindow();
          }}
          className="flex items-center justify-center w-6 h-6 rounded text-white/40 hover:text-white hover:bg-white/15 transition-colors"
          title="Maximize"
        >
          <MaximizeIcon />
        </button>
        <button
          onClick={() => {
            void closeWindow();
          }}
          className="flex items-center justify-center w-6 h-6 rounded text-white/40 hover:text-white hover:bg-red-500/70 transition-colors"
          title="Close"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
