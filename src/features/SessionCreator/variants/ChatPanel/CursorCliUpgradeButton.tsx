import { atom, useAtomValue, useStore } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Message from "@src/components/Message";
import { TerminalService } from "@src/services/terminal/TerminalService";
import { terminalSessionsAtom } from "@src/store/workstation/codeEditor/terminal";

type UpgradeTerminalState =
  | { phase: "idle" }
  | { phase: "opening" }
  | { phase: "opened"; sessionId: string };

// Runtime-only, per Jotai store: remounts and duplicate notices share one launch.
// The terminal owns the process. Opening it does not mean the upgrade succeeded.
const upgradeTerminalAtom = atom<UpgradeTerminalState>({ phase: "idle" });

export default function CursorCliUpgradeButton() {
  const { t } = useTranslation("sessions");
  const store = useStore();
  const state = useAtomValue(upgradeTerminalAtom);

  const openUpgradeTerminal = async () => {
    const current = store.get(upgradeTerminalAtom);
    if (current.phase === "opening") return;
    if (
      current.phase === "opened" &&
      store.get(terminalSessionsAtom).some(({ id }) => id === current.sessionId)
    ) {
      TerminalService.setActive(current.sessionId);
      TerminalService.focus();
      return;
    }

    store.set(upgradeTerminalAtom, { phase: "opening" });
    try {
      // Official Cursor CLI self-update; no version or label is shell-interpolated.
      const sessionId = await TerminalService.executeInNewSession(
        "cursor-agent update",
        { name: t("creator.cliVersionOutdated.upgradeTerminal") }
      );
      store.set(upgradeTerminalAtom, { phase: "opened", sessionId });
      Message.info(t("creator.cliVersionOutdated.upgradeStarted"));
    } catch {
      store.set(upgradeTerminalAtom, { phase: "idle" });
      Message.error(t("creator.cliVersionOutdated.upgradeFailed"));
    }
  };

  return (
    <Button
      variant="secondary"
      size="small"
      loading={state.phase === "opening"}
      title={t("creator.cliVersionOutdated.upgradeHint")}
      onClick={() => void openUpgradeTerminal()}
      data-testid="session-creator-cli-version-upgrade"
    >
      {t("creator.cliVersionOutdated.upgrade")}
    </Button>
  );
}
