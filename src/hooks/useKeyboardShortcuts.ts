import { useEffect, useRef } from 'react';
import { VideoPlayerControls } from './useVideoPlayer';

interface ShortcutHandlers extends VideoPlayerControls {
  prevFile: () => void;
  nextFile: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  useEffect(() => { ref.current = handlers; });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) return;

      const h = ref.current;
      switch (e.key) {
        case ' ':            e.preventDefault(); h.toggle();              break;
        case 'k': case 'K': e.preventDefault(); h.toggle();              break;
        case 'j': case 'J': e.preventDefault(); h.seekBy(-15);           break;
        case 'l': case 'L': e.preventDefault(); h.seekBy(15);            break;
        case 'h': case 'H': e.preventDefault(); h.prevFile();            break;
        case ';':            e.preventDefault(); h.nextFile();            break;
        case ',':            e.preventDefault(); h.stepFrame(-1);         break;
        case '.':            e.preventDefault(); h.stepFrame(1);          break;
        case '-':            e.preventDefault(); h.cyclePlaybackRate(-1); break;
        case '=':            e.preventDefault(); h.cyclePlaybackRate(1);  break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
