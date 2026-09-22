import { useAtom, useAtomValue } from "jotai";
import React, { useCallback, useEffect } from "react";

import { settingsLoadedAtom } from "@src/store/settings/settingsAtom";

import { DownloadProgressOrb } from "./DownloadProgress";
import { UpdateInstallPrompt } from "./UpdateInstallPrompt";
import {
  expandDownloadProgressNotice,
  installAvailableAppUpdate,
  postponeAppUpdate,
  // skipAppUpdateVersion,
  startAutomaticAppUpdates,
  usesSeparateApplicationInstall,
} from "./service";
import {
  appBuildProvenanceAtom,
  appUpdateDownloadProgressAtom,
  appUpdateInstallPromptAtom,
  availableAppUpdateAtom,
} from "./state";

export const AppUpdater: React.FC = () => {
  const availableUpdate = useAtomValue(availableAppUpdateAtom);
  const buildProvenance = useAtomValue(appBuildProvenanceAtom);
  const downloadProgress = useAtomValue(appUpdateDownloadProgressAtom);
  const [installPromptVisible, setInstallPromptVisible] = useAtom(
    appUpdateInstallPromptAtom
  );
  const settingsLoaded = useAtomValue(settingsLoadedAtom);

  const handleInstallLater = useCallback(() => {
    postponeAppUpdate(availableUpdate?.version);
  }, [availableUpdate]);

  // const handleSkipVersion = useCallback(() => {
  //   skipAppUpdateVersion(availableUpdate?.version);
  //   setInstallPromptVisible(false);
  // }, [availableUpdate, setInstallPromptVisible]);

  const handleInstallConfirm = useCallback(async () => {
    await installAvailableAppUpdate({ confirmed: true });
    setInstallPromptVisible(false);
  }, [setInstallPromptVisible]);

  useEffect(() => {
    if (!settingsLoaded) return;

    return startAutomaticAppUpdates();
  }, [settingsLoaded]);

  return (
    <>
      <UpdateInstallPrompt
        visible={installPromptVisible && Boolean(availableUpdate)}
        version={availableUpdate?.version}
        separateInstall={Boolean(
          !availableUpdate?.mock &&
          buildProvenance &&
          usesSeparateApplicationInstall(buildProvenance)
        )}
        onLater={handleInstallLater}
        onConfirm={handleInstallConfirm}
      />
      <DownloadProgressOrb
        progress={downloadProgress}
        onExpand={expandDownloadProgressNotice}
      />
    </>
  );
};
