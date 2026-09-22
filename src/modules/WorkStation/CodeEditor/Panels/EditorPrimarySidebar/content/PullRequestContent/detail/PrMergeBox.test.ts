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

import type {
  GitHubChecksSummary,
  GitHubDeploymentsSummary,
} from "@src/api/tauri/github";
import { useTestTranslation } from "@src/test/i18nTestTranslate";

import { PrMergeBox, type PrMergeBoxProps } from "./PrMergeBox";
import { PrChecksRefreshContext } from "./prChecksRefreshContext";

vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));

vi.mock("@src/util/time/formatRelativeTime", () => ({
  formatRelativeTime: () => "2 minutes ago",
}));

const openLink = vi.fn();
vi.mock("@src/util/ui/openLink", () => ({
  openLink: (url: string, options?: unknown) => openLink(url, options),
}));

type CheckRun = GitHubChecksSummary["check_runs"][number];

function checkRun(
  name: string,
  status: string,
  conclusion: string | null,
  outputTitle: string | null = null
): CheckRun {
  return {
    id: name.length * 17 + name.charCodeAt(0),
    name,
    status,
    conclusion,
    started_at: "2026-09-01T10:00:00Z",
    completed_at: conclusion ? "2026-09-01T10:02:30Z" : null,
    details_url: `https://github.com/org/repo/runs/${name}`,
    output_title: outputTitle,
    app_name: "CI",
  };
}

function checksOf(runs: CheckRun[]): GitHubChecksSummary {
  return { sha: "head", check_runs: runs, statuses: [], state: "pending" };
}

const NOT_DEPLOYED: GitHubDeploymentsSummary = {
  git_ref: "feat/box",
  repo_has_deployments: true,
  deployments: [],
};

const OPEN_CLEAN = { state: "open", mergeable: true, mergeable_state: "clean" };

describe("PrMergeBox", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    openLink.mockClear();
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

  function render(props: Partial<PrMergeBoxProps>): void {
    act(() => {
      root.render(
        createElement(PrMergeBox, {
          detail: OPEN_CLEAN,
          fallbackStatus: "open",
          checks: null,
          deployments: null,
          reviews: [],
          actions: createElement("button", { "data-testid": "merge" }, "Merge"),
          ...props,
        })
      );
    });
  }

  const find = (testId: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  it("stacks GitHub's sections: deployments, running checks, conflicts, merge", () => {
    render({
      deployments: NOT_DEPLOYED,
      checks: checksOf([
        checkRun("lint", "in_progress", null, "This check has started..."),
        checkRun("test", "in_progress", null),
      ]),
    });

    expect(find("pr-merge-box-deployments")?.textContent).toContain(
      "This branch has not been deployedNo deployments"
    );
    const checks = find("pr-merge-box-checks");
    expect(checks?.textContent).toContain("Some checks haven't completed yet");
    expect(checks?.textContent).toContain("2 in progress checks");
    const rows = container.querySelectorAll(
      '[data-testid="pr-merge-box-check"]'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe(
      "CI / lintStarted 2 minutes ago — This check has started..."
    );
    expect(find("pr-merge-box-noConflicts")?.textContent).toBe(
      "No conflicts with the base branchMerging can be performed automatically"
    );
    expect(find("merge")).not.toBeNull();
  });

  it("omits the deployments card for a repository that never deploys", () => {
    render({
      deployments: { ...NOT_DEPLOYED, repo_has_deployments: false },
    });
    expect(find("pr-merge-box-deployments")).toBeNull();
    expect(find("pr-merge-box-status")).not.toBeNull();
  });

  it("keeps a green check list folded until asked, and unfolds a red one", () => {
    render({ checks: checksOf([checkRun("lint", "completed", "success")]) });
    expect(find("pr-merge-box-checks")?.textContent).toContain(
      "All checks have passed1 successful check"
    );
    expect(find("pr-merge-box-check-list")).toBeNull();

    act(() => find("pr-merge-box-checks-toggle")?.click());
    expect(find("pr-merge-box-check")?.textContent).toBe(
      "CI / lintSuccessful in 2m 30s"
    );

    render({
      checks: checksOf([
        checkRun("lint", "completed", "success"),
        checkRun("test", "completed", "failure"),
      ]),
    });
    expect(find("pr-merge-box-checks")?.textContent).toContain(
      "Some checks were not successful1 failing, 1 successful checks"
    );
  });

  it("opens a check's details and a deployment's environment externally", () => {
    render({
      checks: checksOf([checkRun("test", "completed", "failure")]),
      deployments: {
        ...NOT_DEPLOYED,
        deployments: [
          {
            id: 9,
            environment: "preview",
            state: "success",
            description: null,
            environment_url: "https://preview.example.com",
            log_url: null,
            created_at: null,
            updated_at: null,
          },
        ],
      },
    });

    expect(find("pr-merge-box-deployments")?.textContent).toContain(
      "This branch was successfully deployed1 active deployment"
    );
    act(() =>
      find("pr-merge-box-deployment")?.querySelector("button")?.click()
    );
    act(() => find("pr-merge-box-check")?.querySelector("button")?.click());
    expect(openLink.mock.calls.map(([url]) => url)).toEqual([
      "https://preview.example.com",
      "https://github.com/org/repo/runs/test",
    ]);
  });

  it("offers a CI re-poll on the checks section that does not fold the list", async () => {
    const refreshChecks = vi.fn(() => Promise.resolve());
    act(() => {
      root.render(
        createElement(
          PrChecksRefreshContext.Provider,
          { value: { refreshChecks, refreshing: false } },
          createElement(PrMergeBox, {
            detail: OPEN_CLEAN,
            fallbackStatus: "open",
            checks: checksOf([checkRun("test", "in_progress", null)]),
            deployments: null,
            reviews: [],
            actions: null,
          })
        )
      );
    });
    const refresh = find("pr-merge-box-checks-refresh");
    // A sibling of the toggle, never nested inside it.
    expect(find("pr-merge-box-checks-toggle")?.contains(refresh)).toBe(false);

    await act(async () => {
      refresh?.click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
    });
    expect(refreshChecks).toHaveBeenCalledTimes(1);
    expect(find("pr-merge-box-check-list")).not.toBeNull();
  });

  it("shows a conflict as its own section above the merge control", () => {
    render({
      detail: { state: "open", mergeable: false, mergeable_state: "dirty" },
    });
    expect(find("pr-merge-box-hasConflicts")?.textContent).toContain(
      "This branch has conflicts that must be resolved"
    );
    expect(find("merge")).not.toBeNull();
  });

  it("replaces conditions and the merge control once merged", () => {
    render({
      detail: { state: "closed", merged: true },
      fallbackStatus: "merged",
      checks: checksOf([checkRun("lint", "completed", "success")]),
    });
    expect(find("pr-merge-box-closed")?.textContent).toContain(
      "Pull request successfully merged and closed"
    );
    expect(find("pr-merge-box-checks")).toBeNull();
    expect(find("merge")).toBeNull();
  });
});
