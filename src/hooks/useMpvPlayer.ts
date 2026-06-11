import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { VideoPlayerState, VideoPlayerControls } from './useVideoPlayer';

export { PLAYBACK_RATES } from './useVideoPlayer';

// Raw state emitted by the Rust event-pump thread (serde camelCase).
interface MpvRawState {
  timePos: number;
  duration: number;
  paused: boolean;
  volume: number; // 0–100
  speed: number;
  eof: boolean;
}

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
    const unlisten = listen<MpvRawState>('mpv-state', ({ payload: s }) => {
      // Apply a pending resume seek once the new file has a known duration.
      if (pendingSeekRef.current != null && s.duration > 0) {
        const t = pendingSeekRef.current;
        pendingSeekRef.current = null;
        invoke('mpv_seek', { time: t }).catch(() => {});
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
    invoke('mpv_load', { path }).catch(err => console.error('[mpv] load failed:', err));
  }, []);

  const play = useCallback(() => { invoke('mpv_set_pause', { paused: false }).catch(() => {}); }, []);
  const pause = useCallback(() => { invoke('mpv_set_pause', { paused: true }).catch(() => {}); }, []);

  const toggle = useCallback(() => {
    setState(prev => {
      invoke('mpv_set_pause', { paused: prev.isPlaying }).catch(() => {});
      return prev;
    });
  }, []);

  const seek = useCallback((time: number) => {
    invoke('mpv_seek', { time }).catch(() => {});
  }, []);

  const seekBy = useCallback((delta: number) => {
    invoke('mpv_seek_by', { delta }).catch(() => {});
  }, []);

  const stepFrame = useCallback((direction: 1 | -1) => {
    invoke('mpv_frame_step', { direction }).catch(() => {});
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    muteRef.current = false;
    invoke('mpv_set_volume', { volume: clamped * 100 }).catch(() => {});
    invoke('mpv_set_mute', { muted: false }).catch(() => {});
    setState(prev => ({ ...prev, volume: clamped, isMuted: false }));
  }, []);

  const toggleMute = useCallback(() => {
    muteRef.current = !muteRef.current;
    invoke('mpv_set_mute', { muted: muteRef.current }).catch(() => {});
    setState(prev => ({ ...prev, isMuted: muteRef.current }));
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    invoke('mpv_set_speed', { speed: rate }).catch(() => {});
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
    invoke('mpv_set_loop', { looping: loopRef.current }).catch(() => {});
    setState(prev => ({ ...prev, isLooping: loopRef.current }));
  }, []);

  const controls: VideoPlayerControls = {
    play, pause, toggle, seek, seekBy, stepFrame,
    setVolume, toggleMute, setPlaybackRate, cyclePlaybackRate, toggleLoop,
  };

  return { state, controls, openFile };
}
