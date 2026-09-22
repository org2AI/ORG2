// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

import { WorkStationStartPage } from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "spotlightActions.openAgentStation" ? "Go to Agent Station" : key,
  }),
}));

vi.mock("@src/hooks/git/useActiveRepoRef", () => ({
  useActiveRepoRef: () => ({ repoId: null, repoPath: "" }),
}));

vi.mock("@src/hooks/git/useWorkingTreeDiffTotals", () => ({
  useWorkingTreeDiffTotals: () => ({ additions: 0, deletions: 0 }),
}));

vi.mock("../useWorkStationLaunchActions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../useWorkStationLaunchActions")>();
  const { FolderClosedIcon } = await import("@src/icons");
  const labels: Record<string, string> = {
    explorer: "Files",
    sourceControl: "Review",
    terminal: "Terminal",
    newBrowserTab: "Browser",
    searchFile: "Search file",
    searchSessions: "Kanban",
    workItems: "Work items",
    projects: "Projects",
  };
  const secondaryIds = new Set([
    "searchFile",
    "searchSessions",
    "workItems",
    "projects",
  ]);

  return {
    ...actual,
    useWorkStationLaunchActions: () =>
      actual.LAUNCHPAD_ACTION_IDS.map((id) => ({
        id,
        sectionId: secondaryIds.has(id) ? "secondary" : "primary",
        icon: FolderClosedIcon,
        label: labels[id],
        onClick: vi.fn(),
      })),
  };
});

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("WorkStationStartPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("shows the Agent Station action and both dividers for a selected session", async () => {
    await act(async () => {
      root.render(
        createElement(Provider, { store }, createElement(WorkStationStartPage))
      );
    });
    await act(async () => {
      store.set(workstationActiveSessionIdAtom, "session-1");
    });

    const action = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Go to Agent Station")
    );

    expect(action).toBeDefined();
    expect(action?.textContent).toContain("2");
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(2);

    await act(async () => action?.click());
    expect(store.get(stationModeAtom)).toBe("agent-station");
  });

  it("hides the Agent Station action but keeps the launch-section divider", async () => {
    await act(async () => {
      root.render(
        createElement(Provider, { store }, createElement(WorkStationStartPage))
      );
    });

    expect(container.textContent).not.toContain("Go to Agent Station");
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it("places the launch-section divider between Browser and Search file", async () => {
    await act(async () => {
      root.render(
        createElement(Provider, { store }, createElement(WorkStationStartPage))
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Files",
      "Review",
      "Terminal",
      "Browser",
      "Search file",
      "Kanban",
      "Work items",
      "Projects",
    ]);

    const browserButton = buttons.find(
      (button) => button.textContent === "Browser"
    );
    const separator = browserButton?.nextElementSibling;

    expect(separator?.getAttribute("role")).toBe("separator");
    expect(separator?.nextElementSibling?.textContent).toBe("Search file");
  });
});
