import { useTranslation } from "react-i18next";

import updateImage from "@src/assets/illustrations/update.png";
import Button from "@src/components/Button";
import { createLogger } from "@src/hooks/logger";
import { PANEL_FOOTER_TOKENS } from "@src/modules/shared/layouts/blocks/PanelFooter";
import Modal from "@src/scaffold/ModalSystem";

const log = createLogger("UpdateInstallPrompt");

interface UpdateInstallPromptProps {
  visible: boolean;
  version?: string;
  separateInstall: boolean;
  onLater: () => void;
  onConfirm: () => void | Promise<void>;
}

export function UpdateInstallPrompt({
  visible,
  version,
  separateInstall,
  onLater,
  onConfirm,
}: UpdateInstallPromptProps) {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <Modal
      visible={visible}
      title={
        separateInstall
          ? t("update.installOfficialConfirmTitle")
          : t("update.installConfirmTitle")
      }
      size="medium"
      image={{ src: updateImage, alt: "" }}
      closable={false}
      maskClosable={false}
      escToExit={false}
      onCancel={onLater}
      onClose={onLater}
      footer={
        <div className={PANEL_FOOTER_TOKENS.container}>
          <div className="flex flex-1 items-center justify-end gap-2">
            <Button variant="secondary" size="small" onClick={onLater}>
              {t("common:actions.later")}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                Promise.resolve(onConfirm()).catch((error) => {
                  log.error("Update confirmation failed", error);
                });
              }}
              data-modal-primary-action
            >
              {separateInstall
                ? t("update.installOfficial")
                : t("update.installAndRestart")}
            </Button>
          </div>
        </div>
      }
    >
      <p className="text-sm text-text-2">
        {t(
          separateInstall
            ? "update.installOfficialConfirmDesc"
            : "update.installConfirmDesc",
          { version }
        )}
      </p>
    </Modal>
  );
}
