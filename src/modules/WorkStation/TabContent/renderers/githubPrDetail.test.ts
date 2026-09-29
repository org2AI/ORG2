// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  workstationPrScopeKey,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { createGitHubPrDetailTab } from "@src/store/workstation/tabs/factories/githubPr";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import Renderer from "./githubPrDetail";

const updateTabMeta = vi.hoisted(() => vi.fn());
vi.mock("@src/hooks/tabHost/useWorkStationTabs", () => ({
  useWorkStationTabs: () => ({ openTab: vi.fn(), updateTabMeta }),
}));
vi.mock("@src/hooks/tabHost/useWorkstationTabHeader", () => ({
  usePublishWorkstationTabHeader: vi.fn(),
}));
vi.mock(
  "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailPanel",
  () => ({
    PrDetailPanel: () => null,
    PrDetailTabs: () => null,
    PrDetailExternalLinkButton: () => null,
  })
);
let root: ReturnType<typeof createSmokeRoot>;
beforeEach(() => {
  root = createSmokeRoot();
});
afterEach(async () => {
  await root.unmount();
  vi.clearAllMocks();
});
it("repairs restored number-only labels and updates them when remote title arrives or changes", async () => {
  const store = createStore();
  const pr = {
    prNumber: 42,
    prTitle: "Initial title",
    prUrl: "https://github.com/acme/repo/pull/42",
    prStatus: "open",
    headBranch: "feature",
    repoPath: "",
  };
  const tab = { ...createGitHubPrDetailTab(pr), title: "#42" };
  await root.render(
    createElement(
      Provider,
      { store },
      createElement(Renderer, { tab, isActive: true })
    )
  );
  expect(updateTabMeta).toHaveBeenLastCalledWith(tab.id, {
    title: "#42 Initial title",
  });
  const selected = workstationSelectedPrAtomFamily(
    workstationPrScopeKey(undefined, "", 42, pr.prUrl)
  );
  await act(async () => {
    store.set(selected, (state) => ({
      ...state,
      detail: { title: "Fetched title" },
    }));
  });
  expect(updateTabMeta).toHaveBeenLastCalledWith(tab.id, {
    title: "#42 Fetched title",
  });
  await act(async () => {
    store.set(selected, (state) => ({
      ...state,
      detail: { title: "Renamed title" },
    }));
  });
  expect(updateTabMeta).toHaveBeenLastCalledWith(tab.id, {
    title: "#42 Renamed title",
  });
});
it("does not duplicate the number while metadata is still loading", () => {
  expect(
    createGitHubPrDetailTab({
      prNumber: 42,
      prTitle: "#42",
      prUrl: "https://github.com/acme/repo/pull/42",
      prStatus: "open",
      headBranch: "",
      repoPath: "",
    }).title
  ).toBe("#42");
});
