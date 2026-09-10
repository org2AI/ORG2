import type { MutableRefObject } from "react";

import { useTauriListen } from "@src/hooks/platform/useTauriListen";

export interface UseWebviewNewWindowListenerParams {
  isWebviewAvailable: boolean;
  labelRef: MutableRefObject<string>;
  log: (...args: unknown[]) => void;
  onNewWindow?: (url: string) => void;
}

interface NewWindowRequestPayload {
  url: string;
  webviewLabel: string;
}

/**
 * Lives for the hook instance rather than one native webview: the label is
 * fixed per instance, so a webview recreated after `destroy()` keeps receiving
 * its new-window requests.
 */
export function useWebviewNewWindowListener(
  params: UseWebviewNewWindowListenerParams
): void {
  const { isWebviewAvailable, labelRef, log, onNewWindow } = params;

  useTauriListen<NewWindowRequestPayload>(
    "webview-new-window-request",
    ({ url, webviewLabel }) => {
      if (webviewLabel !== labelRef.current) return;
      log("New window request received:", url);
      onNewWindow?.(url);
    },
    {
      enabled: isWebviewAvailable,
      onError: (err) => log("Failed to set up new window listener:", err),
    }
  );
}
