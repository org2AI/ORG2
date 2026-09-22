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
      className="mobile-confirm-modal"
      closable={false}
      initialFocusRef={cancelRef}
      onClose={() => decide(false)}
      footer={
        <div className="flex flex-wrap justify-end gap-2 p-3">
          <Button
            style={{
              fontSize: "var(--mobile-type-control-size)",
              lineHeight: "var(--mobile-type-control-leading)",
            }}
            ref={cancelRef}
            onClick={() => decide(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            style={{
              fontSize: "var(--mobile-type-control-size)",
              lineHeight: "var(--mobile-type-control-leading)",
            }}
            variant="primary"
            tone={danger ? "danger" : undefined}
            onClick={() => decide(true)}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="mobile-type-secondary text-text-2">{description}</p>
    </Modal>
  );
}
