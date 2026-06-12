import { useState, useCallback, useEffect, useRef } from 'react';
import { mpvFrameStep, mpvLoad, mpvSeek, mpvSeekBy, mpvSetLoop, mpvSetMute, mpvSetPause, mpvSetSpeed, mpvSetVolume } from '../api/tauri';
import { listenMpvState } from '../api/events';
import type { VideoPlayerState, VideoPlayerControls } from './useVideoPlayer';

export { PLAYBACK_RATES } from './useVideoPlayer';

const PLAYBACK_RATES_MPV = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function useMpvPlayer() {
  const [state, setState] = useState<VideoPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    playbackRate: 1,
    isLooping: false,
  });

  const muteRef = useRef(false);
  const loopRef = useRef(false);
  // Resume position to apply once a freshly-loaded file reports a duration.
  const pendingSeekRef = useRef<number | null>(null);

  useEffect(() => {
    const unlisten = listenMpvState(s => {
      // Apply a pending resume seek once the new file has a known duration.
      if (pendingSeekRef.current != null && s.duration > 0) {
        const t = pendingSeekRef.current;
        pendingSeekRef.current = null;
        mpvSeek(t).catch(() => {});
      }
      setState(prev => ({
        ...prev,
        isPlaying: !s.paused && !s.eof,
        currentTime: s.timePos,
        duration: s.duration,
        volume: s.volume / 100,
        playbackRate: s.speed,
      }));
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const openFile = useCallback((path: string, seekTo?: number) => {
    pendingSeekRef.current = seekTo && seekTo > 0 ? seekTo : null;
    setState(prev => ({ ...prev, currentTime: 0, duration: 0 }));
    mpvLoad(path).catch(err => console.error('[mpv] load failed:', err));
  }, []);

  const play = useCallback(() => { mpvSetPause(false).catch(() => {}); }, []);
  const pause = useCallback(() => { mpvSetPause(true).catch(() => {}); }, []);

  const toggle = useCallback(() => {
    setState(prev => {
      mpvSetPause(prev.isPlaying).catch(() => {});
      return prev;
    });
  }, []);

  const seek = useCallback((time: number) => {
    mpvSeek(time).catch(() => {});
  }, []);

  const seekBy = useCallback((delta: number) => {
    mpvSeekBy(delta).catch(() => {});
  }, []);

  const stepFrame = useCallback((direction: 1 | -1) => {
    mpvFrameStep(direction).catch(() => {});
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    muteRef.current = false;
    mpvSetVolume(clamped * 100).catch(() => {});
    mpvSetMute(false).catch(() => {});
    setState(prev => ({ ...prev, volume: clamped, isMuted: false }));
  }, []);

  const toggleMute = useCallback(() => {
    muteRef.current = !muteRef.current;
    mpvSetMute(muteRef.current).catch(() => {});
    setState(prev => ({ ...prev, isMuted: muteRef.current }));
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    mpvSetSpeed(rate).catch(() => {});
    setState(prev => ({ ...prev, playbackRate: rate }));
  }, []);

  const cyclePlaybackRate = useCallback((direction: 1 | -1) => {
    setState(prev => {
      const idx = PLAYBACK_RATES_MPV.indexOf(prev.playbackRate);
      const next = idx === -1
        ? 3
        : Math.max(0, Math.min(PLAYBACK_RATES_MPV.length - 1, idx + direction));
      setPlaybackRate(PLAYBACK_RATES_MPV[next]);
      return prev;
    });
  }, [setPlaybackRate]);

  const toggleLoop = useCallback(() => {
    loopRef.current = !loopRef.current;
    mpvSetLoop(loopRef.current).catch(() => {});
    setState(prev => ({ ...prev, isLooping: loopRef.current }));
  }, []);

  const controls: VideoPlayerControls = {
    play, pause, toggle, seek, seekBy, stepFrame,
    setVolume, toggleMute, setPlaybackRate, cyclePlaybackRate, toggleLoop,
  };

  return { state, controls, openFile };
}
