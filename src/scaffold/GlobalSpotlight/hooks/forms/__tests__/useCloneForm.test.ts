// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { createElement, useEffect } from "react";
import { expect, it, vi } from "vitest";

import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import { useCloneForm } from "../useCloneForm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  connections: [],
  reposCache: new Map(),
  getRepos: vi.fn(),
}));
vi.mock("@src/scaffold/ActionSystem/schema/zodRegistry", async (load) => ({
  ...(await load<
    typeof import("@src/scaffold/ActionSystem/schema/zodRegistry")
  >()),
  zodActionRegistry: { execute: mocks.execute },
}));
vi.mock("@src/hooks/git", () => ({
  useGitHubConnections: () => ({
    connections: mocks.connections,
    reposCache: mocks.reposCache,
    isLoading: false,
    getReposForConnection: mocks.getRepos,
  }),
}));
vi.mock("@src/util/workspace/defaultRepoPath", () => ({
  resolveDefaultRepoParentPath: vi.fn().mockResolvedValue("/repos"),
}));
vi.mock("@src/components/Message", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it("exposes busy state and rejects a concurrent clone attempt at the handler boundary", async () => {
  let resolve!: (value: { success: boolean }) => void;
  mocks.execute.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  let result!: ReturnType<typeof useCloneForm>;
  function View() {
    const current = useCloneForm();
    useEffect(() => {
      result = current;
    });
    return createElement("div", null, String(current.loading));
  }
  const root = createSmokeRoot();
  let first!: Promise<string | undefined>, second!: Promise<string | undefined>;
  try {
    await root.render(
      createElement(Provider, { store: createStore() }, createElement(View))
    );
    await dispatch(() => {
      first = result.handleClone("https://example.com/repo.git", "/repos");
      second = result.handleClone("https://example.com/repo.git", "/repos");
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(result.loading).toBe(true);
    expect(await second).toBeUndefined();
    await dispatch(() => resolve({ success: false }));
    await first;
    expect(result.loading).toBe(false);
  } finally {
    await root.unmount();
  }
});
