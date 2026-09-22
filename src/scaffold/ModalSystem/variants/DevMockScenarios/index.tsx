/**
 * The ⇧⌘D dev mock panel.
 *
 * Shows the same controls as Settings → Dev mode, reachable from anywhere in
 * the app so an empty state can be flipped on without leaving the screen
 * under test. Dev builds only: the shortcut entry, the dispatcher branch, and
 * this component are all gated on `NODE_ENV`, and the router mounts it
 * through a dynamic import so it never enters a release bundle.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

// Deep import on purpose: Modal already notes that the `layouts/blocks`
// barrel drags @tanstack/react-table in behind it.
import PanelFooter from "@src/components/layout/blocks/PanelFooter";
import DevMockScenarioControls from "@src/features/DevMockScenarios/DevMockScenarioControls";
import Modal from "@src/scaffold/ModalSystem";
import {
  activeDevMockScenariosAtom,
  devMockScenariosModalOpenAtom,
  resetDevMockScenariosAtom,
} from "@src/store/dev/mockScenarios";

const DevMockScenariosModal = () => {
  const { t } = useTranslation("settings");
  const open = useAtomValue(devMockScenariosModalOpenAtom);
  const active = useAtomValue(activeDevMockScenariosAtom);
  const setOpen = useSetAtom(devMockScenariosModalOpenAtom);
  const resetScenarios = useSetAtom(resetDevMockScenariosAtom);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  if (process.env.NODE_ENV !== "development") return null;

  const anyActive = Object.values(active).some(Boolean);

  return (
    <Modal
      visible={open}
      // Each row pairs a description with a switch. Below ~480px of row
      // width SectionRow stacks the switch under the text and every
      // description wraps; `large` floors the dialog at 600px and 700 is
      // where the longest description clears the switch on one line.
      size="large"
      width={700}
      title={t("development.mockPanelTitle")}
      onClose={handleClose}
      // Reset is the footer's own action, not the dialog's cancel path —
      // Escape and the backdrop must close without undoing the switches.
      footer={
        <PanelFooter
          secondaryActions={[
            {
              label: t("development.mockPanelReset"),
              onClick: resetScenarios,
              variant: "secondary",
              disabled: !anyActive,
              dataTestId: "dev-mock-reset",
            },
          ]}
          primaryAction={{
            label: t("development.mockPanelDone"),
            onClick: handleClose,
            variant: "primary",
            modalPrimary: true,
            dataTestId: "dev-mock-done",
            shortcut: "Esc",
            "aria-keyshortcuts": "Escape",
          }}
        />
      }
    >
      <DevMockScenarioControls />
    </Modal>
  );
};

export default DevMockScenariosModal;
