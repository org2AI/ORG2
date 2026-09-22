import { describe, expect, it, vi } from "vitest";

import { CHAT_PANEL_CREATE_TARGET } from "@src/store/ui/chatPanel/selectionAtoms";

import { openNewChatFromSidebar } from "./sessionEntryActions";

describe("openNewChatFromSidebar", () => {
  it("activates a new ChatPanel tab after resetting the session draft", () => {
    const calls: string[] = [];
    const resetChatPanelSessionSurface = vi.fn(() => calls.push("reset"));
    const setChatPanelCreateTarget = vi.fn(() => calls.push("target"));
    const goToNewSession = vi.fn(() => calls.push("session"));
    const openNewChatTab = vi.fn(() => calls.push("tab"));

    openNewChatFromSidebar({
      goToNewSession,
      resetChatPanelSessionSurface,
      openNewChatTab,
      setChatPanelCreateTarget,
    });

    expect(resetChatPanelSessionSurface).toHaveBeenCalledOnce();
    expect(setChatPanelCreateTarget).toHaveBeenCalledWith(
      CHAT_PANEL_CREATE_TARGET.AGENT_SESSION
    );
    expect(goToNewSession).toHaveBeenCalledOnce();
    expect(openNewChatTab).toHaveBeenCalledOnce();
    expect(calls).toEqual(["reset", "target", "session", "tab"]);
  });
});
