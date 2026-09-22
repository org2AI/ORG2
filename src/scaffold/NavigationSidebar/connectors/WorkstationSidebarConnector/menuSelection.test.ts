import { describe, expect, it } from "vitest";

import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
} from "@src/store/ui/chatPanel/selectionAtoms";

import { resolveSessionSidebarMenuItemId } from "./menuSelection";

describe("resolveSessionSidebarMenuItemId", () => {
  it("selects Kanban from the active management tab", () => {
    expect(
      resolveSessionSidebarMenuItemId({
        activeSessionCreatorDraftId: null,
        activeSessionId: "session-1",
        activeChatPanelTabType: "work-management",
        chatPanelContentMode: CHAT_PANEL_CONTENT_MODE.SESSION,
        chatPanelCreateTarget: CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
        chatPanelSelectedProject: null,
        chatPanelSelectedWorkItem: null,
        sessionCreatorDrafts: [],
      })
    ).toBe("kanban");
  });

  it("selects Runtime from the active runtime tab", () => {
    expect(
      resolveSessionSidebarMenuItemId({
        activeSessionCreatorDraftId: null,
        activeSessionId: "session-1",
        activeChatPanelTabType: "runtime",
        chatPanelContentMode: CHAT_PANEL_CONTENT_MODE.SESSION,
        chatPanelCreateTarget: CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
        chatPanelSelectedProject: null,
        chatPanelSelectedWorkItem: null,
        sessionCreatorDrafts: [],
      })
    ).toBe("runtime");
  });
});
