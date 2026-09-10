/**
 * useTauriListen
 *
 * Race-safe wrapper around `@tauri-apps/api/event#listen`.
 *
 * The naive pattern of `await listen(...)` inside an effect can leak
 * subscriptions when cleanup runs before the await resolves (React 18
 * StrictMode, fast unmount, deps churn). We track a `cancelled` flag and,
 * if cancelled before resolution, unlisten as soon as the promise settles so
 * no listener stays registered.
 *
 * Unlistening is deferred to the next macrotask (`safeUnlisten`). Tauri walks
 * its listener table while dispatching an event; a handler whose state update
 * synchronously unmounts the subscribing component would otherwise remove an
 * entry from the table the dispatcher is still iterating. Between cleanup and
 * the deferred unlisten the `cancelled` flag keeps the handler silent, so the
 * deferral never delivers a payload to an unmounted owner.
 *
 * The handler lives in a ref: a new handler identity on every render never
 * resubscribes. Only `event` and `enabled` changes do.
 */
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { createLogger } from "@src/hooks/logger";
import { safeUnlisten } from "@src/util/platform/tauri/safeUnlisten";

const log = createLogger("useTauriListen");

interface UseTauriListenOptions {
  /** `false` skips subscribing and tears down an existing subscription. */
  enabled?: boolean;
  /** Called when `listen` rejects. Defaults to logging the failure. */
  onError?: (error: unknown) => void;
}

export function useTauriListen<T = unknown>(
  event: string | null | undefined,
  handler: (payload: T) => void,
  options?: UseTauriListenOptions
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const onError = options?.onError;
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled || !event) return;

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<T>(event, (e) => {
      if (cancelled) return;
      handlerRef.current(e.payload);
    })
      .then((fn) => {
        if (cancelled) {
          safeUnlisten(fn);
          return;
        }
        unlisten = fn;
      })
      .catch((error: unknown) => {
        if (onErrorRef.current) {
          onErrorRef.current(error);
          return;
        }
        log.error(`Failed to listen for "${event}"`, error);
      });

    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
    };
  }, [event, enabled]);
}
