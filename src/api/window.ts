import { getCurrentWindow } from '@tauri-apps/api/window';

type ScheduleFrame = (callback: FrameRequestCallback) => number;

type Unlisten = () => void;

function defaultScheduleFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 0);
}

export function showMainWindowWhenReady(
  scheduleFrame: ScheduleFrame = defaultScheduleFrame,
): Promise<void> {
  return new Promise((resolve) => {
    scheduleFrame(() => {
      void getCurrentWindow().show().finally(resolve);
    });
  });
}

export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

export function toggleMaximizeWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

export function listenForOpenFile(onOpenFile: (path: string) => void): Promise<Unlisten> {
  return getCurrentWindow().listen<string[]>('open-file', (event) => {
    const [path] = event.payload;
    if (path) onOpenFile(path);
  });
}

export function listenForDroppedFile(onOpenFile: (path: string) => void): Promise<Unlisten> {
  return getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      const [path] = event.payload.paths;
      if (path) onOpenFile(path);
    }
  });
}
