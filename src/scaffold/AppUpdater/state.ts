import type { Update } from "@tauri-apps/plugin-updater";
import { atom, useAtomValue } from "jotai";

import {
  type AppUpdaterState,
  createInitialAppUpdaterState,
} from "./appUpdaterCoordinator";
import type { AppBuildProvenance } from "./buildProvenance";

export interface AppUpdateDownloadProgress {
  active: boolean;
  collapsed: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export const EMPTY_APP_UPDATE_DOWNLOAD_PROGRESS: AppUpdateDownloadProgress = {
  active: false,
  collapsed: false,
  downloadedBytes: 0,
  totalBytes: null,
  percent: null,
};

export const appUpdaterStateAtom = atom<AppUpdaterState>(
  createInitialAppUpdaterState()
);
export const appBuildProvenanceAtom = atom<AppBuildProvenance | null>(null);
// Session-only UI override. Never create a fake native updater resource.
const mockUpdateEnabledAtom = atom(false);
const mockUpdatePromptAtom = atom(false);
const realUpdatePromptAtom = atom(false);
export const mockAppUpdateEnabledAtom = atom(
  (get) => get(mockUpdateEnabledAtom) && process.env.NODE_ENV === "development",
  (_get, set, enabled: boolean) => {
    set(
      mockUpdateEnabledAtom,
      process.env.NODE_ENV === "development" && enabled
    );
    set(mockUpdatePromptAtom, false);
  }
);
type AvailableAppUpdate = Pick<Update, "available" | "version"> & {
  mock?: boolean;
};
const MOCK_APP_UPDATE: AvailableAppUpdate = {
  available: true,
  version: "99.0.0",
  mock: true,
};
export const availableAppUpdateAtom = atom<AvailableAppUpdate | null>((get) =>
  get(mockAppUpdateEnabledAtom)
    ? MOCK_APP_UPDATE
    : get(appUpdaterStateAtom).update
);
export const appUpdateInstallPromptAtom = atom(
  (get) =>
    get(
      get(mockAppUpdateEnabledAtom)
        ? mockUpdatePromptAtom
        : realUpdatePromptAtom
    ),
  (get, set, visible: boolean) =>
    set(
      get(mockAppUpdateEnabledAtom)
        ? mockUpdatePromptAtom
        : realUpdatePromptAtom,
      visible
    )
);
export const separateAppUpdateInstallingAtom = atom(false);
export const appUpdateDownloadProgressAtom = atom<AppUpdateDownloadProgress>(
  EMPTY_APP_UPDATE_DOWNLOAD_PROGRESS
);
export const isAppUpdateInstallingAtom = atom((get) => {
  if (get(mockAppUpdateEnabledAtom)) return false;
  const phase = get(appUpdaterStateAtom).phase;
  return (
    get(separateAppUpdateInstallingAtom) ||
    phase === "downloading" ||
    phase === "installing" ||
    phase === "relaunching"
  );
});

export function useAvailableAppUpdate(): AvailableAppUpdate | null {
  return useAtomValue(availableAppUpdateAtom);
}

export function useIsAppUpdateInstalling(): boolean {
  return useAtomValue(isAppUpdateInstallingAtom);
}

export function useAppBuildProvenance(): AppBuildProvenance | null {
  return useAtomValue(appBuildProvenanceAtom);
}
