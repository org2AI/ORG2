/**
 * SessionCreatorChatPanel — CLI chrome.
 *
 * The two CLI-only affordances the view renders around the composer: the
 * GUI / TUI launch-mode switch and the outdated-CLI-version alert.
 */
import React from "react";

import { createLogger } from "@src/hooks/logger";

import { CliLaunchModeSwitch } from "../../components";
import type SessionCreatorChatPanelView from "./SessionCreatorChatPanelView";
import type { useCliAgentConfiguration } from "./useCliAgentConfiguration";

const log = createLogger("ChatPanel");

type CliVersionAlert = React.ComponentProps<
  typeof SessionCreatorChatPanelView
>["cliVersionAlert"];

interface UseChatPanelCliChromeOptions {
  cli: Pick<
    ReturnType<typeof useCliAgentConfiguration>,
    | "cliLaunchMode"
    | "handleCliLaunchModeChange"
    | "selectedCliAgent"
    | "selectedCliAgentGuiSupportKnown"
    | "selectedCliAgentSupportsGui"
    | "selectedCliVersion"
    | "isSelectedCliVersionRefreshing"
    | "muteSelectedCliVersionAlertUntilNextVersion"
    | "refreshSelectedCliVersion"
    | "showCliVersionOutdatedAlert"
    | "snoozeSelectedCliVersionAlert"
  >;
  cliAgentType: string | null | undefined;
  isCliMode: boolean;
  isMultiRunnerActive: boolean;
}

export function useChatPanelCliChrome({
  cli,
  cliAgentType,
  isCliMode,
  isMultiRunnerActive,
}: UseChatPanelCliChromeOptions): {
  cliLaunchModeSwitch: React.ReactNode;
  cliVersionAlert: CliVersionAlert;
} {
  const {
    cliLaunchMode,
    handleCliLaunchModeChange,
    selectedCliAgent,
    selectedCliAgentGuiSupportKnown,
    selectedCliAgentSupportsGui,
    selectedCliVersion,
    isSelectedCliVersionRefreshing,
    muteSelectedCliVersionAlertUntilNextVersion,
    refreshSelectedCliVersion,
    showCliVersionOutdatedAlert,
    snoozeSelectedCliVersionAlert,
  } = cli;

  const cliLaunchModeSwitch =
    isCliMode && !isMultiRunnerActive ? (
      <CliLaunchModeSwitch
        mode={cliLaunchMode}
        supportsGui={
          !selectedCliAgentGuiSupportKnown || selectedCliAgentSupportsGui
        }
        onModeChange={handleCliLaunchModeChange}
      />
    ) : null;

  const cliVersionAlert: CliVersionAlert = showCliVersionOutdatedAlert
    ? {
        cliAgentType,
        cliDisplayName:
          selectedCliAgent?.displayName ?? cliAgentType ?? undefined,
        installedVersion: selectedCliVersion?.installed_version ?? undefined,
        latestVersion: selectedCliVersion?.latest_version ?? undefined,
        refreshing: isSelectedCliVersionRefreshing,
        onMuteUntilNextVersion: muteSelectedCliVersionAlertUntilNextVersion,
        onRefresh: () => {
          refreshSelectedCliVersion().catch((error: unknown) => {
            log.warn("CLI version refresh failed", error);
          });
        },
        onClose: snoozeSelectedCliVersionAlert,
      }
    : undefined;

  return { cliLaunchModeSwitch, cliVersionAlert };
}
