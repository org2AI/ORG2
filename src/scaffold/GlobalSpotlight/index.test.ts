// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ReactNode, createElement } from "react";
import { expect, it, vi } from "vitest";

import { reposAtom, selectedRepoIdAtom } from "@src/store/repo";
import {
  type SpotlightInitialQuery,
  spotlightInitialQueryAtom,
} from "@src/store/ui/uiAtom";
import { createSmokeRoot, dispatch, settle } from "@src/test/reactSmokeHarness";

import { GlobalSpotlight } from "./index";

const repo = vi.hoisted(() => ({
  id: "repo",
  name: "Repo",
  kind: "git" as const,
  path: "/repo",
}));
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/workstation/code" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/hooks/git/useRepoSelection", () => ({
  useRepoSelection: () => ({
    selectedRepoId: "repo",
    currentRepo: repo,
    repos: [repo],
    currentBranch: "main",
    selectRepo: vi.fn(),
    selectBranch: vi.fn(),
    refreshBranches: vi.fn(),
  }),
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
vi.mock("./hooks/data", () => ({
  useSharedRepoList: () => ({ filteredRepos: [], loadRepos: vi.fn() }),
}));
vi.mock("./hooks/features/useSpotlightPickerActions", () => ({
  useSpotlightPickerActions: () => ({}),
}));
vi.mock("./shell", () => ({
  SpotlightShell: ({ children }: { children: ReactNode }) =>
    createElement("section", null, children),
  PaletteBody: ({
    kernel,
    items,
  }: {
    kernel: {
      selectedIndex: number;
      inputRef: import("react").RefObject<HTMLInputElement | null>;
      handleItemClick: (item: unknown) => void;
    };
    items: { id: string; label: string }[];
  }) =>
    createElement(
      "div",
      { "data-root-list": true, "data-selected": kernel.selectedIndex },
      createElement("input", { ref: kernel.inputRef }),
      ...items.map((item) =>
        createElement(
          "button",
          {
            key: item.id,
            "data-item-id": item.id,
            onClick: () => kernel.handleItemClick(item),
          },
          item.label
        )
      )
    ),
}));
vi.mock("./palettes", async () => {
  const { useSelector } = await import("./hooks/selectors/useSelector");
  function Child({
    onGoBackToParent,
    initialMode,
    initialQuery,
    repoId,
  }: {
    onGoBackToParent: () => void;
    initialMode?: string;
    initialQuery?: string;
    repoId?: string;
  }) {
    const kernel = useSelector({
      isOpen: true,
      onClose: vi.fn(),
      items: [{ id: "child", label: "child" }],
    });
    return createElement(
      "div",
      {
        "data-child": initialMode ?? repoId ?? "directory",
        "data-query": initialQuery,
      },
      createElement("input", { ref: kernel.inputRef }),
      createElement(
        "button",
        { "data-back": true, onClick: onGoBackToParent },
        "Back"
      )
    );
  }
  return Object.fromEntries(
    [
      "WorkingDirectoryPalette",
      "BranchPalette",
      "WorktreePalette",
      "EditorPalette",
      "AgentControlPalette",
      "AgentSessionSearchPalette",
      "AllSessionsSearchPalette",
      "SessionCreatorPalette",
    ].map((name) => [name, Child])
  );
});
vi.mock("./forms/CollabOrg/CollabOrgForm", () => ({ default: () => null }));
vi.mock("./forms/GitHubIssuesImport/GitHubIssuesImportForm", () => ({
  default: () => null,
}));
vi.mock("@src/features/Org2Cloud/ImportSharedSessionDialog", () => ({
  default: () => null,
}));

it("retargets visible layers, keeps one keyboard owner, and restores the activated root item", async () => {
  vi.useFakeTimers();
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const add = document.addEventListener.bind(document),
    remove = document.removeEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (name, fn, options) => {
      if (name === "keydown" && options === true) listeners.add(fn);
      add(name, fn, options);
    }
  );
  vi.spyOn(document, "removeEventListener").mockImplementation(
    (name, fn, options) => {
      if (name === "keydown" && options === true) listeners.delete(fn);
      remove(name, fn, options);
    }
  );
  const store = createStore();
  store.set(reposAtom, [repo]);
  store.set(selectedRepoIdAtom, repo.id);
  const close = vi.fn();
  const root = createSmokeRoot();
  const request = (value: SpotlightInitialQuery) =>
    dispatch(() => store.set(spotlightInitialQueryAtom, value));
  try {
    await root.render(
      createElement(
        Provider,
        { store },
        createElement(GlobalSpotlight, { isOpen: true, onClose: close })
      )
    );
    await settle();
    expect(listeners.size).toBe(1);
    const button = root.container.querySelector<HTMLButtonElement>(
      '[data-item-id="workspace-switch-workspace"]'
    )!;
    expect(button).not.toBeNull();
    await dispatch(() => button.click());
    await settle();
    expect(root.container.querySelector("[data-root-list]")).toBeNull();
    expect(listeners.size).toBe(1);
    await dispatch(() =>
      root.container.querySelector<HTMLButtonElement>("[data-back]")!.click()
    );
    await settle();
    const expectedIndex = [
      ...root.container.querySelectorAll("[data-item-id]"),
    ].findIndex(
      (item) =>
        item.getAttribute("data-item-id") === "workspace-switch-workspace"
    );
    expect(
      root.container
        .querySelector("[data-root-list]")
        ?.getAttribute("data-selected")
    ).toBe(String(expectedIndex));
    await request({ query: "", layer: { kind: "branch", repoId: "repo" } });
    expect(root.container.querySelector('[data-child="repo"]')).not.toBeNull();
    await request({
      query: ">undo",
      layer: { kind: "editor", mode: "command" },
    });
    expect(
      root.container
        .querySelector('[data-child="command"]')
        ?.getAttribute("data-query")
    ).toBe(">undo");
    expect(root.container.querySelector('[data-child="repo"]')).toBeNull();
    expect(store.get(spotlightInitialQueryAtom)).toBeNull();
    expect(listeners.size).toBe(1);
    await request({ query: "", layer: { kind: "default" } });
    expect(root.container.querySelector("[data-root-list]")).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  } finally {
    await root.unmount();
    expect(listeners.size).toBe(0);
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
