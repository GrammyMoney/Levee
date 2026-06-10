import { useRef, useState, useCallback, useEffect } from 'react';

export interface VideoPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isLooping: boolean;
}

export interface VideoPlayerControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  seekBy: (delta: number) => void;
  stepFrame: (direction: 1 | -1) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  cyclePlaybackRate: (direction: 1 | -1) => void;
  toggleLoop: () => void;
}

export interface VideoEventHandlers {
  onPlay: () => void;
  onPause: () => void;
  onTimeUpdate: () => void;
  onDurationChange: () => void;
  onVolumeChange: () => void;
  onEnded: () => void;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const FRAME_DURATION = 1 / 30;

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [state, setState] = useState<VideoPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    playbackRate: 1,
    isLooping: false,
  });

  const play = useCallback(() => { videoRef.current?.play(); }, []);
  const pause = useCallback(() => { videoRef.current?.pause(); }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v || v.duration === 0) return;
    v.currentTime = Math.max(0, Math.min(v.duration, time));
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    seek(v.currentTime + delta);
  }, [seek]);

  const stepFrame = useCallback((direction: 1 | -1) => {
    const v = videoRef.current;
    if (!v || !v.paused) return;
    seek(v.currentTime + direction * FRAME_DURATION);
  }, [seek]);

  const setVolume = useCallback((vol: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, vol));
    v.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setState(s => ({ ...s, playbackRate: rate }));
  }, []);

  const cyclePlaybackRate = useCallback((direction: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    const idx = PLAYBACK_RATES.indexOf(v.playbackRate);
    const next = idx === -1
      ? 3
      : Math.max(0, Math.min(PLAYBACK_RATES.length - 1, idx + direction));
    setPlaybackRate(PLAYBACK_RATES[next]);
  }, [setPlaybackRate]);

  const toggleLoop = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.loop = !v.loop;
    setState(s => ({ ...s, isLooping: v.loop }));
  }, []);

  const onPlay     = useCallback(() => setState(s => ({ ...s, isPlaying: true })), []);
  const onPause    = useCallback(() => setState(s => ({ ...s, isPlaying: false })), []);
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v) setState(s => ({ ...s, currentTime: v.currentTime }));
  }, []);
  const onDurationChange = useCallback(() => {
    const v = videoRef.current;
    if (v) setState(s => ({ ...s, duration: v.duration || 0 }));
  }, []);
  const onVolumeChange = useCallback(() => {
    const v = videoRef.current;
    if (v) setState(s => ({ ...s, volume: v.volume, isMuted: v.muted }));
  }, []);
  const onEnded = useCallback(() => setState(s => ({ ...s, isPlaying: false })), []);

  useEffect(() => {
    setState(s => ({ ...s, currentTime: 0, duration: 0, isPlaying: false }));
  }, []);

  const controls: VideoPlayerControls = {
    play, pause, toggle, seek, seekBy, stepFrame,
    setVolume, toggleMute, setPlaybackRate, cyclePlaybackRate, toggleLoop,
  };

  const eventHandlers: VideoEventHandlers = {
    onPlay, onPause, onTimeUpdate, onDurationChange, onVolumeChange, onEnded,
  };

  return { videoRef, state, controls, eventHandlers };
}

export { PLAYBACK_RATES };
