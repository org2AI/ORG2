import React from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import Modal from "@src/scaffold/ModalSystem";

export function branchSwitchQuestion(
  title: string,
  message: string,
  okLabel?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
      queueMicrotask(() => {
        root.unmount();
        container.remove();
      });
    };
    function Question() {
      const { t } = useTranslation("common");
      return (
        <Modal
          visible
          size="small"
          maskClosable={false}
          title={title}
          onClose={() => finish(false)}
          onCancel={() => finish(false)}
          onOk={() => finish(Boolean(okLabel))}
          okText={okLabel || t("actions.close", "Close")}
          // A notice without its own action has one acknowledgement button.
          cancelText={okLabel ? t("actions.cancel", "Cancel") : ""}
        >
          <p className="text-sm break-words whitespace-pre-wrap text-text-2">
            {message}
          </p>
        </Modal>
      );
    }
    root.render(<Question />);
  });
}
