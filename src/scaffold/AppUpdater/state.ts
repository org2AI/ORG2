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
export const availableAppUpdateAtom = atom(
  (get) => get(appUpdaterStateAtom).update
);
export const appUpdateInstallPromptAtom = atom(false);
export const separateAppUpdateInstallingAtom = atom(false);
export const appUpdateDownloadProgressAtom = atom<AppUpdateDownloadProgress>(
  EMPTY_APP_UPDATE_DOWNLOAD_PROGRESS
);
export const isAppUpdateInstallingAtom = atom((get) => {
  const phase = get(appUpdaterStateAtom).phase;
  return (
    get(separateAppUpdateInstallingAtom) ||
    phase === "downloading" ||
    phase === "installing" ||
    phase === "relaunching"
  );
});

export function useAvailableAppUpdate(): Update | null {
  return useAtomValue(availableAppUpdateAtom);
}

export function useIsAppUpdateInstalling(): boolean {
  return useAtomValue(isAppUpdateInstallingAtom);
}

export function useAppBuildProvenance(): AppBuildProvenance | null {
  return useAtomValue(appBuildProvenanceAtom);
}
