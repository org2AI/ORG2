// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React from "react";
import { expect, it, vi } from "vitest";

import { ACTION_ID } from "@src/scaffold/ActionSystem";
import { reposAtom, selectedRepoIdAtom } from "@src/store/repo";
import { darkSkinIdAtom, lightSkinIdAtom } from "@src/store/ui/uiAtom";
import {
  activeWorkspaceIdAtom,
  workspaceFoldersAtom,
} from "@src/store/workspace";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import { SpotlightProvider } from "./core";
import { useSpotlight } from "./useSpotlight";

const actions = vi.hoisted(() => ({
  dispatch: vi.fn().mockResolvedValue({ success: true }),
  isValidAction: vi.fn(() => false),
}));
vi.mock("@src/scaffold/ActionSystem", async (load) => ({
  ...(await load<typeof import("@src/scaffold/ActionSystem")>()),
  useActionSystemOptional: () => actions,
}));

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
    filteredRepos: [
      { id: "repo", name: "Repo", kind: "git", fs_uri: "file:///repo" },
    ],
    loadRepos: vi.fn(),
  }),
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

it.each([
  [
    ACTION_ID.SETTINGS_SET_LANGUAGE,
    "language-en",
    ACTION_ID.SETTINGS_SET_LANGUAGE,
    { language: "en" },
  ],
  ["change-theme", "theme-light", ACTION_ID.THEME_SET_LIGHT, {}],
  [
    "show-in-finder",
    "repo-repo",
    ACTION_ID.FILE_REVEAL_IN_OS_FILE_MANAGER,
    { path: "/repo" },
  ],
])(
  "executes %s immediately through its owning action and resets the root picker",
  async (commandId, optionId, actionId, payload) => {
    actions.isValidAction.mockReturnValue(true);
    actions.dispatch.mockClear();
    const store = createStore();
    const closeModal = vi.fn();
    let result!: ReturnType<typeof useSpotlight>;
    function Harness() {
      const current = useSpotlight({ isOpen: true, closeModal });
      React.useEffect(() => {
        result = current;
      });
      return null;
    }
    const root = createSmokeRoot();
    try {
      await root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            SpotlightProvider,
            null,
            React.createElement(Harness)
          )
        )
      );
      const command = result.items.find((item) =>
        item.id.endsWith(`-${commandId}`)
      );
      expect(command).toBeDefined();
      await dispatch(() => command!.action?.());
      expect(result.state.currentAction?.id).toBe(commandId);
      const option = result.items.find((item) => item.id === optionId);
      expect(option).toBeDefined();
      await dispatch(() => option!.action?.());
      expect(actions.dispatch).toHaveBeenCalledExactlyOnceWith(
        actionId,
        payload,
        "user"
      );
      expect(closeModal).toHaveBeenCalledOnce();
      expect(result.state.path).toEqual([]);
      expect(result.state.currentAction).toBeNull();
    } finally {
      await root.unmount();
      actions.isValidAction.mockReturnValue(false);
    }
  }
);

it("writes a selected skin to the variant preference without a confirmation stage", async () => {
  const store = createStore();
  const closeModal = vi.fn();
  let result!: ReturnType<typeof useSpotlight>;
  function Harness() {
    const current = useSpotlight({ isOpen: true, closeModal });
    React.useEffect(() => {
      result = current;
    });
    return null;
  }
  const root = createSmokeRoot();
  try {
    await root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(
          SpotlightProvider,
          null,
          React.createElement(Harness)
        )
      )
    );
    await dispatch(() =>
      result.items.find((item) => item.id.endsWith("-change-skin"))!.action?.()
    );
    const option = result.items.find(
      (item) => item.id.startsWith("skin-") && !item.data?.isHeader
    )!;
    expect(option).toBeDefined();
    await dispatch(() => option.action?.());
    expect([store.get(lightSkinIdAtom), store.get(darkSkinIdAtom)]).toContain(
      option.id.slice("skin-".length)
    );
    expect(closeModal).toHaveBeenCalledOnce();
    expect(result.state.currentAction).toBeNull();
  } finally {
    await root.unmount();
  }
});
