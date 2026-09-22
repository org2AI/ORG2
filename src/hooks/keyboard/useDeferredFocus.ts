import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

/** At most one queued focus, owned by the currently active view. */
export function useDeferredFocus(
  inputRef: RefObject<HTMLInputElement | null> | undefined,
  enabled: boolean
) {
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useLayoutEffect(() => {
    active.current = enabled;
    return () => {
      active.current = false;
      cancel();
    };
  }, [enabled, cancel]);
  return useCallback(() => {
    cancel();
    if (!active.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (active.current) inputRef?.current?.focus();
    }, 0);
  }, [cancel, inputRef]);
}
