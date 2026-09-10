import { useTranslation } from "react-i18next";

import Modal from "@src/scaffold/ModalSystem";

import { SignInFeatures } from "./SignInFeatures";

export function SignInModal({
  onClose,
  onSignIn,
}: {
  onClose: () => void;
  onSignIn: () => void;
}) {
  const { t } = useTranslation(["navigation", "common"]);

  return (
    <Modal
      visible
      size="medium"
      headerMedia={<SignInFeatures />}
      title={t("cloud.signInModalTitle")}
      onCancel={onClose}
      onOk={() => {
        onClose();
        onSignIn();
      }}
      okText={t("cloud.signIn")}
      cancelText={t("common:actions.cancel")}
      closable={false}
      maskClosable={false}
    >
      <p className="text-sm text-text-2">{t("cloud.signInModalBody")}</p>
    </Modal>
  );
}
