import React, { useRef } from "react";
import { flushSync } from "react-dom";

import Button from "@src/components/Button";
import Modal from "@src/scaffold/ModalSystem";

export interface MobileConfirmModalProps {
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  danger?: boolean;
  /** Must unmount this decision dialog; opening state belongs to the caller. */
  onDismiss: () => void;
  /** Notification after dismissal; business effects belong to the caller. */
  onConfirm: () => void;
}

/** Mount for one decision. Reuses the shared overlay rather than owning a modal stack. */
export function MobileConfirmModal({
  title,
  description,
  cancelLabel,
  confirmLabel,
  danger = false,
  onDismiss,
  onConfirm,
}: MobileConfirmModalProps) {
  const decided = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const decide = (confirmed: boolean) => {
    if (decided.current) return;
    decided.current = true;
    // Modal has no asynchronous exit lifecycle. Commit its cleanup (focus and
    // scroll lock) before an action such as sign-out unmounts the entire screen.
    flushSync(onDismiss);
    if (confirmed) onConfirm();
  };

  return (
    <Modal
      visible
      title={title}
      size="small"
      closable={false}
      initialFocusRef={cancelRef}
      onClose={() => decide(false)}
      bodyClassName="p-5"
      footer={
        <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
          <Button
            ref={cancelRef}
            htmlType="button"
            variant="secondary"
            onClick={() => decide(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            htmlType="button"
            variant={danger ? "danger" : "primary"}
            onClick={() => decide(true)}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-2">{description}</p>
    </Modal>
  );
}
