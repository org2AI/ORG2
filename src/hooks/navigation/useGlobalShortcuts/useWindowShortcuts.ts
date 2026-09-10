import { useCallback, useEffect } from "react";

import { createLogger } from "@src/hooks/logger";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import {
  isAppQuittingAtom,
  quitConfirmationModalOpenAtom,
} from "@src/store/ui/overlayAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { isTauriDesktop } from "@src/util/platform/tauri";

const logger = createLogger("WindowShortcuts");

let quitInProgress = false;

async function requestNativeQuit() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("confirm_quit_app");
}

async function requestNativeCancelQuitConfirmation() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("cancel_quit_confirmation");
}

function setQuitConfirmationClosed() {
  getInstrumentedStore().set(quitConfirmationModalOpenAtom, false);
}

export function useWindowShortcuts() {
  const handleQuit = useCallback(async () => {
    if (!isTauriDesktop() || quitInProgress) return;

    quitInProgress = true;

    try {
      const jotaiStore = getInstrumentedStore();
      jotaiStore.set(quitConfirmationModalOpenAtom, false);
      jotaiStore.set(isAppQuittingAtom, true);

      await requestNativeQuit();
      quitInProgress = false;
      jotaiStore.set(isAppQuittingAtom, false);
    } catch (error) {
      const jotaiStore = getInstrumentedStore();
      jotaiStore.set(isAppQuittingAtom, false);
      jotaiStore.set(quitConfirmationModalOpenAtom, false);
      quitInProgress = false;
      logger.error("failed to quit app", error);
    }
  }, []);

  const closeQuitConfirmation = useCallback(() => {
    if (quitInProgress) return;
    setQuitConfirmationClosed();
    if (isTauriDesktop()) {
      void requestNativeCancelQuitConfirmation();
    }
  }, []);

  const openQuitConfirmation = useCallback(() => {
    if (!isTauriDesktop() || quitInProgress) return;

    getInstrumentedStore().set(quitConfirmationModalOpenAtom, true);
  }, []);

  const isTauri = isTauriDesktop();

  useTauriListen("native-quit-confirmation-open", openQuitConfirmation, {
    enabled: isTauri,
  });
  useTauriListen("native-quit-confirmation-close", setQuitConfirmationClosed, {
    enabled: isTauri,
  });

  useEffect(() => {
    if (!isTauri) return;

    const handleFocusLoss = () => closeQuitConfirmation();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") closeQuitConfirmation();
    };

    window.addEventListener("blur", handleFocusLoss);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", handleFocusLoss);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      closeQuitConfirmation();
    };
  }, [closeQuitConfirmation, isTauri]);

  const handleHideWindow = useCallback(async () => {
    if (!isTauriDesktop()) return;

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      await window.hide();
    } catch (_error) {
      // Hide is best-effort; failed window state changes should not interrupt shortcuts.
    }
  }, []);

  return {
    handleQuit,
    openQuitConfirmation,
    closeQuitConfirmation,
    handleHideWindow,
  };
}
