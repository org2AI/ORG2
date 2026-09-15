import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Modal from "@src/scaffold/ModalSystem";

import { closeSeller, sellerSnapshot, subscribeSeller } from "./sellerLink";

export default function SellerDialog() {
  const phase = useSyncExternalStore(subscribeSeller, sellerSnapshot);
  const { t } = useTranslation("integrations");
  if (!phase) return null;
  const close = () => {
    closeSeller().catch(() => {
      console.error("Market seller dialog close failed");
    });
  };
  return (
    <Modal
      visible
      title={t("marketSeller.title")}
      onCancel={close}
      onClose={close}
      footer={
        <Button disabled={phase === "cancelling"} onClick={close}>
          {t(
            phase === "completed" || phase === "failed"
              ? "marketConnection.close"
              : "marketSeller.cancel"
          )}
        </Button>
      }
    >
      <p role="status" aria-live="polite">
        {t(`marketSeller.${phase}`)}
      </p>
    </Modal>
  );
}
