/** Shared delivery boundary for CLI and native session terminal events. */
import type { TFunction } from "i18next";

import {
  notifyError,
  notifyTaskCompletion,
} from "@src/api/services/notification";
import Message from "@src/components/Message";
import type { NotificationSettings } from "@src/store/ui/notificationAtom";
import { isTerminalStatus } from "@src/types/session/session";

export interface SessionTerminalNotification {
  sessionId: string;
  status: string;
  sessionName: string;
  /** True when the user already has this Session's tab selected. */
  sessionInActiveTab: boolean;
  attentionRequired: boolean;
  errorMessage?: string;
  eventKey?: string;
}

export function shouldDeliverSessionTerminalNotification(
  previousStatus: string | undefined,
  nextStatus: string
): boolean {
  return (
    isTerminalStatus(nextStatus) &&
    (previousStatus === undefined || !isTerminalStatus(previousStatus))
  );
}

export function deliverSessionTerminalNotification(
  event: SessionTerminalNotification,
  settings: NotificationSettings,
  t: TFunction
): void {
  const context = {
    sessionId: event.sessionId,
    background: event.attentionRequired,
    ...(event.eventKey ? { eventKey: event.eventKey } : {}),
  };

  if (event.status === "completed" || event.status === "idle") {
    // The transcript itself is the completion surface for the selected tab.
    // Do not create a redundant native, audio, summary, or in-app message.
    if (event.sessionInActiveTab) return;

    const body = t("notifications.taskCompletedBody", {
      name: event.sessionName,
    });
    notifyTaskCompletion(body, settings, {
      title: t("notifications.taskCompletedTitle"),
      context,
      summaryLabel: event.sessionName,
    })
      .then((result) => {
        if (result.disposition !== "delivered" || !event.attentionRequired)
          return;
        Message.success({
          content: t("notifications.taskCompletedToast", {
            name: event.sessionName,
          }),
          // Actionable completion notices still expire; duration is milliseconds.
          duration: 6000,
          closable: true,
          // The copy says "open the Session" — give it an actual door.
          action: {
            label: t("notifications.openSessionAction"),
            onClick: () => {
              void Promise.all([
                import("@src/util/core/state/instrumentedStore"),
                import("@src/store/chatPanel/chatPanelTabsAtom"),
              ]).then(([storeModule, tabsModule]) => {
                storeModule
                  .getInstrumentedStore()
                  .set(tabsModule.openOrFocusSessionInChatPanelTabAtom, {
                    sessionId: event.sessionId,
                    sessionName: event.sessionName,
                  });
              });
            },
          },
        });
      })
      // Notification delivery is best effort and this public boundary is void.
      .catch(() => undefined);
    return;
  }

  if (event.status === "failed") {
    const detail = event.errorMessage
      ? `: ${event.errorMessage.slice(0, 120)}`
      : "";
    const toastBody = t("notifications.taskFailedBody", {
      name: event.sessionName,
      detail,
    });
    notifyError(t("notifications.taskFailedPrivateBody"), settings, {
      title: t("notifications.taskFailedTitle"),
      context,
    })
      .then((result) => {
        if (result.disposition !== "delivered" || !event.attentionRequired)
          return;
        Message.error({
          content: toastBody,
          duration: 8000,
          closable: true,
        });
      })
      // Match completion delivery: native notifications are best effort.
      .catch(() => undefined);
    return;
  }

  if (
    event.status === "cancelled" &&
    event.attentionRequired &&
    settings.enabled
  ) {
    Message.warning({
      content: t("notifications.taskCancelledToast", {
        name: event.sessionName,
      }),
      duration: 5000,
    });
  }
}
