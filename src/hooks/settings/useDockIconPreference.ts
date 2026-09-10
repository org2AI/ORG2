import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { createLogger } from "@src/hooks/logger";
import { settingsLoadedAtom } from "@src/store/settings/settingsAtom";

import { useSettingValue } from "./useSettings";

const log = createLogger("DockIcon");

/** Mirrors the `general.dockIcon` enum and Rust's `DockIconVariant`. */
export type DockIconVariant = "dark" | "light" | "rainbow";

type InvokeDockIcon = (
  command: "set_dock_icon",
  args: { variant: DockIconVariant }
) => Promise<unknown>;

async function invokeViaTauri(
  command: "set_dock_icon",
  args: { variant: DockIconVariant }
): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
}

/**
 * Hand the variant to Rust, which swaps the live process's Dock / taskbar
 * icon. Resolves without throwing outside Tauri (browser previews, tests)
 * — there is no Dock to update there.
 */
export async function pushDockIcon(
  variant: DockIconVariant,
  invoke: InvokeDockIcon = invokeViaTauri
): Promise<void> {
  try {
    await invoke("set_dock_icon", { variant });
  } catch (error) {
    log.debug("Dock icon not applied:", error);
  }
}

/**
 * Keep the running app's icon in step with `general.dockIcon`.
 *
 * Waits for settings to load from disk: the pre-load default would reset
 * the icon Rust already applied at launch from the stored value, and the
 * loaded value would then set it back — a visible flash in the Dock. Once
 * loaded, every change (including one synced from another window) is
 * pushed; pushing the same variant twice is harmless.
 */
export function useDockIconPreference(): void {
  const settingsLoaded = useAtomValue(settingsLoadedAtom);
  const variant = useSettingValue("general.dockIcon");

  useEffect(() => {
    if (!settingsLoaded) return;
    pushDockIcon(variant).catch((error: unknown) => {
      log.debug("Dock icon push failed:", error);
    });
  }, [settingsLoaded, variant]);
}
