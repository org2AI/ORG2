import { describe, expect, it } from "vitest";

import { CHAT_PANEL_CREATE_TARGET } from "@src/store/ui/chatPanel/selectionAtoms";

import { resolveStartPageView } from "./startPageView";

describe("resolveStartPageView", () => {
  it.each([
    [CHAT_PANEL_CREATE_TARGET.AGENT_SESSION, "session"],
    [CHAT_PANEL_CREATE_TARGET.WORK_ITEM, "work-item"],
    [CHAT_PANEL_CREATE_TARGET.PROJECT, "more"],
    [CHAT_PANEL_CREATE_TARGET.PARALLEL_RUN, "more"],
  ] as const)("maps %s to the %s tab", (createTarget, view) => {
    expect(resolveStartPageView(createTarget)).toBe(view);
  });
});
