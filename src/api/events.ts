import { listen } from '@tauri-apps/api/event';

export interface MpvRawState {
  timePos: number;
  duration: number;
  paused: boolean;
  volume: number;
  speed: number;
  eof: boolean;
}

export function listenMpvState(onState: (state: MpvRawState) => void): Promise<() => void> {
  return listen<MpvRawState>('mpv-state', ({ payload }) => onState(payload));
}
