import { Provider, createStore } from "jotai";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnSummary } from "@src/engines/SessionCore/storage/sqliteCache";
import { chatTurnMetadataVisibleAtom } from "@src/store/ui/chatPanel/displayPrefsAtoms";

import {
  turnMetadataAtomFamily,
  turnMetadataKey,
} from "../../turnMetadataAtom";
import TurnMetadataFooterSlot from "../TurnMetadataFooterSlot";

vi.mock("@src/components/FileTypeIcon", () => ({
  default: () => React.createElement("span"),
}));

const SUMMARY: TurnSummary = {
  sessionId: "session-1",
  turnId: "turn-1",
  startSequence: 1,
  endSequence: 2,
  nextTurnId: null,
  startedAt: "2026-07-30T00:00:00.000Z",
  endedAt: "2026-07-30T00:00:01.000Z",
  durationMs: 1000,
  userEventIds: [],
  userPreview: "",
  eventCount: 1,
  bodyEventCount: 1,
  status: "completed",
  interrupted: false,
  modifiedFiles: [
    {
      path: "src/app.ts",
      fileName: "app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
    },
  ],
  resourceInteractions: [],
  gitArtifacts: [],
};

function renderSlot(visible: boolean): string {
  const store = createStore();
  store.set(
    turnMetadataAtomFamily(turnMetadataKey(SUMMARY.sessionId, SUMMARY.turnId)),
    SUMMARY
  );
  store.set(chatTurnMetadataVisibleAtom, visible);
  return renderToStaticMarkup(
    React.createElement(
      Provider,
      { store },
      React.createElement(TurnMetadataFooterSlot, {
        sessionId: SUMMARY.sessionId,
        turnId: SUMMARY.turnId,
        isLastGroup: true,
      })
    )
  );
}

describe("TurnMetadataFooterSlot visibility toggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the edits/reads card when the toggle is on", () => {
    expect(renderSlot(true)).toContain('data-testid="turn-metadata-footer"');
  });

  it("renders nothing when the toggle is off", () => {
    expect(renderSlot(false)).toBe("");
  });
});
