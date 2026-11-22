import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal/drawer accessibility: closes on Escape, keeps Tab focus inside the
 * dialog, and restores focus to the trigger when it unmounts.
 */
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void
) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;

    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));

    // Prefer the first text field so typing can start immediately.
    const target = node.querySelector<HTMLElement>("input, textarea") || items()[0] || node;
    const timer = window.setTimeout(() => target.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = items();
      if (!focusables.length) {
        e.preventDefault();
        return;
      }
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        if (index <= 0) {
          e.preventDefault();
          focusables[focusables.length - 1].focus();
        }
      } else if (index === -1 || index === focusables.length - 1) {
        e.preventDefault();
        focusables[0].focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open]);

  return ref;
}
