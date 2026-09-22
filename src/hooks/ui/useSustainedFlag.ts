import { useEffect, useState } from "react";

/**
 * Reports `value` only once it has stayed true for `delayMs`; drops back to
 * false the moment it goes false.
 *
 * For state that is technically correct but too brief to act on — a notice that
 * would otherwise flash for a tooltip or a hover-open sidebar.
 */
export function useSustainedFlag(value: boolean, delayMs: number): boolean {
  // Derived-from-previous-render state: reset synchronously during render when
  // `value` flips, so the falling edge never needs an effect to undo itself.
  const [elapsed, setElapsed] = useState<{ of: boolean; done: boolean }>({
    of: value,
    done: false,
  });
  if (elapsed.of !== value) setElapsed({ of: value, done: false });

  useEffect(() => {
    if (!value || delayMs <= 0) return;
    const timer = window.setTimeout(
      () => setElapsed({ of: true, done: true }),
      delayMs
    );
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  if (!value) return false;
  if (delayMs <= 0) return true;
  return elapsed.of === value && elapsed.done;
}
