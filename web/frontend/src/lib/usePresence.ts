import { useEffect, useState } from "react";

/**
 * Keeps an overlay mounted for `exitMs` after `open` turns false so its exit
 * animation can play. Returns whether it should render and whether it is
 * currently closing (so the caller can swap in the `-out` animation class).
 */
export function usePresence(open: boolean, exitMs = 170) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, exitMs]);

  return { mounted, closing };
}
