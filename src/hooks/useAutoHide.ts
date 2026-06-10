import { useState, useCallback, useRef, useEffect } from 'react';

export function useAutoHide(delay = 2000) {
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(() => {
    setIsVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsVisible(false), delay);
  }, [delay]);

  const showPermanent = useCallback(() => {
    clearTimeout(timerRef.current);
    setIsVisible(true);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setIsVisible(false);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { isVisible, show, showPermanent, hide };
}
