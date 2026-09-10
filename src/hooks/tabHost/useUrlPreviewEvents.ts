/**
 * useUrlPreviewEvents Hook
 *
 * Listens for Tauri events to open URL preview tabs in the editor.
 * Used by agent tools to trigger URL preview in the editor area.
 *
 * Event: "open-url-preview"
 * Payload: { url: string, title?: string }
 */
import { createLogger } from "@src/hooks/logger";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import { EditorTabService } from "@src/services/workStation/EditorTabService";
import { createUrlPreviewTab } from "@src/store/workstation/tabs/factories";
import { isTauriDesktop } from "@src/util/platform/tauri";

const log = createLogger("useUrlPreviewEvents");

interface UrlPreviewPayload {
  url: string;
  title?: string;
}

/**
 * Hook to listen for URL preview events from the backend
 * Opens a URL preview tab when triggered by agent tools
 */
export function useUrlPreviewEvents(): void {
  useTauriListen<UrlPreviewPayload>(
    "open-url-preview",
    ({ url, title }) => {
      if (!url) {
        log.warn("[useUrlPreviewEvents] Received event with empty URL");
        return;
      }

      EditorTabService.openTab(createUrlPreviewTab(url, title));
    },
    { enabled: isTauriDesktop() }
  );
}
