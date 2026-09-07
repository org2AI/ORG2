// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useGitEventListeners } from "../useGitEventListeners";

const websocket = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
  on: vi.fn(),
}));
vi.mock("@src/api/realtime/codeEditorWebSocket", () => ({
  getCodeEditorWebSocket: () => websocket,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  websocket.handlers.clear();
});

it("preserves scoped status pushes and disposes listeners across repo switches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  websocket.on.mockImplementation(
    (name: string, handler: (event: unknown) => void) => {
      websocket.handlers.set(name, handler);
      return () => websocket.handlers.delete(name);
    }
  );
  const root = createRoot(document.createElement("div"));
  const setGitStatus = vi.fn();
  const setGitStatusAtom = vi.fn();
  const setGitSuggestedAction = vi.fn();
  const setGitSuggestedActionAtom = vi.fn();
  const refs = {
    currentRepoIdRef: { current: "repo-a" },
    gitStatusRef: { current: null },
  };
  function Reader({ repoId }: { repoId: string | null }) {
    useGitEventListeners({
      selectedRepoId: repoId,
      refs,
      setGitStatus,
      setGitStatusAtom,
      setGitSuggestedAction,
      setGitSuggestedActionAtom,
    });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Reader, { repoId: null })));
    expect(websocket.handlers.size).toBe(0);
    await act(async () =>
      root.render(createElement(Reader, { repoId: "repo-a" }))
    );
    expect(websocket.handlers.has("repo:git_operation")).toBe(false);
    const push = websocket.handlers.get("repo:status_updated")!;
    push({ repo_id: "other", status: { branch: "ignored" } });
    expect(setGitStatus).not.toHaveBeenCalled();
    push({
      repo_id: "repo-a",
      status: {
        branch: "feature",
        files: [{ path: "a.ts", status: "M", staged: false }],
      },
    });
    expect(setGitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        current_branch: "feature",
        working_directory: expect.objectContaining({
          files: [expect.objectContaining({ path: "a.ts", status: "M" })],
        }),
      })
    );
    expect(setGitStatusAtom).toHaveBeenCalledWith(
      setGitStatus.mock.calls[0][0]
    );
    expect(setGitSuggestedAction).toHaveBeenCalledTimes(1);
    expect(setGitSuggestedActionAtom).toHaveBeenCalledTimes(1);
    refs.currentRepoIdRef.current = "repo-b";
    await act(async () =>
      root.render(createElement(Reader, { repoId: "repo-b" }))
    );
    expect(websocket.handlers.size).toBe(2);
    push({ repo_id: "repo-a", status: { branch: "late" } });
    expect(setGitStatus).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
  expect(websocket.handlers.size).toBe(0);
});
