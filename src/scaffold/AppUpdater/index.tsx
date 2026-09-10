import { useAtom, useAtomValue } from "jotai";
import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import AppMark from "@src/components/AppMark";
import Button from "@src/components/Button";
import Modal from "@src/scaffold/ModalSystem";
import { settingsLoadedAtom } from "@src/store/settings/settingsAtom";

import { DownloadProgressOrb } from "./DownloadProgress";
import {
  expandDownloadProgressNotice,
  installAvailableAppUpdate,
  postponeAppUpdate,
  skipAppUpdateVersion,
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
  const { t } = useTranslation(["settings", "common"]);
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

  const handleSkipVersion = useCallback(() => {
    skipAppUpdateVersion(availableUpdate?.version);
    setInstallPromptVisible(false);
  }, [availableUpdate, setInstallPromptVisible]);

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
      <Modal
        visible={installPromptVisible && Boolean(availableUpdate)}
        title={
          buildProvenance && usesSeparateApplicationInstall(buildProvenance)
            ? t("update.installOfficialConfirmTitle")
            : t("update.installConfirmTitle")
        }
        width={620}
        closable={false}
        maskClosable={false}
        escToExit={false}
        onCancel={handleInstallLater}
        onClose={handleInstallLater}
        bodyClassName="px-6 py-5"
        footer={
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <Button
              variant="tertiary"
              appearance="ghost"
              size="large"
              shape="round"
              onClick={handleSkipVersion}
            >
              {t("update.skipVersion")}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                appearance="solid"
                size="large"
                shape="round"
                onClick={handleInstallLater}
              >
                {t("common:actions.later")}
              </Button>
              <Button
                variant="primary"
                size="large"
                shape="round"
                onClick={handleInstallConfirm}
                data-modal-primary-action
              >
                {buildProvenance &&
                usesSeparateApplicationInstall(buildProvenance)
                  ? t("update.installOfficial")
                  : t("update.installAndRestart")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex items-center gap-5">
          <AppMark
            size={72}
            className="border border-border-2 bg-bg-2 shadow-xs"
            glyphClassName="text-text-1"
          />
          <p className="min-w-0 flex-1 text-sm leading-6 text-text-2">
            {t(
              buildProvenance && usesSeparateApplicationInstall(buildProvenance)
                ? "update.installOfficialConfirmDesc"
                : "update.installConfirmDesc",
              { version: availableUpdate?.version }
            )}
          </p>
        </div>
      </Modal>
      <DownloadProgressOrb
        progress={downloadProgress}
        onExpand={expandDownloadProgressNotice}
      />
    </>
  );
};
