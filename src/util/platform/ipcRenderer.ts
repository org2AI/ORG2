/**
 * Tauri Window & Shell APIs
 *
 * Provides window controls and opening local paths via Tauri. Web links go
 * through `@src/util/ui/openLink`.
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openPath } from "@tauri-apps/plugin-opener";

import { isTauriDesktop } from "@src/util/platform/tauri";

let currentWindow: WebviewWindow | null = null;
if (isTauriDesktop()) {
  currentWindow = WebviewWindow.getCurrent();
}

export const showInFinder = async (filePath: string): Promise<void> => {
  await openPath(filePath);
};

export const closeWindow = async (): Promise<void> => {
  if (currentWindow) {
    await currentWindow.close();
  }
};

/** Hand the current pointer-drag to the OS window manager. */
export const startWindowDrag = async (): Promise<void> => {
  if (currentWindow) {
    await currentWindow.startDragging();
  }
};

export const minWindow = async (): Promise<void> => {
  if (currentWindow) {
    await currentWindow.minimize();
  }
};

export const maxWindow = async (): Promise<void> => {
  if (currentWindow) {
    if (await currentWindow.isMaximized()) {
      await currentWindow.unmaximize();
    } else {
      await currentWindow.maximize();
    }
  }
};
