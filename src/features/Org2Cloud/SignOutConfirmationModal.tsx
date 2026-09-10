import { useStore } from "jotai";
import { useTranslation } from "react-i18next";

import signOutImage from "@src/assets/illustrations/sign-out.png";
import Modal from "@src/scaffold/ModalSystem";

import { org2CloudAuthAtom } from "./org2CloudAuthAtom";
import { resetOrgEntitlementCoordinator } from "./org2CloudEntitlementCoordinator";

export function SignOutConfirmationModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(["navigation", "common"]);
  const store = useStore();

  return (
    <Modal
      visible
      size="medium"
      image={{ src: signOutImage, alt: "" }}
      title={t("cloud.signOutConfirmTitle")}
      onCancel={onClose}
      onOk={() => {
        resetOrgEntitlementCoordinator(store);
        store.set(org2CloudAuthAtom, null);
        onClose();
      }}
      okText={t("cloud.signOut")}
      cancelText={t("common:actions.cancel")}
      okButtonProps={{ status: "danger" }}
      closable={false}
      maskClosable={false}
    >
      <p className="text-sm text-text-2">{t("cloud.signOutConfirmBody")}</p>
    </Modal>
  );
}
