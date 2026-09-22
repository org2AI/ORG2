// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSystemPathRepoItem } from "@src/features/SessionCreator/utils/systemPathSource";
import { sessionSourceAtom } from "@src/store/session/creatorStateAtom";
import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useSessionCreatorChatPanelHandlers } from "./useSessionCreatorChatPanelHandlers";

const mocks = vi.hoisted(() => ({
  importDirectory: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    error: mocks.logError,
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("@src/hooks/models/useAgentCompatibility", () => ({
  useAgentCompatibility: () => ({ registry: {} }),
}));
vi.mock("@src/scaffold/GlobalSpotlight/hooks/forms", () => ({
  useWorkingDirectoryForm: () => ({
    handleImportWorkingDirectory: mocks.importDirectory,
  }),
}));
vi.mock("@src/api/tauri/agent", () => ({
  showDesktopOperationVisibilityTest: vi.fn(),
  wingmanListMonitors: vi.fn(),
}));

const home = createSystemPathRepoItem({
  idSuffix: "home",
  name: "Home",
  path: "/workspace/home",
});

describe("useSessionCreatorChatPanelHandlers import completion", () => {
  let root: SmokeRoot;
  let store: ReturnType<typeof createStore>;
  let handlers: ReturnType<typeof useSessionCreatorChatPanelHandlers>;
  const selectRepo = vi.fn();
  const setAdvancedConfig = vi.fn();
  const forceRefreshRepos = vi.fn(async () => {});

  function Harness() {
    const result = useSessionCreatorChatPanelHandlers({
      reposList: [],
      effectiveSource: null,
      advancedConfig: {},
      setAdvancedConfig,
      selectRepo,
      forceRefreshRepos,
    });
    useEffect(() => {
      handlers = result;
    });
    return null;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    store = createStore();
    store.set(sessionSourceAtom, null);
    root = createSmokeRoot();
    await root.render(
      createElement(Provider, { store }, createElement(Harness))
    );
  });
  afterEach(async () => {
    await root.unmount();
  });

  it("handles an import rejection without selecting a repo or discarding the system-path source", async () => {
    const error = new Error("workspace import failed");
    mocks.importDirectory.mockRejectedValueOnce(error);
    await act(async () => {
      handlers.handleRepoSelectForSession(home.id, home);
    });
    expect(mocks.importDirectory).toHaveBeenCalledWith("/workspace/home", {
      promptForGitInit: false,
    });
    expect(selectRepo).not.toHaveBeenCalled();
    expect(store.get(sessionSourceAtom)).toMatchObject({
      type: "system_path",
      repoId: home.id,
      repoPath: "/workspace/home",
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      "Failed to import the session workspace",
      error
    );
  });

  it("still aligns a successful import with the repo selection and leaves HEAD to the live source", async () => {
    mocks.importDirectory.mockResolvedValueOnce("imported-repo");
    await act(async () => {
      handlers.handleRepoSelectForSession(home.id, home);
    });
    expect(selectRepo).toHaveBeenCalledWith("imported-repo");
    expect(store.get(sessionSourceAtom)).toEqual({
      type: "local",
      repoId: "imported-repo",
      repoName: "Home",
      repoPath: "/workspace/home",
      branch: undefined,
    });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("keeps cancelled imports as system-path sources without reporting an error", async () => {
    mocks.importDirectory.mockResolvedValueOnce(undefined);
    await act(async () => {
      handlers.handleRepoSelectForSession(home.id, home);
    });
    expect(selectRepo).not.toHaveBeenCalled();
    expect(store.get(sessionSourceAtom)?.type).toBe("system_path");
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
