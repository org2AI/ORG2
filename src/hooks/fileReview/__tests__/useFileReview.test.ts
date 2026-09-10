// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  clearFileReviewAtom,
  fileReviewWorkspacePathAtom,
  pendingReviewCountAtom,
  pendingSnapshotAnchorsAtom,
  registerFileChangesBatchAtom,
} from "@src/store/session/fileReviewAtom";

import { useFileReviewBatchActions, useFileReviewSync } from "../useFileReview";

const api = vi.hoisted(() => ({
  getSnapshots: vi.fn(),
  getSession: vi.fn(),
  getSessionFiles: vi.fn(),
  getFileResolutions: vi.fn(),
  resolveReview: vi.fn(),
  revertToSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
}));
const websocket = vi.hoisted(() => ({ on: vi.fn() }));
vi.mock("@src/api/tauri/agent", () => api);
vi.mock("@src/api/realtime/codeEditorWebSocket", () => ({
  getCodeEditorWebSocket: () => websocket,
}));
vi.mock("@src/engines/SessionCore/control/sessionTimelineBoundary", () => ({
  beginTimelineBoundary: vi.fn(),
}));
vi.mock("@src/engines/SessionCore/core/atoms/metadata", async () => {
  const { atom } = await import("jotai");
  return { sessionIdAtom: atom<string | null>(null) };
});
vi.mock("@src/store/session/cliSessionStatusAtom", async () => {
  const { atom } = await import("jotai");
  return { sessionRuntimeStatusAtom: atom("idle") };
});
vi.mock("@src/util/session/sessionDispatch", () => ({
  isAgentSession: () => true,
  isCliSession: () => false,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("loads active review data without resolutions and ignores old session results", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const unsubscribe = vi.fn();
  websocket.on.mockReturnValue(unsubscribe);
  let finishOld!: (records: unknown[]) => void;
  api.getSnapshots.mockImplementation((sessionId: string) =>
    sessionId === "old"
      ? new Promise((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve([
          {
            sessionId,
            toolCallId: "edit",
            hash: "current-hash",
            createdAt: "2026-09-07T00:00:00Z",
          },
        ])
  );
  api.getSession.mockImplementation((sessionId: string) =>
    Promise.resolve({ workspacePath: "/" + sessionId })
  );
  const store = createStore();
  const root = createRoot(document.createElement("div"));
  function Reader({ id, enabled }: { id: string; enabled: boolean }) {
    useFileReviewSync(id, enabled);
    return null;
  }
  async function render(id: string, enabled = true) {
    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Reader, { id, enabled })
        )
      )
    );
  }
  try {
    await render("old", false);
    expect(api.getSnapshots).not.toHaveBeenCalled();
    await render("old");
    await render("current");
    expect(store.get(fileReviewWorkspacePathAtom)).toBe("/current");
    expect(store.get(pendingSnapshotAnchorsAtom)).toEqual([
      {
        sessionId: "current",
        hash: "current-hash",
        createdAt: "2026-09-07T00:00:00Z",
      },
    ]);
    await act(async () =>
      finishOld([
        {
          sessionId: "old",
          toolCallId: "late",
          hash: "old-hash",
          createdAt: "2026-09-06T00:00:00Z",
        },
      ])
    );
    expect(store.get(pendingSnapshotAnchorsAtom)[0].sessionId).toBe("current");
    expect(api.getSnapshots).toHaveBeenCalledTimes(2);
    expect(api.getFileResolutions).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
  expect(unsubscribe).toHaveBeenCalledTimes(4);
});

it("preserves Keep, Undo and Redo through their existing backend actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.resolveReview.mockResolvedValue(undefined);
  api.revertToSnapshot.mockResolvedValue({
    restored: 1,
    deleted: 0,
    redoAnchors: [
      {
        sessionId: "current",
        snapshotId: "redo-hash",
        createdAt: "2026-09-07T00:00:00Z",
      },
    ],
  });
  api.restoreSnapshot.mockResolvedValue({ restored: 1, deleted: 0 });
  const store = createStore();
  store.set(clearFileReviewAtom, "current");
  function seed() {
    store.set(registerFileChangesBatchAtom, {
      sessionId: "current",
      entries: [
        {
          callId: "edit",
          snapshotSessionId: "current",
          snapshotHash: "hash",
          createdAt: "2026-09-07T00:00:00Z",
        },
      ],
    });
  }
  let actions!: ReturnType<typeof useFileReviewBatchActions>;
  function Reader() {
    const value = useFileReviewBatchActions("current");
    useEffect(() => {
      actions = value;
    }, [value]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    seed();
    await act(async () =>
      root.render(createElement(Provider, { store }, createElement(Reader)))
    );
    await act(async () => actions.onKeepAll());
    expect(api.resolveReview).toHaveBeenCalledWith("current");
    expect(store.get(pendingReviewCountAtom)).toBe(0);
    await act(async () => seed());
    await act(async () => actions.onUndoAll());
    expect(api.revertToSnapshot).toHaveBeenCalledWith(
      "current",
      "2026-09-07T00:00:00Z"
    );
    expect(store.get(pendingReviewCountAtom)).toBe(0);
    expect(actions.redoSnapshotAnchors).toHaveLength(1);
    await act(async () => actions.onRedo());
    expect(api.restoreSnapshot).toHaveBeenCalledWith("current", "redo-hash");
    expect(actions.redoSnapshotAnchors).toEqual([]);
    expect(api.getFileResolutions).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
