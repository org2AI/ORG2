/**
 * RevertConfirmDialog
 *
 * Three-choice dialog shown before edit/regenerate when rewinding would modify
 * files on disk:
 *   1. "Revert changes" — truncate messages AND rewind file-history
 *   2. "Keep changes"   — truncate messages but leave files as-is
 *   3. Cancel           — abort the edit/regenerate entirely
 *
 * Mirrors the Claude Code "continue with / without changes" UX.
 *
 * Usage: call `useShowRevertConfirm()` inside a component, or import
 * `revertConfirmAtom` and write to it directly from non-React code using
 * the Jotai store (see `showRevertConfirm` below).
 */
import { atom, createStore, useAtomValue, useSetAtom } from "jotai";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import PanelFooter from "@src/components/layout/blocks/PanelFooter";
import Modal from "@src/scaffold/ModalSystem";

export type RevertChoice = "revert" | "keep" | "cancel";

interface RevertConfirmState {
  visible: boolean;
  resolve: ((choice: RevertChoice) => void) | null;
}

export const revertConfirmAtom = atom<RevertConfirmState>({
  visible: false,
  resolve: null,
});

/** Shared store instance used by `showRevertConfirm` below. */
const revertConfirmStore = createStore();

/**
 * Open the dialog imperatively and wait for the user's choice.
 * Safe to call from outside React (hooks, async callbacks). The dialog must
 * already be mounted — if it is not, the Promise resolves with `"cancel"`.
 */
export function showRevertConfirm(): Promise<RevertChoice> {
  return new Promise<RevertChoice>((resolve) => {
    const current = revertConfirmStore.get(revertConfirmAtom);
    if (current.visible) {
      // Already open — treat as cancel to avoid double-stacking.
      resolve("cancel");
      return;
    }
    revertConfirmStore.set(revertConfirmAtom, { visible: true, resolve });
  });
}

const RevertConfirmDialog: React.FC = () => {
  const { t } = useTranslation("sessions");
  const state = useAtomValue(revertConfirmAtom, { store: revertConfirmStore });
  const setState = useSetAtom(revertConfirmAtom, { store: revertConfirmStore });

  const close = useCallback(
    (choice: RevertChoice) => {
      const { resolve: currentResolve } =
        revertConfirmStore.get(revertConfirmAtom);
      setState({ visible: false, resolve: null });
      currentResolve?.(choice);
    },
    [setState]
  );

  const handleRevert = useCallback(() => close("revert"), [close]);
  const handleKeep = useCallback(() => close("keep"), [close]);
  const handleCancel = useCallback(() => close("cancel"), [close]);

  return (
    <Modal
      visible={state.visible}
      title={t("revertConfirm.title")}
      onClose={handleCancel}
      maskClosable={false}
      escToExit
      width={440}
      footer={
        <PanelFooter
          secondaryActions={[
            {
              label: t("common:actions.cancel"),
              onClick: handleCancel,
              dataTestId: "rewind-file-changes-cancel",
            },
            {
              label: t("revertConfirm.keepChanges"),
              onClick: handleKeep,
              dataTestId: "rewind-file-changes-keep",
            },
          ]}
          primaryAction={{
            label: t("revertConfirm.revertChanges"),
            onClick: handleRevert,
            dataTestId: "rewind-file-changes-revert",
          }}
        />
      }
    >
      <div className="text-token-secondary text-sm">
        {t("revertConfirm.body")}
      </div>
    </Modal>
  );
};

export default RevertConfirmDialog;
