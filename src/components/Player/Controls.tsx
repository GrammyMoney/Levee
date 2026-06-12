import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { GearIcon, MetadataIcon, PauseIcon, PlayIcon, VolumeIcon } from '../icons';
import { VideoPlayerState, VideoPlayerControls, PLAYBACK_RATES } from '../../domain/player';

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
  const { currentTime, duration, volume, isMuted, playbackRate, isLooping, isPlaying } = state;
  const { seek, setVolume, setPlaybackRate, toggleLoop, toggle } = controls;

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
      <div className="flex items-center gap-1">
        {/* Play / Pause */}
        <ChromeButton title={isPlaying ? 'Pause' : 'Play'} onClick={toggle}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </ChromeButton>

        <div className="flex-1" />

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
            <GearIcon />
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





