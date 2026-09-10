import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import Message from "@src/components/Message";
import type { NotificationSettings } from "@src/types/ui/notification";

import {
  deliverSessionTerminalNotification,
  shouldDeliverSessionTerminalNotification,
} from "../sessionTerminalNotifications";

vi.mock("@src/components/Message", () => ({
  default: { warning: vi.fn(), success: vi.fn() },
}));

vi.mock("@src/api/services/notification", () => ({
  TASK_FAILURE_NOTIFICATION_BODY: "Task failed",
  notifyError: vi.fn(),
  notifyTaskCompletion: vi.fn().mockResolvedValue({ disposition: "delivered" }),
}));

describe("shouldDeliverSessionTerminalNotification", () => {
  it("delivers only a new terminal transition", () => {
    expect(
      shouldDeliverSessionTerminalNotification("running", "completed")
    ).toBe(true);
    expect(
      shouldDeliverSessionTerminalNotification("completed", "completed")
    ).toBe(false);
    expect(
      shouldDeliverSessionTerminalNotification("failed", "completed")
    ).toBe(false);
    expect(shouldDeliverSessionTerminalNotification("running", "working")).toBe(
      false
    );
  });
});

describe("deliverSessionTerminalNotification", () => {
  const settings: NotificationSettings = {
    enabled: true,
    systemNotificationEnabled: false,
    dockBadgeEnabled: false,
    soundEnabled: false,
    soundPreset: "classic",
    soundVolume: 70,
    criticalOnly: false,
    quietHours: {
      enabled: false,
      start: "23:00",
      end: "08:00",
      allowCritical: true,
    },
    backgroundCompletionSummary: true,
    categories: {
      taskCompletion: true,
      agentApproval: true,
      errors: true,
      teamInbox: true,
    },
  };
  it.each(["completed", "idle"])(
    "expires a delivered %s toast after six seconds while keeping its action",
    async (status) => {
      vi.mocked(Message.success).mockClear();
      deliverSessionTerminalNotification(
        {
          sessionId: "session-a",
          sessionName: "Session A",
          status,
          attentionRequired: true,
        },
        settings,
        ((key: string) => key) as TFunction
      );
      await Promise.resolve();
      expect(Message.success).toHaveBeenCalledOnce();
      expect(Message.success).toHaveBeenCalledWith({
        content: "notifications.taskCompletedToast",
        duration: 6000,
        closable: true,
        action: {
          label: "notifications.openSessionAction",
          onClick: expect.any(Function),
        },
      });
    }
  );

  it("ignores removed mute preferences for cancellation while honoring the master toggle", () => {
    const obsoleteSettings = { ...settings, mutedSessionIds: ["session-a"] };
    const event = {
      sessionId: "session-a",
      sessionName: "Session A",
      status: "cancelled",
      attentionRequired: true,
    };
    const translate = ((key: string) => key) as TFunction;

    deliverSessionTerminalNotification(event, obsoleteSettings, translate);
    expect(Message.warning).toHaveBeenCalledOnce();
    deliverSessionTerminalNotification(
      event,
      { ...obsoleteSettings, enabled: false },
      translate
    );
    expect(Message.warning).toHaveBeenCalledOnce();
  });
});
