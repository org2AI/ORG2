import { createLogger } from "@src/hooks/logger";

const logger = createLogger("WindowShortcuts");

/**
 * Close this document's native window. The main window's `CloseRequested`
 * handler hides it instead (every macOS build, release Windows/Linux), so the
 * app keeps running and the dock or tray brings it back; detached session and
 * station windows close for real.
 */
export function closeCurrentWindow(): void {
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().close())
    .catch((error: unknown) => {
      logger.error("failed to close window", error);
    });
}
