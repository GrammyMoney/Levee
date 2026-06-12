import { getCurrentWindow } from '@tauri-apps/api/window';

type ScheduleFrame = (callback: FrameRequestCallback) => number;

function defaultScheduleFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 0);
}

export function showMainWindowWhenReady(
  scheduleFrame: ScheduleFrame = defaultScheduleFrame,
): Promise<void> {
  return new Promise(resolve => {
    scheduleFrame(() => {
      void getCurrentWindow().show().finally(resolve);
    });
  });
}
