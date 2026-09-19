import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Modal from "@src/scaffold/ModalSystem";

import {
  cancelSellerShortcut,
  confirmSellerShortcut,
  sellerPromptAtom,
} from "./sellerShortcut";

/** Transient consent for a website request, never a seller-management surface. */
export default function SellerAuthorizationHost() {
  const { t } = useTranslation("integrations");
  const store = useStore();
  const prompt = useAtomValue(sellerPromptAtom);
  useEffect(() => () => cancelSellerShortcut(store), [store]);
  if (!prompt) return null;
  const confirming = prompt.phase === "confirm",
    connecting = prompt.phase === "connecting";
  const close = () => cancelSellerShortcut(store);
  return (
    <Modal
      visible
      title={t("marketConnection.sellerTitle")}
      onClose={close}
      width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={close}>
            {t(
              confirming || connecting
                ? "common:actions.cancel"
                : "common:actions.close"
            )}
          </Button>
          {confirming && (
            <Button
              variant="primary"
              onClick={() => void confirmSellerShortcut(store)}
            >
              {t("common:actions.confirm")}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-2">
          {t("marketConnection.sellerConfirmAccount", {
            provider: prompt.provider === "claude" ? "Claude" : "Codex",
            account: prompt.accountLabel,
          })}
        </p>
        {!confirming && (
          <p role="status" className="text-sm text-text-3">
            {t(
              connecting
                ? "marketConnection.sellerConnecting"
                : prompt.phase === "connected"
                  ? "marketConnection.sellerConnected"
                  : "marketConnection.sellerUnconfirmed"
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}
