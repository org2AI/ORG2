// @vitest-environment jsdom
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

import { REPO_KIND } from "@src/store/repo";
import { CLI_LAUNCH_MODE } from "@src/store/session";

import CliLaunchModeSwitch from "../CliLaunchModeSwitch";
import SessionInfoLine, { type SessionInfoLineProps } from "../SessionInfoLine";
import { measureSessionInfoLayout } from "./SessionInfoLine.layoutHarness";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "sessions:planner.runningLocation.local" ? "This Mac" : key,
  }),
}));

vi.mock("@src/scaffold/GlobalSpotlight/palettes/BranchPalette", () => ({
  BranchPalette: () => null,
}));

vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/BranchPalette/BranchDropdown",
  () => ({ BranchDropdown: () => null })
);

vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette",
  () => ({
    WorkingDirectoryPalette: () => null,
  })
);

vi.mock(
  "@src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette/WorkingDirectoryDropdown",
  () => ({ WorkingDirectoryDropdown: () => null })
);

describe("SessionInfoLine", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("renders leading controls before the repository, location, and branch pills", () => {
    act(() => {
      root.render(
        createElement(SessionInfoLine, {
          repoId: "repo-1",
          repoKind: REPO_KIND.GIT,
          repoName: "ORGII",
          branchName: "main",
          worktreeLocation: "local",
          leadingContent: createElement(
            "div",
            { "data-testid": "cli-launch-mode" },
            "GUI / TUI"
          ),
        })
      );
    });

    const launchMode = container.querySelector<HTMLElement>(
      '[data-testid="cli-launch-mode"]'
    );
    const repository = container.querySelector<HTMLElement>(
      '[aria-label="selectors.sessionInfo.sourceAria"]'
    );
    const location = container.querySelector<HTMLElement>(
      '[aria-label="selectors.sessionInfo.locationAria"]'
    );
    const branch = container.querySelector<HTMLElement>(
      '[aria-label="selectors.sessionInfo.branchAria"]'
    );

    expect(launchMode).not.toBeNull();
    expect(repository).not.toBeNull();
    expect(location).not.toBeNull();
    expect(branch).not.toBeNull();
    expect(
      launchMode?.closest('[data-testid="session-info-leading"]')
    ).not.toBeNull();
    expect(launchMode?.compareDocumentPosition(repository!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(launchMode?.compareDocumentPosition(location!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(launchMode?.compareDocumentPosition(branch!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  // Chrome computes the real component geometry; JSDOM cannot detect flex overflow.
  it.skipIf(!process.env.ORGII_HEADLESS_CHROME)(
    "bounds the full GUI/TUI row through parent resize and long-label states",
    async () => {
      const longBranch =
        "junyu/session-comment-anchor-identity-and-responsive-workstation-layout";
      const leadingContent = createElement(CliLaunchModeSwitch, {
        mode: CLI_LAUNCH_MODE.GUI,
        supportsGui: true,
        onModeChange: () => {},
      });
      const scenarios: Array<{
        name: string;
        width: number;
        props?: Partial<SessionInfoLineProps>;
      }> = [
        { name: "narrow", width: 320 },
        { name: "medium", width: 480 },
        { name: "below-breakpoint", width: 447 },
        { name: "at-breakpoint", width: 448 },
        { name: "above-breakpoint", width: 449 },
        { name: "compact-parent", width: 480 },
        { name: "wide", width: 900 },
        { name: "resize", width: 900 },
        {
          name: "long-labels",
          width: 260,
          props: {
            repoName: "repository-with-a-very-long-name".repeat(3),
            worktreeLocation: "worktree",
            worktreeLocationLabel: "worktree-with-a-very-long-name".repeat(3),
            worktreeSourceLabel: "worktree-source-with-a-very-long-name".repeat(
              3
            ),
          },
        },
        { name: "loading", width: 320, props: { branchLoading: true } },
        { name: "no-branch", width: 260, props: { hideBranch: true } },
        { name: "disabled", width: 320, props: { disabled: true } },
        {
          name: "no-leading",
          width: 260,
          props: { leadingContent: undefined },
        },
        { name: "spotlight", width: 320, props: { strongSurface: false } },
      ];
      const results = await measureSessionInfoLayout(
        scenarios.map((scenario) => ({
          name: scenario.name,
          width: scenario.width,
          markup: (() => {
            act(() =>
              root.render(
                createElement(SessionInfoLine, {
                  repoId: "repo-1",
                  repoKind: REPO_KIND.GIT,
                  repoName: "ORGII",
                  branchName: longBranch,
                  worktreeLocation: "local",
                  leadingContent,
                  ...scenario.props,
                })
              )
            );
            return container.innerHTML;
          })(),
        }))
      );
      expect(results).toHaveLength((scenarios.length + 14) * 2);
      for (const result of results) {
        expect(result.contained, result.name).toBe(true);
        expect(result.noHorizontalScroll, result.name).toBe(true);
        expect(result.iconsVisible, result.name).toBe(true);
        expect(result.dividersAttached, result.name).toBe(true);
        expect(result.sameNodes, result.name).toBe(true);
        expect(result.buttonCount, result.name).toBe(
          result.name.endsWith("-no-leading")
            ? 3
            : result.name.endsWith("-no-branch")
              ? 4
              : 5
        );
        if (result.name.endsWith("-loading"))
          expect(result.disabledCount).toBe(1);
        if (result.name.endsWith("-disabled"))
          expect(result.disabledCount).toBe(3);
        if (result.name.endsWith("-narrow"))
          expect(result.branchLabelScrollWidth).toBeGreaterThan(
            result.branchLabelWidth
          );
        if (
          ["-wide", "-at-breakpoint", "-above-breakpoint"].some((suffix) =>
            result.name.endsWith(suffix)
          )
        )
          expect(result.wrapped).toBe(false);
        if (result.name.endsWith("-below-breakpoint"))
          expect(result.wrapped).toBe(true);
      }
      for (const theme of ["light", "dark"]) {
        const cycle = results.filter((result) =>
          result.name.startsWith(theme + "-resize")
        );
        expect(cycle.at(-1)?.branchLabelWidth).toBe(cycle[0].branchLabelWidth);
        expect(cycle.at(-1)?.wrapped).toBe(cycle[0].wrapped);
        expect(
          Math.min(...cycle.map((result) => result.branchLabelWidth))
        ).toBeLessThan(cycle[0].branchLabelWidth);
      }
    },
    60000
  );
});
