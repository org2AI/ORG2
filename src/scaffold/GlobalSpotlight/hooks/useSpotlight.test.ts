// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React from "react";
import { expect, it, vi } from "vitest";

import { reposAtom, selectedRepoIdAtom } from "@src/store/repo";
import {
  activeWorkspaceIdAtom,
  workspaceFoldersAtom,
} from "@src/store/workspace";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import { SpotlightProvider } from "./core";
import { useSpotlight } from "./useSpotlight";

vi.mock("@src/hooks/navigation/useAppNavigation", () => ({
  useAppNavigation: () => ({ navigateTo: vi.fn() }),
}));
vi.mock("@src/hooks/ui/tabs/useSessionView", () => ({
  useSessionView: () => ({ openSession: vi.fn() }),
}));
vi.mock("@src/features/Org2Cloud/useOpenCloudSessionReference", () => ({
  useOpenCloudSessionReference: () => vi.fn(),
}));
vi.mock("./data", () => ({
  useSharedRepoList: () => ({
    repos: [],
    filteredRepos: [],
    loadRepos: vi.fn(),
    refreshReposForce: vi.fn(),
  }),
  useBranches: () => ({ branches: [], fetchBranches: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.repoName ? `Switch the branch of ${values.repoName}` : key,
  }),
}));

it("keeps repo-named branch commands wired through the main hook across repo changes", async () => {
  const store = createStore();
  store.set(reposAtom, [
    { id: "a", name: "Frontend", kind: "git", path: "/repos/front" },
    { id: "b", name: "Backend", kind: "git", path: "/repos/back" },
  ]);
  store.set(selectedRepoIdAtom, "a");
  store.set(activeWorkspaceIdAtom, null);
  store.set(workspaceFoldersAtom, []);
  const openBranch = vi.fn();
  function Harness({ currentRepoId }: { currentRepoId?: string }) {
    const { items } = useSpotlight({
      isOpen: true,
      currentRepoId,
      onOpenBranchPicker: openBranch,
    });
    return React.createElement(
      React.Fragment,
      null,
      ...items
        .filter((item) => item.id.startsWith("workspace-switch-branch:"))
        .map((item) =>
          React.createElement(
            "button",
            { key: item.id, onClick: () => item.action?.() },
            item.label
          )
        )
    );
  }
  const root = createSmokeRoot();
  const render = (currentRepoId?: string) =>
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(
          SpotlightProvider,
          null,
          React.createElement(Harness, { currentRepoId })
        )
      )
    );
  try {
    await render();
    expect(root.container.textContent).toBe("Switch the branch of Frontend");
    await dispatch(() => root.container.querySelector("button")!.click());
    expect(openBranch).toHaveBeenLastCalledWith("a");
    await render("b");
    expect(root.container.textContent).toBe("Switch the branch of Backend");
    await dispatch(() => root.container.querySelector("button")!.click());
    expect(openBranch).toHaveBeenLastCalledWith("b");
  } finally {
    await root.unmount();
  }
});
