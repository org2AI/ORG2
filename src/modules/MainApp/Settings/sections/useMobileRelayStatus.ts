import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { type RelayStatus, mobileRemoteApi } from "@src/api/tauri/mobileRemote";
import { safeUnlisten } from "@src/util/platform/tauri/safeUnlisten";

/** Subscribe before reading; serialize invalidations and discard stale reads. */
export function useMobileRelayStatus(key: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: RelayStatus | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const requestRef = useRef<(() => void) | null>(null);
  const refresh = useCallback(() => requestRef.current?.(), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;
    let dirty = false;
    let unlisten: (() => void) | undefined;
    let data: RelayStatus | null = null;
    const request = async () => {
      if (cancelled) return;
      dirty = true;
      if (inFlight) return;
      inFlight = true;
      setSnapshot({ key, data, loading: true, error: null });
      try {
        do {
          dirty = false;
          try {
            const next = await mobileRemoteApi.getRelayStatus();
            if (cancelled) return;
            if (!dirty) {
              data = next;
              setSnapshot({ key, data, loading: false, error: null });
            }
          } catch (error) {
            if (cancelled) return;
            if (!dirty)
              setSnapshot({ key, data, loading: false, error: String(error) });
          }
        } while (dirty && !cancelled);
      } finally {
        inFlight = false;
      }
    };
    const requestStatus = () => {
      void request().catch((error: unknown) => {
        if (!cancelled)
          setSnapshot({ key, data, loading: false, error: String(error) });
      });
    };
    requestRef.current = requestStatus;
    void listen("mobile-relay-status-changed", () => {
      requestStatus();
    })
      .then((dispose) => {
        if (cancelled) {
          safeUnlisten(dispose);
          return;
        }
        unlisten = dispose;
        requestStatus();
      })
      .catch(() => {
        // Older/non-native hosts still support the visible manual refresh action.
        if (!cancelled) requestStatus();
      });
    return () => {
      cancelled = true;
      requestRef.current = null;
      safeUnlisten(unlisten);
    };
  }, [key, enabled]);

  const current = enabled && snapshot?.key === key ? snapshot : null;
  return {
    data: current?.data ?? null,
    loading: enabled && (current?.loading ?? true),
    error: current?.error ?? null,
    refresh,
  };
}
