import { createLogger } from "@src/hooks/logger";

const log = createLogger("Tauri");

/**
 * Safely call an unlisten function to prevent race condition errors
 * Use this when cleaning up Tauri event listeners in useEffect cleanup functions
 *
 * @param unlistenFn - The unlisten function returned by listen() or watch()
 * @param options - Optional configuration
 * @param options.defer - If true, defers cleanup to next tick (default: true)
 * @param options.silent - If true, doesn't log warnings (default: true)
 *
 * @example
 * ```ts
 * useEffect(() => {
 *   let unlisten: UnlistenFn | null = null;
 *   listen("my-event", handler).then(fn => { unlisten = fn; });
 *   return () => safeUnlisten(unlisten);
 * }, []);
 * ```
 */
export function safeUnlisten(
  unlistenFn: (() => void) | null | undefined,
  options?: { defer?: boolean; silent?: boolean }
): void {
  if (!unlistenFn) return;

  const { defer = true, silent = true } = options ?? {};

  const doUnlisten = () => {
    try {
      unlistenFn();
    } catch (error) {
      if (!silent) {
        log.warn("safeUnlisten: Error during cleanup (safe to ignore):", error);
      }
      // Error is swallowed - this is expected during race conditions
    }
  };

  if (defer) {
    // Defer to next tick to avoid race conditions with Tauri internals
    setTimeout(doUnlisten, 0);
  } else {
    doUnlisten();
  }
}
