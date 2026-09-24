import { type PrimitiveAtom, atom, useAtomValue, useStore } from "jotai";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { CLI_AGENT } from "@src/api/tauri/rpc/schemas/validationEnums";
import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import DropdownHeader from "@src/components/Dropdown/DropdownHeader";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import Message from "@src/components/Message";
import type { AvailableAgent } from "@src/config/cliAgents/types";
import { HugeiconsIcon, PlayIcon } from "@src/icons";
import { TerminalService } from "@src/services/terminal/TerminalService";
import { terminalSessionsAtom } from "@src/store/workstation/codeEditor/terminal";
import { openLink } from "@src/util/ui/openLink";

type UpgradeTerminalState =
  | { phase: "idle" }
  | { phase: "opening" }
  | { phase: "opened"; sessionId: string };

// Fixed registry-sized collection; no runtime keys, polling or persisted state.
// Each Jotai store and CLI gets its own single flight, surviving notice remounts.
const upgradeTerminalAtoms = new Map(
  Object.values(CLI_AGENT).map((name) => [
    name as string,
    atom<UpgradeTerminalState>({ phase: "idle" }),
  ])
);

interface Props {
  agent: Pick<
    AvailableAgent,
    "name" | "displayName" | "upgradeMethods" | "docsUrl"
  >;
}

export default function CliUpgradeButton({ agent }: Props) {
  const { t } = useTranslation("sessions");
  const stateAtom = upgradeTerminalAtoms.get(agent.name);
  if (!stateAtom || !agent.upgradeMethods?.length) {
    return agent.docsUrl ? (
      <Button
        variant="secondary"
        size="small"
        onClick={() => openLink(agent.docsUrl!)}
        data-testid="session-creator-cli-upgrade-docs"
      >
        {t("creator.cliVersionOutdated.upgradeDocs")}
      </Button>
    ) : null;
  }
  return <UpgradeAction agent={agent} stateAtom={stateAtom} />;
}

function UpgradeAction({
  agent,
  stateAtom,
}: Props & { stateAtom: PrimitiveAtom<UpgradeTerminalState> }) {
  const { t } = useTranslation("sessions");
  const store = useStore();
  const state = useAtomValue(stateAtom);
  const [menuOpen, setMenuOpen] = useState(false);
  const methods = agent.upgradeMethods ?? [];
  const selfUpdate = methods.find(({ id }) => id === "self");

  const focusExistingTerminal = () => {
    const current = store.get(stateAtom);
    if (
      current.phase !== "opened" ||
      !store
        .get(terminalSessionsAtom)
        .some(({ id }) => id === current.sessionId)
    )
      return false;
    TerminalService.setActive(current.sessionId);
    TerminalService.focus();
    return true;
  };

  const openUpgradeTerminal = async (command: string) => {
    setMenuOpen(false);
    if (store.get(stateAtom).phase === "opening" || focusExistingTerminal())
      return;
    store.set(stateAtom, { phase: "opening" });
    // Only registry-provided commands. Labels and versions never enter shell text.
    // The terminal owns the process; dispatch does not imply upgrade success.
    const sessionId = await TerminalService.executeInNewSession(command, {
      name: t("creator.cliVersionOutdated.upgradeTerminal", {
        cli: agent.displayName,
      }),
    });
    store.set(stateAtom, { phase: "opened", sessionId });
    Message.info(t("creator.cliVersionOutdated.upgradeStarted"));
  };

  const handleUpgradeFailure = () => {
    store.set(stateAtom, { phase: "idle" });
    Message.error(t("creator.cliVersionOutdated.upgradeFailed"));
  };

  const hint = t("creator.cliVersionOutdated.upgradeHint", {
    cli: agent.displayName,
  });
  const button = (
    <Button
      variant="tertiary"
      tone="primary"
      size="small"
      iconOnly
      icon={
        <HugeiconsIcon
          icon={PlayIcon}
          data-icon="play"
          size={14}
          strokeWidth={1.8}
        />
      }
      loading={state.phase === "opening"}
      aria-label={t("creator.cliVersionOutdated.upgrade")}
      onClick={
        selfUpdate
          ? () => {
              openUpgradeTerminal(selfUpdate.command).catch(
                handleUpgradeFailure
              );
            }
          : undefined
      }
      aria-haspopup={selfUpdate ? undefined : "menu"}
      aria-expanded={selfUpdate ? undefined : menuOpen}
      data-testid="session-creator-cli-version-upgrade"
    />
  );
  if (selfUpdate) return <ToolbarTooltip label={hint}>{button}</ToolbarTooltip>;

  // Path-based installedVia is a heuristic (pipx/uv/pnpm may look like pip/npm).
  // Ask for the original installer instead of silently changing package managers.
  return (
    <ToolbarTooltip label={hint} disabled={menuOpen}>
      <Dropdown
        popupVisible={menuOpen}
        disabled={state.phase === "opening"}
        onVisibleChange={(open) => {
          if (open && focusExistingTerminal()) return;
          setMenuOpen(open);
        }}
        options={[
          ...methods.map(({ id, label }) => ({
            value: id,
            label:
              id === "native"
                ? t("creator.cliVersionOutdated.upgradeNative")
                : label,
            dataTestId: `cli-upgrade-method-${id}`,
          })),
          ...(agent.docsUrl
            ? [
                {
                  value: "docs",
                  label: t("creator.cliVersionOutdated.upgradeDocs"),
                },
              ]
            : []),
        ]}
        dropdownRender={(menu) => (
          <>
            <DropdownHeader>
              {t("creator.cliVersionOutdated.upgradeChooseMethod")}
            </DropdownHeader>
            {menu}
          </>
        )}
        onSelect={(id) => {
          setMenuOpen(false);
          if (id === "docs" && agent.docsUrl) {
            openLink(agent.docsUrl);
            return;
          }
          const method = methods.find((method) => method.id === id);
          if (method)
            openUpgradeTerminal(method.command).catch(handleUpgradeFailure);
        }}
      >
        {button}
      </Dropdown>
    </ToolbarTooltip>
  );
}
