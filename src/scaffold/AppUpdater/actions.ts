import type { Update } from "@tauri-apps/plugin-updater";

import type {
  CheckForAppUpdatesOptions,
  InstallAvailableAppUpdateOptions,
} from "./service";

// Event consumers load update orchestration on demand, without linking the modal.
// The module loader shares the same service singleton with AppUpdater.
export async function checkForAppUpdates(
  options: CheckForAppUpdatesOptions = {}
): Promise<Update | null> {
  const service = await import("./service");
  return service.checkForAppUpdates(options);
}

export async function checkForUpdatesManually(): Promise<Update | null> {
  const service = await import("./service");
  return service.checkForUpdatesManually();
}

export async function installAvailableAppUpdate(
  options: InstallAvailableAppUpdateOptions = {}
): Promise<void> {
  const service = await import("./service");
  return service.installAvailableAppUpdate(options);
}
