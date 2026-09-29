import { describe, expect, it } from "vitest";

import {
  isSameFocusedChatGitEnvironment,
  resolveFocusedChatWorkstationRailInsetStyle,
  resolveFocusedChatWorkstationRailTrackClass,
  resolveFocusedChatWorkstationSectionOrder,
  shouldMountFocusedChatWorkstationControls,
} from "./focusedChatWorkstationLayout";
import { CHAT_PANEL_HEADER_STACK_HEIGHT_PX } from "./header/chatPanelHeaderLayout";

describe("shouldMountFocusedChatWorkstationControls", () => {
  it("mounts only for a maximized session with visible session content", () => {
    expect(
      shouldMountFocusedChatWorkstationControls({
        activeTabType: "session",
        isChatFocus: true,
        showSessionContent: true,
      })
    ).toBe(true);
  });

  it.each([
    {
      activeTabType: "session" as const,
      isChatFocus: false,
      showSessionContent: true,
    },
    {
      activeTabType: "project" as const,
      isChatFocus: true,
      showSessionContent: true,
    },
    {
      activeTabType: "session" as const,
      isChatFocus: true,
      showSessionContent: false,
    },
  ])("stays unmounted outside the focused session lifecycle", (input) => {
    expect(shouldMountFocusedChatWorkstationControls(input)).toBe(false);
  });
});

describe("resolveFocusedChatWorkstationRailTrackClass", () => {
  it("drives the expanded column from the resizable track-width variable", () => {
    expect(resolveFocusedChatWorkstationRailTrackClass(false)).toBe(
      "w-0 @[1100px]/focusedchat:w-(--workstation-trail-track-width) @[1100px]/focusedchat:px-1 @[1100px]/focusedchat:pb-1 @[1100px]/focusedchat:mr-2"
    );
  });

  it("keeps the collapsed track at the fixed button-controlled width", () => {
    expect(resolveFocusedChatWorkstationRailTrackClass(true)).toBe(
      "w-0 @[1100px]/focusedchat:w-11 @[1100px]/focusedchat:px-1 @[1100px]/focusedchat:pb-1"
    );
  });

  it("does not reserve a right-hand column for the fullscreen minimap", () => {
    for (const collapsed of [false, true]) {
      const track = resolveFocusedChatWorkstationRailTrackClass(collapsed);
      expect(track).toContain("w-0");
      expect(track).not.toContain(`@[850px]/focusedchat:w-9`);
    }
  });
});

describe("resolveFocusedChatWorkstationRailInsetStyle", () => {
  it("restores the rail below the overlaid two-row chat header", () => {
    expect(
      resolveFocusedChatWorkstationRailInsetStyle(
        CHAT_PANEL_HEADER_STACK_HEIGHT_PX
      )
    ).toEqual({
      marginTop: `${CHAT_PANEL_HEADER_STACK_HEIGHT_PX}px`,
      height: `calc(100% - ${CHAT_PANEL_HEADER_STACK_HEIGHT_PX}px)`,
    });
  });

  it("does not alter non-overlay rail placement", () => {
    expect(resolveFocusedChatWorkstationRailInsetStyle(0)).toEqual({});
  });
});

describe("resolveFocusedChatWorkstationSectionOrder", () => {
  it("keeps local session context below the local environment", () => {
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        true,
        true,
        false,
        undefined,
        false
      )
    ).toEqual(["workspace", "session", "tabs"]);
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        false,
        true,
        false,
        undefined,
        false
      )
    ).toEqual(["workspace", "session"]);
  });

  it("places a cloud session environment above the local environment", () => {
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        true,
        true,
        false,
        "cloud",
        false
      )
    ).toEqual(["session", "workspace", "tabs"]);
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        false,
        true,
        true,
        "cloud",
        false
      )
    ).toEqual(["session", "workspace", "subagents"]);
  });

  it("omits an empty session environment without hiding local actions", () => {
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        true,
        false,
        false,
        undefined,
        false
      )
    ).toEqual(["workspace", "tabs"]);
  });

  it("slots subagents below the environment sections and above open tabs", () => {
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        true,
        true,
        true,
        undefined,
        false
      )
    ).toEqual(["workspace", "session", "subagents", "tabs"]);
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        false,
        false,
        true,
        undefined,
        false
      )
    ).toEqual(["workspace", "subagents"]);
  });

  it("slots sources after subagents and above open tabs", () => {
    expect(
      resolveFocusedChatWorkstationSectionOrder(true, true, true, "local", true)
    ).toEqual(["workspace", "session", "subagents", "sources", "tabs"]);
    expect(
      resolveFocusedChatWorkstationSectionOrder(
        false,
        true,
        false,
        "cloud",
        true
      )
    ).toEqual(["session", "workspace", "sources"]);
  });
});

describe("isSameFocusedChatGitEnvironment", () => {
  it("recognizes the same session and local Git identity", () => {
    expect(
      isSameFocusedChatGitEnvironment({
        localBranchName: "develop",
        localRepoPath: "/workspace/ORGII/",
        sessionBranchName: "develop",
        sessionRepoPath: "/workspace/ORGII",
      })
    ).toBe(true);
  });

  it("keeps different session branches on an independent PR lookup", () => {
    expect(
      isSameFocusedChatGitEnvironment({
        localBranchName: "develop",
        localRepoPath: "/workspace/ORGII",
        sessionBranchName: "feat/session",
        sessionRepoPath: "/workspace/ORGII",
      })
    ).toBe(false);
  });
});
