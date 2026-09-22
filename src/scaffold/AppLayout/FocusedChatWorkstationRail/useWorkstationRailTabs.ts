/**
 * "Opened Tabs" rows of the focused-chat workstation rail: My Station tabs
 * plus the user-driven PTY sessions, and the handlers that hand a row over to
 * the Workstation host or the docked trail terminal.
 */
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import { ROUTES } from "@src/config/routes";
import { getTerminalDisplayTitle } from "@src/engines/TerminalCore/types";
import { createLogger } from "@src/hooks/logger";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import { useCloseTabWithGuard } from "@src/hooks/tabHost/useCloseTabWithGuard";
import { File01Icon, InternetIcon, SquareTerminalIcon } from "@src/icons";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  closeTerminalSessionAtom,
  initializedTerminalIdsAtom,
  terminalSessionsAtom,
} from "@src/store/workstation/codeEditor/terminal";
import { clearTerminalTargetReferencesAtom } from "@src/store/workstation/codeEditor/terminalTargetAtom";
import {
  type WorkstationTabHost,
  tabToHost,
} from "@src/store/workstation/tabHost";
import {
  focusTabAtom,
  tabRegistryAtom,
} from "@src/store/workstation/tabRegistry";
import type { WorkStationTab } from "@src/store/workstation/tabs/types";
import { isChatPanelTerminalId } from "@src/util/ui/terminal/chatPanelSessionId";
import { isAgentPtySessionId } from "@src/util/ui/terminal/ptySessionId";

import type { FocusedChatRailItem } from "./types";

const log = createLogger("useWorkstationRailTabs");

const WORKSTATION_HOST_ROUTES: Record<WorkstationTabHost, string> = {
  code: ROUTES.workStation.code.path,
  browser: ROUTES.workStation.browser.path,
  project: ROUTES.workStation.project.path,
};

function getRailTabFileName(tab: WorkStationTab): string | undefined {
  switch (tab.type) {
    case "file":
    case "git-diff":
      return (tab.data.filePath as string | undefined) || tab.title;
    case "directory":
      return "folder";
    default:
      return undefined;
  }
}

export function useWorkstationRailTabs({
  miniTerminalClaimedIds,
  showMiniTerminal,
  t,
}: {
  miniTerminalClaimedIds: readonly string[];
  showMiniTerminal: (sessionId: string | null) => void;
  t: TFunction;
}) {
  const navigate = useNavigate();
  const tabEntries = useAtomValue(tabRegistryAtom);
  const terminalSessions = useAtomValue(terminalSessionsAtom);
  const initializedTerminalIds = useAtomValue(initializedTerminalIdsAtom);
  const closeTab = useCloseTabWithGuard();
  const setFocusedTab = useSetAtom(focusTabAtom);
  const clearTerminalTargetReferences = useSetAtom(
    clearTerminalTargetReferencesAtom
  );
  const closeTerminalSession = useSetAtom(closeTerminalSessionAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const setChatPanelMaximized = useSetAtom(chatPanelMaximizedAtom);

  const visibleTabs = useMemo(
    () => tabEntries.filter(({ tab }) => !tab.hideWhenOthersExist),
    [tabEntries]
  );
  const openTabs = useMemo(
    () => visibleTabs.filter(({ tab }) => tab.pinned !== true),
    [visibleTabs]
  );

  const openWorkstationHost = useCallback(
    (host: WorkstationTabHost) => {
      setStationMode("my-station");
      setChatPanelMaximized(false);
      navigate(WORKSTATION_HOST_ROUTES[host]);
    },
    [navigate, setChatPanelMaximized, setStationMode]
  );

  const openWorkstationTab = useCallback(
    (tab: WorkStationTab) => {
      setFocusedTab({ tabId: tab.id });
      openWorkstationHost(tabToHost(tab));
    },
    [openWorkstationHost, setFocusedTab]
  );

  /**
   * Terminal rows stay in the chat pane now: the session is claimed by the
   * trail's docked terminal instead of navigating to the Workstation.
   */
  const openTerminalSession = useCallback(
    (sessionId: string) => {
      showMiniTerminal(sessionId);
    },
    [showMiniTerminal]
  );

  const closePtySession = useCallback(
    (sessionId: string) => {
      closeTerminalSession(sessionId).catch((error: unknown) => {
        log.warn("closeTerminalSession failed", error);
      });
      clearTerminalTargetReferences(sessionId);
    },
    [clearTerminalTargetReferences, closeTerminalSession]
  );

  const openTabItems = useMemo<FocusedChatRailItem[]>(() => {
    const terminalItems = terminalSessions
      .filter(
        (session) =>
          !session.readOnly &&
          // Opened Tabs is a My Station list, not the shared PTY pool.
          !isChatPanelTerminalId(session.id) &&
          !isAgentPtySessionId(session.id) &&
          // Pinned terminals belong only in their docked panel, even when
          // collapsed; Opened Tabs must not repeat them.
          !miniTerminalClaimedIds.includes(session.id) &&
          initializedTerminalIds.has(session.id) &&
          (!session.isDefaultSession || session.hasUserInput === true)
      )
      .map((session) => ({
        key: `terminal-session:${session.id}`,
        label: getTerminalDisplayTitle(session),
        icon: SquareTerminalIcon,
        onClick: () => openTerminalSession(session.id),
        stopLabel: t("common:tooltips.killTerminal"),
        onStop: () => closePtySession(session.id),
      }));

    const tabItems = openTabs
      .filter(
        ({ tab }) =>
          tab.type !== "terminal" &&
          tab.type !== "start" &&
          tab.type !== "explorer" &&
          tab.type !== "source-control"
      )
      .slice(0, 6)
      .map(({ tab }) => ({
        key: tab.id,
        label: tab.title,
        icon: tab.type === "browser-session" ? InternetIcon : File01Icon,
        fileName: getRailTabFileName(tab),
        closeLabel: t("common:git.rail.closeItem", {
          label: tab.title,
        }),
        onClick: () => openWorkstationTab(tab),
        onClose: () => void closeTab({ tabId: tab.id }),
      }));

    return [...tabItems, ...terminalItems];
  }, [
    closePtySession,
    closeTab,
    initializedTerminalIds,
    miniTerminalClaimedIds,
    openTabs,
    openTerminalSession,
    openWorkstationTab,
    t,
    terminalSessions,
  ]);

  const browserTab = visibleTabs.find(
    ({ tab }) => tab.type === "browser-session"
  );

  return { browserTab, openTabItems, openWorkstationHost, openWorkstationTab };
}
