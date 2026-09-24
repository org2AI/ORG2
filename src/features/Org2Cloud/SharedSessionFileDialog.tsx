import React from "react";
import { useTranslation } from "react-i18next";

import Modal from "@src/scaffold/ModalSystem";

import type { SharedSessionFileReference } from "./sharedSessionFileReference";

/** The two link entry points can show and close this shell before the viewer loads. */
export default function SharedSessionFileDialog({
  reference,
  name,
  onClose,
  children,
}: React.PropsWithChildren<{
  reference: SharedSessionFileReference;
  name?: string;
  onClose: () => void;
}>) {
  const { t } = useTranslation("sessions");
  const sourceName = reference.source?.path.split(/[\\/]/).pop();
  return (
    <Modal
      visible
      title={name || sourceName || t("sharedFile.title")}
      onCancel={onClose}
      footer={null}
    >
      {children ?? <p role="status">{t("sharedFile.loading")}</p>}
    </Modal>
  );
}
