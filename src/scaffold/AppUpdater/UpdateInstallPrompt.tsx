import { useTranslation } from "react-i18next";

import updateImage from "@src/assets/illustrations/update.png";
import Illustration from "@src/components/Illustration";
import PanelFooter from "@src/components/layout/blocks/PanelFooter";
import { createLogger } from "@src/hooks/logger";
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
      headerMedia={
        <Illustration src={updateImage} className="liquid-modal-image" />
      }
      closable={false}
      maskClosable={false}
      escToExit={false}
      onCancel={onLater}
      onClose={onLater}
      footer={
        <PanelFooter
          secondaryActions={[
            { label: t("common:actions.later"), onClick: onLater },
          ]}
          primaryAction={{
            label: separateInstall
              ? t("update.installOfficial")
              : t("update.installAndRestart"),
            onClick: () => {
              Promise.resolve(onConfirm()).catch((error) => {
                log.error("Update confirmation failed", error);
              });
            },
            modalPrimary: true,
          }}
        />
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
