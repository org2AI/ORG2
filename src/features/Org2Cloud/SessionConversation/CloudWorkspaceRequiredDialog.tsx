import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

import { openWorkingDirectorySpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import Modal from "@src/scaffold/ModalSystem";

import { cloudWorkspaceRequiredDialogAtom } from "./cloudWorkspaceRequiredDialogAtom";

export function CloudWorkspaceRequiredDialog() {
  const { t } = useTranslation("sessions");
  const [visible, setVisible] = useAtom(cloudWorkspaceRequiredDialogAtom);
  const close = () => setVisible(false);

  return (
    <Modal
      visible={visible}
      title={t("conversation.workspaceRequiredTitle")}
      onCancel={close}
      onOk={() => {
        close();
        openWorkingDirectorySpotlight("open");
      }}
      okText={t("conversation.openWorkspace")}
      width={420}
    >
      {t("conversation.workspaceRequiredBody")}
    </Modal>
  );
}
