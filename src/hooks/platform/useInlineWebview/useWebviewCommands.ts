import { invoke } from "@tauri-apps/api/core";
import type { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
} from "react";

import { toNativeFrame } from "@src/util/platform/tauri/nativeFrame";

// Shared across React remounts so two owners of one label cannot receive the
// same millisecond timestamp. This is a process-local IPC ownership token.
let nextLifecycleGeneration = 0;

export interface UseWebviewCommandsParams {
  isWebviewAvailable: boolean;
  isUnmountedRef: RefObject<boolean>;
  containerRef: RefObject<HTMLDivElement | null>;
  labelRef: MutableRefObject<string>;
  userAgent: string;
  incognito: boolean;
  isDestroyedRef: MutableRefObject<boolean>;
  pollIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  lastPolledUrlRef: MutableRefObject<string>;
  lastAppliedUrlRef: MutableRefObject<string>;
  getContainerRect: () => DOMRect | null;
  log: (...args: unknown[]) => void;
  onCreated?: (webview: Webview) => void;
  onError?: (error: Error) => void;
  onDestroyed?: () => void;
  onNavigate?: (url: string) => void;
  isWebviewCreated: boolean;
  setIsWebviewCreated: (value: boolean) => void;
  setIsLoading: (value: boolean) => void;
  setCurrentUrl: (url: string) => void;
  setError: (error: Error | null) => void;
  isVisible: boolean;
}

export interface UseWebviewCommandsReturn {
  createWebview: (targetUrl: string) => Promise<void>;
  navigate: (targetUrl: string) => Promise<void>;
  reload: () => Promise<void>;
  evaluate: (script: string) => Promise<void>;
  destroy: () => Promise<void>;
}

export function useWebviewCommands(
  params: UseWebviewCommandsParams
): UseWebviewCommandsReturn {
  const {
    isWebviewAvailable,
    isUnmountedRef,
    containerRef,
    labelRef,
    userAgent,
    incognito,
    isDestroyedRef,
    pollIntervalRef,
    lastPolledUrlRef,
    lastAppliedUrlRef,
    getContainerRect,
    log,
    onCreated,
    onError,
    onDestroyed,
    onNavigate,
    isWebviewCreated,
    setIsWebviewCreated,
    setIsLoading,
    setCurrentUrl,
    setError,
    isVisible,
  } = params;

  // One successful create acquires one native owner token. Pending create
  // disposal also releases after its reply, independent of IPC arrival order.
  const hasOwnerRef = useRef(false);
  const createInFlightRef = useRef<Promise<void> | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const releasedGenerationRef = useRef(0);
  const desiredNavigationRef = useRef<string | null>(null);
  const navigationInFlightRef = useRef<Promise<void> | null>(null);

  const createWebview = useCallback(
    (targetUrl: string): Promise<void> => {
      if (
        !isWebviewAvailable ||
        !containerRef.current ||
        isDestroyedRef.current
      ) {
        log("Cannot create WebView - not available or no container");
        return Promise.resolve();
      }

      // A single React owner must hold exactly one native owner token. Effect
      // restarts (for example, Station visibility changing while creation is
      // still awaiting IPC) may call this again before state reflects success.
      if (hasOwnerRef.current) {
        return Promise.resolve();
      }
      if (createInFlightRef.current) {
        return createInFlightRef.current;
      }

      const rect = getContainerRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        log("Container has no dimensions, skipping WebView creation");
        return Promise.resolve();
      }

      const operation = (async () => {
        try {
          if (!isUnmountedRef.current) {
            setIsLoading(true);
            setError(null);
          }

          const appWindow = getCurrentWindow();
          const parentLabel = appWindow.label;
          const generation = Math.max(nextLifecycleGeneration + 1, Date.now());
          nextLifecycleGeneration = generation;
          lifecycleGenerationRef.current = generation;

          log("Creating WebView via Rust command at rect:", rect);

          const frame = toNativeFrame(rect);
          await invoke("create_inline_webview", {
            parentWindow: parentLabel,
            label: labelRef.current,
            url: targetUrl,
            ...frame,
            userAgent: userAgent,
            incognito: incognito,
            generation,
            visible: isVisible,
          });

          // Mark that this instance acquired its native owner token. Even if we are already
          // unmounted at this point we still need to release it.
          hasOwnerRef.current = true;

          // create_inline_webview returns with the webview staged offscreen.
          // Only a still-mounted owner may publish the view as ready/visible.
          if (
            isUnmountedRef.current ||
            releasedGenerationRef.current >= generation
          ) {
            // Unmounted while create was in-flight. Release this owner so the
            // offscreen webview is destroyed without ever being shown.
            hasOwnerRef.current = false;
            await invoke("close_inline_webview", {
              label: labelRef.current,
              generation,
            });
            return;
          }

          setIsWebviewCreated(true);
          setCurrentUrl(targetUrl);
          lastPolledUrlRef.current = targetUrl;
          lastAppliedUrlRef.current = targetUrl;

          log("WebView created successfully with label:", labelRef.current);

          const webviewProxy = {
            label: () => labelRef.current,
          } as unknown as Webview;
          onCreated?.(webviewProxy);

          setIsLoading(false);
        } catch (err) {
          if (isUnmountedRef.current) return;
          const error = err instanceof Error ? err : new Error(String(err));
          log("Failed to create WebView:", error);
          setError(error);
          setIsLoading(false);
          onError?.(error);
        }
      })();

      createInFlightRef.current = operation;
      const releaseFlight = () => {
        if (createInFlightRef.current === operation) {
          createInFlightRef.current = null;
        }
      };
      // Observe both outcomes without creating a rejected finally promise.
      void operation.then(releaseFlight, releaseFlight);
      return operation;
    },
    [
      isWebviewAvailable,
      isUnmountedRef,
      containerRef,
      getContainerRect,
      userAgent,
      incognito,
      isDestroyedRef,
      labelRef,
      lastPolledUrlRef,
      lastAppliedUrlRef,
      log,
      isVisible,
      onCreated,
      onError,
      setIsLoading,
      setError,
      setIsWebviewCreated,
      setCurrentUrl,
    ]
  );

  const navigate = useCallback(
    (targetUrl: string): Promise<void> => {
      desiredNavigationRef.current = targetUrl;
      if (navigationInFlightRef.current) return navigationInFlightRef.current;
      const operation = (async () => {
        while (!isUnmountedRef.current && !isDestroyedRef.current) {
          const desired = desiredNavigationRef.current;
          if (!desired || desired === lastAppliedUrlRef.current) return;
          try {
            setIsLoading(true);
            if (!hasOwnerRef.current && !isWebviewCreated) {
              await createWebview(desired);
              if (!hasOwnerRef.current) return;
            } else {
              await invoke("navigate_inline_webview", {
                label: labelRef.current,
                url: desired,
              });
              if (isUnmountedRef.current || isDestroyedRef.current) return;
              lastAppliedUrlRef.current = desired;
            }
            if (isUnmountedRef.current || isDestroyedRef.current) return;
            // Never publish an older navigation back into the session URL. The
            // next loop applies the latest unsent target with only one IPC live.
            if (desiredNavigationRef.current !== desired) continue;
            setCurrentUrl(desired);
            lastPolledUrlRef.current = desired;
            onNavigate?.(desired);
            setIsLoading(false);
          } catch (err) {
            if (isUnmountedRef.current || isDestroyedRef.current) return;
            log("Navigation failed, recreating webview:", err);
            if (hasOwnerRef.current) {
              hasOwnerRef.current = false;
              await invoke("close_inline_webview", {
                label: labelRef.current,
                generation: lifecycleGenerationRef.current,
              }).catch(() => {});
            }
            if (isUnmountedRef.current || isDestroyedRef.current) return;
            setIsWebviewCreated(false);
            lastAppliedUrlRef.current = "";
            const recoveryUrl = desiredNavigationRef.current;
            if (!recoveryUrl) return;
            await createWebview(recoveryUrl);
            if (!hasOwnerRef.current) return;
            if (isUnmountedRef.current || isDestroyedRef.current) return;
            if (desiredNavigationRef.current === recoveryUrl)
              onNavigate?.(recoveryUrl);
          }
        }
      })();
      navigationInFlightRef.current = operation;
      const releaseFlight = () => {
        if (navigationInFlightRef.current === operation)
          navigationInFlightRef.current = null;
      };
      // Observe both outcomes without creating a rejected finally promise.
      void operation.then(releaseFlight, releaseFlight);
      return operation;
    },
    [
      isWebviewCreated,
      createWebview,
      log,
      onNavigate,
      isUnmountedRef,
      isDestroyedRef,
      labelRef,
      lastPolledUrlRef,
      lastAppliedUrlRef,
      setIsLoading,
      setCurrentUrl,
      setIsWebviewCreated,
    ]
  );

  const reload = useCallback(async () => {
    if (!isWebviewCreated) return;

    try {
      if (!isUnmountedRef.current) {
        setIsLoading(true);
      }
      log("Reloading inline webview");

      await invoke("reload_inline_webview", {
        label: labelRef.current,
      });

      if (!isUnmountedRef.current) {
        setIsLoading(false);
      }
    } catch (err) {
      if (!isUnmountedRef.current) {
        log("Reload failed:", err);
        setIsLoading(false);
      }
    }
  }, [isWebviewCreated, log, isUnmountedRef, labelRef, setIsLoading]);

  const evaluate = useCallback(
    async (_script: string) => {
      log("evaluate() is not supported in Tauri v2 Webview API");
    },
    [log]
  );

  const destroy = useCallback(async () => {
    // Release promptly, even if create has not replied. If close arrives before
    // create, it is a safe no-op; the create completion above releases again.
    // Rust owner tokens make both paths idempotent without tombstones.
    const generation = lifecycleGenerationRef.current;
    if (!hasOwnerRef.current && generation === 0) return;
    hasOwnerRef.current = false;
    releasedGenerationRef.current = generation;
    isDestroyedRef.current = true;
    desiredNavigationRef.current = null;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    const label = labelRef.current;

    // Native release is owner-scoped. An unscoped position update here could
    // move a new owner's WebView when an old React cleanup runs late.
    try {
      log("Destroying WebView");
      await invoke("close_inline_webview", {
        label,
        generation,
      });
      isDestroyedRef.current = true;
      if (!isUnmountedRef.current) {
        setIsWebviewCreated(false);
        onDestroyed?.();
      }
    } catch (err) {
      log("Destroy failed:", err);
      isDestroyedRef.current = true;
    }
  }, [
    log,
    onDestroyed,
    pollIntervalRef,
    labelRef,
    isDestroyedRef,
    isUnmountedRef,
    setIsWebviewCreated,
  ]);

  return { createWebview, navigate, reload, evaluate, destroy };
}
