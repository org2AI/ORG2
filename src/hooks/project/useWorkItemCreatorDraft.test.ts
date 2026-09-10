// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { MANUAL_WORK_ITEM_CREATOR_DRAFT_ID } from "@src/store/workstation/projectManager";

import { useWorkItemCreatorDraft } from "./useWorkItemCreatorDraft";

it("editing or clearing the floating draft preserves the mounted Agent draft", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const drafts: Record<string, ReturnType<typeof useWorkItemCreatorDraft>> = {};
  function Harness({ kind }: { kind: "agent" | "manual" }) {
    const draft = useWorkItemCreatorDraft({
      draftId:
        kind === "manual" ? MANUAL_WORK_ITEM_CREATOR_DRAFT_ID : undefined,
    });
    useEffect(() => {
      drafts[kind] = draft;
    }, [draft, kind]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(Harness, { kind: "agent" }),
          React.createElement(Harness, { kind: "manual" })
        )
      )
    );
    act(() => drafts.agent.updateDraft({ name: "Agent draft" }));
    act(() => drafts.manual.updateDraft({ name: "Manual draft" }));
    expect(drafts.agent.draft.name).toBe("Agent draft");
    expect(drafts.manual.draft.name).toBe("Manual draft");
    act(() => drafts.manual.clearDraft());
    expect(drafts.agent.draft.name).toBe("Agent draft");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
