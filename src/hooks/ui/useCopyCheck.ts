/**
 * useCopyCheck — icon swap from Copy → Check on successful copy.
 *
 * Shows a checkmark for `durationMs` (default 5 s) after a successful copy,
 * then reverts to the default icon. Pairs with a toast/Message on success.
 * A copy that rejects leaves the icon untouched; the pending timer is cleared
 * on unmount.
 *
 * @param onCopy - Async callback that performs the copy (clipboard write, etc.)
 * @param options.durationMs - How long the checkmark stays visible
 * @returns { copied, handleCopy } — `copied` drives the icon swap, `handleCopy` is the click handler
 *
 * @example
 * ```tsx
 * import { Copy01Icon, HugeiconsIcon, Tick01Icon } from "@src/icons";
 * import { useCopyCheck } from "@src/hooks/ui/useCopyCheck";
 *
 * const { copied, handleCopy } = useCopyCheck(async () => {
 *   await copyText(secret);
 *   Message.success({ content: t("common:status.copied") });
 * });
 *
 * <button onClick={handleCopy}>
 *   <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} size={13} />
 * </button>
 * ```
 *
 * For a list where each row has its own copy button, use `useKeyedCopyCheck`
 * so the flash follows the row that was actually copied.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const CHECK_DURATION_MS = 5_000;

export interface UseCopyCheckOptions {
  /** How long the checkmark stays visible after a successful copy (ms). */
  durationMs?: number;
}

/**
 * Keyed variant of `useCopyCheck` for lists: `handleCopy(key)` runs
 * `onCopy(key)` and, on success, exposes that key as `copiedKey` for
 * `durationMs`. Only one key flashes at a time — copying another row replaces
 * it and restarts the timer. `reset()` ends the flash early (e.g. when the
 * list is cleared). The key can be any value the caller wants to compare
 * against in render (an id string, the row object, ...).
 */
export function useKeyedCopyCheck<K>(
  onCopy: (key: K) => Promise<void>,
  options?: UseCopyCheckOptions
): {
  copiedKey: K | null;
  handleCopy: (key: K) => void;
  reset: () => void;
} {
  const durationMs = options?.durationMs ?? CHECK_DURATION_MS;
  const [copiedKey, setCopiedKey] = useState<K | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setCopiedKey(null);
  }, [clearTimer]);

  const handleCopy = useCallback(
    (key: K) => {
      onCopy(key)
        .then(() => {
          // A copy that settles after unmount must not schedule a timer the
          // cleanup effect can no longer cancel.
          if (!mountedRef.current) return;
          clearTimer();
          setCopiedKey(key);
          timerRef.current = setTimeout(() => {
            setCopiedKey(null);
            timerRef.current = null;
          }, durationMs);
        })
        .catch(() => {
          // Copy failed — don't flip icon
        });
    },
    [clearTimer, durationMs, onCopy]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  return { copiedKey, handleCopy, reset };
}

export function useCopyCheck(
  onCopy: () => Promise<void>,
  options?: UseCopyCheckOptions
): {
  copied: boolean;
  handleCopy: () => void;
} {
  const { copiedKey, handleCopy: handleKeyedCopy } = useKeyedCopyCheck<true>(
    onCopy,
    options
  );
  const handleCopy = useCallback(
    () => handleKeyedCopy(true),
    [handleKeyedCopy]
  );

  return { copied: copiedKey === true, handleCopy };
}
