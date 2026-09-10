import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ROUTES } from "@src/config/routes";
import { createLogger } from "@src/hooks/logger";
import { navigateApp } from "@src/router/navigateApp";
import {
  openOrFocusSessionInChatPanelTabAtom,
  openRuntimeInChatPanelTabAtom,
  openWorkManagementChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  markAllSessionsVisited,
  sessionsAtom,
  visitedSessionsAtom,
} from "@src/store/session";
import { activeStationChatVisibleAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { isTauriDesktop } from "@src/util/platform/tauri";
import { isSessionCompletedUnread } from "@src/util/session/sessionStatusDot";

import { projectTraySessions } from "./projection";
import { createTraySync } from "./sync";

type TrayAction =
  | { kind: "kanban" }
  | { kind: "runtime" }
  | { kind: "markAllRead" }
  | { kind: "session"; id: string };

const log = createLogger("TraySessions");

/** Main-window owner; the native menu must remain current while the app is hidden. */
export function useTraySessions() {
  const store = useStore();
  const { t } = useTranslation("sessions");

  useEffect(() => {
    if (!isTauriDesktop() || getCurrentWindow().label !== "main") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const snapshot = () => ({
      sections: projectTraySessions(
        store.get(sessionsAtom),
        store.get(visitedSessionsAtom),
        {
          pinned: t("tray.pinned"),
          unread: t("tray.unread"),
          running: t("tray.running"),
          recent: t("tray.recent"),
          untitled: t("history.untitledSession"),
          markAllRead: t("tray.markAllRead"),
        }
      ),
      emptyLabel: t("tray.empty"),
      quitLabel: t("tray.quit"),
      kanbanLabel: t("tray.showKanban"),
      runtimeLabel: t("tray.showRuntime"),
    });
    const sync = createTraySync<ReturnType<typeof snapshot>>(
      (payload) => invoke("tray_update_sessions", payload),
      (error) => log.error("Failed to update tray sessions", error)
    );
    const update = () => sync.update(snapshot());
    const unsubscribeSessions = store.sub(sessionsAtom, update);
    const unsubscribeVisited = store.sub(visitedSessionsAtom, update);
    update();

    const openPending = async () => {
      try {
        const action = await invoke<TrayAction | null>(
          "tray_take_pending_action"
        );
        if (disposed || !action) return;
        if (action.kind === "markAllRead") {
          const visited = store.get(visitedSessionsAtom);
          markAllSessionsVisited(
            store
              .get(sessionsAtom)
              .filter(
                (row) =>
                  row.status !== "archived" &&
                  isSessionCompletedUnread(row, visited)
              )
              .map((row) => row.session_id)
          );
          return;
        }
        const session =
          action.kind === "session"
            ? store
                .get(sessionsAtom)
                .find((row) => row.session_id === action.id)
            : undefined;
        if (session?.status === "archived") return;
        store.set(stationModeAtom, "my-station");
        store.set(activeStationChatVisibleAtom, "my-station", true);
        switch (action.kind) {
          case "kanban":
            store.set(openWorkManagementChatPanelTabAtom, {});
            break;
          case "runtime":
            store.set(
              openRuntimeInChatPanelTabAtom,
              t("chat.startPage.tabs.runtime")
            );
            break;
          case "session":
            store.set(openOrFocusSessionInChatPanelTabAtom, {
              sessionId: action.id,
              sessionName: session?.name,
              repoPath: session?.repoPath,
            });
            break;
        }
        // This bootstrap owner is a sibling of RouterProvider. Send the same
        // navigation event as AppViewService; do not require router context.
        navigateApp(ROUTES.workStation.base.path);
      } catch (error) {
        log.error("Failed to open tray action", error);
      }
    };
    void listen("tray-open-action", () => {
      if (!disposed) void openPending();
    })
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        void openPending();
      })
      .catch((error) => log.error("Failed to listen for tray sessions", error));

    return () => {
      disposed = true;
      unsubscribeSessions();
      unsubscribeVisited();
      unlisten?.();
      sync.stop();
    };
  }, [store, t]);
}
