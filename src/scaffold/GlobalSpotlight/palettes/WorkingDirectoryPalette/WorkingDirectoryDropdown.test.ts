// @vitest-environment jsdom
import { type ComponentProps, act, createElement, createRef } from "react";
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

import { REPO_KIND } from "@src/store/repo";

import { WorkingDirectoryDropdown } from "./WorkingDirectoryDropdown";

const discovery = vi.hoisted(() => ({ enabled: vi.fn() }));

const EXTERNAL_RECENT_PATH = "/Users/tester/Documents/GitHub/business-plan";
const SAVED_REPOS = [
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `saved-${index}`,
    name: `Saved ${index}`,
    fs_uri: `/saved/${index}`,
    kind: REPO_KIND.GIT,
  })),
  {
    id: "inside-org",
    name: "Inside org",
    fs_uri: "/inside-org",
    kind: REPO_KIND.GIT,
  },
  {
    id: "outside-org",
    name: "Outside org",
    fs_uri: "/outside-org",
    kind: REPO_KIND.GIT,
  },
];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { org?: string }) =>
      key === "selectors.repo.sections.outsideNamedOrg"
        ? `Outside ${options?.org}`
        : key,
  }),
}));

vi.mock("@src/api/tauri/repo", () => ({
  repoApi: { getRepoById: vi.fn() },
}));

vi.mock("@src/scaffold/GlobalSpotlight/hooks", () => ({
  useSharedRepoList: () => ({
    repos: SAVED_REPOS,
    filteredRepos: SAVED_REPOS,
    repoLoading: false,
    refreshReposForce: vi.fn(),
  }),
  useExternalRecentPaths: (options: { enabled: boolean }) => {
    discovery.enabled(options.enabled);
    return {
      recentPathRepos: [
        {
          id: `external-recent:${EXTERNAL_RECENT_PATH}`,
          name: "business-plan",
          description: EXTERNAL_RECENT_PATH,
          fs_uri: EXTERNAL_RECENT_PATH,
          kind: REPO_KIND.FOLDER,
        },
      ],
    };
  },
  useWorkspaceSwitch: () => ({
    workspaces: [],
    activateWorkspace: vi.fn(),
  }),
}));

vi.mock("@src/scaffold/GlobalSpotlight/hooks/forms", () => ({
  useWorkingDirectoryForm: () => ({ handleImportWorkingDirectory: vi.fn() }),
}));

vi.mock("@src/hooks/dropdown", () => ({
  useDropdownEngine: () => ({
    isPositioned: true,
    panelRef: createRef<HTMLDivElement>(),
    panelPosition: { top: 100, bottom: undefined, left: 40, width: 320 },
    keyboard: {
      selectedIndex: -1,
      setSelectedIndex: vi.fn(),
      getItemProps: (index: number) => ({
        "data-dropdown-item-index": index,
        "aria-selected": false,
        onMouseEnter: vi.fn(),
        onClick: vi.fn(),
      }),
      handleKeyDown: vi.fn(),
      keyboardNavigated: false,
      clearKeyboardNavigation: vi.fn(),
    },
  }),
}));

describe("WorkingDirectoryDropdown rows", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  const renderDropdown = (
    overrides: Partial<ComponentProps<typeof WorkingDirectoryDropdown>> = {}
  ) => {
    act(() => {
      root.render(
        createElement(WorkingDirectoryDropdown, {
          isOpen: true,
          onClose: vi.fn(),
          onSelect: vi.fn(),
          anchorRef: createRef<HTMLElement>(),
          ...overrides,
        })
      );
    });
  };

  const externalRecentRow = () =>
    document.querySelector<HTMLButtonElement>(
      `[data-testid="repo-dropdown-row-external-recent:${EXTERNAL_RECENT_PATH}"]`
    );

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("loads external apps even with more than five saved repositories", () => {
    discovery.enabled.mockClear();
    renderDropdown();
    expect(discovery.enabled).toHaveBeenLastCalledWith(true);
    expect(externalRecentRow()).not.toBeNull();
  });

  it("keeps the path off the row instead of rendering it as a second line", () => {
    renderDropdown();

    const row = externalRecentRow();
    expect(row).not.toBeNull();
    expect(row?.textContent).toBe("business-plan");
    expect(row?.textContent).not.toContain(EXTERNAL_RECENT_PATH);
  });

  it("reveals the path in a detail pane while the row is hovered", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    renderDropdown();

    const row = externalRecentRow();
    expect(document.querySelector("[data-spotlight-detail-pane]")).toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });

    expect(
      document.querySelector("[data-spotlight-detail-pane]")?.textContent
    ).toContain(EXTERNAL_RECENT_PATH);

    act(() => {
      row?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });

    expect(document.querySelector("[data-spotlight-detail-pane]")).toBeNull();
  });

  it("marks the panel as a menu so side tooltips clear its border", () => {
    renderDropdown();

    const panel = document.querySelector('[role="menu"]');
    expect(panel).not.toBeNull();
    expect(externalRecentRow()?.closest('[role="menu"]')).toBe(panel);
  });

  it("labels organization-scoped sections with the selected org name", () => {
    renderDropdown({
      orgScopeName: "ORG2 OSS",
      repoFilter: (repo) => repo.fs_uri === "/inside-org",
    });

    expect(document.body.textContent).toContain("ORG2 OSS");
    expect(document.body.textContent).toContain("Outside ORG2 OSS");
    expect(document.body.textContent).not.toContain("working directory");
  });
});
