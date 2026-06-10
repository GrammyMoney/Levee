import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { VideoPlayerState, VideoPlayerControls, PLAYBACK_RATES } from '../../hooks/useVideoPlayer';

interface Props {
  state: VideoPlayerState;
  controls: VideoPlayerControls;
  visible: boolean;
  metaPanelOpen: boolean;
  onToggleMetadata: () => void;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatTimecode(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00.0';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenth = Math.floor((s % 1) * 10);
  return `${m}:${sec.toString().padStart(2, '0')}.${tenth}`;
}

export default function Controls({ state, controls, visible, metaPanelOpen, onToggleMetadata }: Props) {
  const { currentTime, duration, volume, isMuted, playbackRate, isLooping } = state;
  const { seek, setVolume, setPlaybackRate, toggleLoop } = controls;

  const barRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const [showVolume, setShowVolume] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const remaining = duration > 0 ? duration - currentTime : 0;

  const getTimeFromClientX = useCallback((clientX: number) => {
    const bar = barRef.current;
    if (!bar || duration === 0) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  }, [duration]);

  const onBarMouseMove = (e: React.MouseEvent) => {
    const bar = barRef.current;
    if (!bar || duration === 0) return;
    const rect = bar.getBoundingClientRect();
    setHoverPos(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  const onBarMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsScrubbing(true);
    seek(getTimeFromClientX(e.clientX));
  };

  useEffect(() => {
    if (!isScrubbing) return;
    const onMove = (e: MouseEvent) => seek(getTimeFromClientX(e.clientX));
    const onUp = () => setIsScrubbing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isScrubbing, seek, getTimeFromClientX]);

  useEffect(() => {
    if (!showVolume && !showSettings) return;
    const onDown = () => { setShowVolume(false); setShowSettings(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [showVolume, showSettings]);

  const displayVolume = isMuted ? 0 : volume;

  return (
    <div
      className={`chrome absolute bottom-0 left-0 right-0 z-20 px-4 pt-2 pb-4 glass ${
        visible ? 'chrome-visible' : 'chrome-hidden'
      }`}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Progress bar row */}
      <div className="flex items-end gap-2 mb-1">
        <span className="text-white/70 text-xs tabular-nums w-10 text-right shrink-0 pb-0.5">
          {formatTime(currentTime)}
        </span>

        <div
          ref={barRef}
          className="flex-1 relative h-1 rounded-full bg-white/20 cursor-pointer group"
          onMouseMove={onBarMouseMove}
          onMouseLeave={() => setHoverPos(null)}
          onMouseDown={onBarMouseDown}
        >
          <div
            className="absolute inset-y-0 left-0 bg-white rounded-full pointer-events-none group-hover:bg-white/90"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
          {hoverPos !== null && duration > 0 && (
            <div
              className="absolute -translate-x-1/2 pointer-events-none z-20"
              style={{ left: `${hoverPos * 100}%`, bottom: 'calc(100% + 10px)' }}
            >
              <span className="block bg-black/50 backdrop-blur-sm rounded px-1.5 py-0.5 text-xs text-white/50 font-mono whitespace-nowrap">
                {formatTimecode(hoverPos * duration)}
              </span>
            </div>
          )}
        </div>

        <span className="text-white/70 text-xs tabular-nums w-10 shrink-0 pb-0.5">
          -{formatTime(remaining)}
        </span>
      </div>

      {/* Button row */}
      <div className="flex justify-end items-center gap-1">
        {/* Volume */}
        <div className="relative" onMouseDown={e => e.stopPropagation()}>
          {showVolume && (
            <div className="absolute bottom-full mb-2 right-0 glass rounded-lg p-3 flex flex-col items-center gap-2">
              <input
                type="range" min={0} max={1} step={0.02} value={displayVolume}
                onChange={e => setVolume(parseFloat(e.target.value))}
                className="h-20 w-4"
                style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
              />
              <span className="text-white/60 text-xs tabular-nums">{Math.round(displayVolume * 100)}%</span>
            </div>
          )}
          <ChromeButton title="Volume" active={showVolume}
            onClick={() => { setShowSettings(false); setShowVolume(v => !v); }}>
            <VolumeIcon muted={isMuted || volume === 0} />
          </ChromeButton>
        </div>

        {/* Settings */}
        <div className="relative" onMouseDown={e => e.stopPropagation()}>
          {showSettings && (
            <div className="absolute bottom-full mb-2 right-0 glass rounded-lg p-3 min-w-44 flex flex-col gap-3">
              <div>
                <p className="text-white/50 text-xs mb-1.5">Speed</p>
                <div className="flex flex-wrap gap-1">
                  {PLAYBACK_RATES.map(rate => (
                    <button key={rate} onClick={() => setPlaybackRate(rate)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        playbackRate === rate
                          ? 'bg-white text-black font-medium'
                          : 'text-white/70 hover:text-white hover:bg-white/15'
                      }`}>
                      {rate}×
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={toggleLoop}
                className={`flex items-center justify-between w-full text-sm transition-colors ${
                  isLooping ? 'text-white' : 'text-white/60 hover:text-white'
                }`}>
                <span>Loop</span>
                <TogglePill on={isLooping} />
              </button>
            </div>
          )}
          <ChromeButton title="Settings" active={showSettings}
            onClick={() => { setShowVolume(false); setShowSettings(v => !v); }}>
            <SettingsIcon />
          </ChromeButton>
        </div>

        {/* Metadata panel toggle */}
        <ChromeButton title="Info panel" active={metaPanelOpen} onClick={onToggleMetadata}>
          <MetadataIcon />
        </ChromeButton>
      </div>
    </div>
  );
}

function ChromeButton({ children, title, onClick, active }: {
  children: ReactNode; title?: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <button title={title} onClick={onClick}
      className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
        active ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/15'
      }`}>
      {children}
    </button>
  );
}

function TogglePill({ on }: { on: boolean }) {
  return (
    <div className={`w-8 h-4 rounded-full transition-colors ${on ? 'bg-white' : 'bg-white/25'}`}>
      <div className={`w-3 h-3 rounded-full bg-black m-0.5 transition-transform ${on ? 'translate-x-4' : ''}`} />
    </div>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zm7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0z" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z" />
      <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z" />
      <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.475l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
    </svg>
  );
}

function MetadataIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M5 5.5h6M5 8h6M5 10.5h4" strokeLinecap="round" />
    </svg>
  );
}
