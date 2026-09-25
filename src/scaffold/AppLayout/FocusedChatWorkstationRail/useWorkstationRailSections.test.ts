// @vitest-environment jsdom
import type { TFunction } from "i18next";
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitPullRequestIcon } from "@src/icons";

import { WorkstationSections } from "./WorkstationSections";
import type { FocusedChatRailItem } from "./types";
import { useWorkstationRailSections } from "./useWorkstationRailSections";

vi.mock("@src/hooks/git/useWorkingTreeDiffTotals", () => ({
  useWorkingTreeDiffTotals: () => ({ additions: 0, deletions: 0 }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const translate = ((key: string) =>
  ({
    "common:labels.pullRequest": "Pull request",
    "navigation:labels.sessionEnvironment": "Session environment",
  })[key] ?? key) as TFunction;
const open = vi.fn();
const pr: FocusedChatRailItem = {
  key: "pull-request:2152",
  label: "feat(sources): categorized conversation resources",
  title: "#2152 feat(sources): categorized conversation resources · Open",
  icon: GitPullRequestIcon,
  onClick: open,
};

type Projection = ReturnType<typeof useWorkstationRailSections>;
let projection: Projection;
function Probe({
  items,
  cloud = false,
}: {
  items: FocusedChatRailItem[];
  cloud?: boolean;
}) {
  const result = useWorkstationRailSections({
    environmentLabel: "Session environment",
    openTabItems: [],
    primaryWorkspaceTitle: "ORGII",
    pullRequestItems: items,
    sessionContext: {
      repoName: "session-repo",
      environmentKind: cloud ? "cloud" : "local",
    },
    sessionItems: [],
    sourceCount: 0,
    sourceItems: [],
    subagentCount: 0,
    subagentItems: [],
    t: translate,
    workspaceSections: [{ key: "workspace", label: null, items: [] }],
  });
  useEffect(() => {
    projection = result;
  }, [result]);
  return null;
}

describe("pull request rail section", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    open.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it.each([false, true])(
    "puts PR first and retains repository/session headings (cloud=%s)",
    (cloud) => {
      act(() => root.render(createElement(Probe, { items: [pr], cloud })));
      expect(projection.compactSections[0].key).toBe("pull-request");
      expect(projection.wideHeaderSectionKey).toBe("pull-request");
      expect(projection.wideHeaderTitle).toBe("Pull request");
      expect(projection.wideSections[0].label).toBeNull();
      expect(
        projection.wideSections.find((section) => section.key === "workspace")
          ?.label
      ).toBe("ORGII");
      expect(
        projection.wideSections.find((section) => section.key === "session")
          ?.label
      ).toBe("Session environment");
      act(() => root.render(createElement(Probe, { items: [], cloud })));
      expect(
        projection.compactSections.some(
          (section) => section.key === "pull-request"
        )
      ).toBe(false);
      expect(projection.wideHeaderSectionKey).toBe(
        cloud ? "session" : "workspace"
      );
      expect(
        projection.wideSections.find(
          (section) => section.key === projection.wideHeaderSectionKey
        )?.label
      ).toBeNull();
    }
  );

  it("announces PR identity and separate CI status together", () => {
    const status = {
      state: "failure" as const,
      label: "Failed",
      title: "PR #2152 checks failed",
      iconOnly: true,
    };
    act(() =>
      root.render(
        createElement(WorkstationSections, {
          sections: [
            {
              key: "pull-request",
              label: "Pull request",
              items: [{ ...pr, status }],
            },
          ],
        })
      )
    );
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe(
      `${pr.title} · ${status.title}`
    );
    expect(button.textContent).not.toContain("Failed");

    // Existing rows without a descriptive title keep their content-based name.
    act(() =>
      root.render(
        createElement(WorkstationSections, {
          sections: [
            {
              key: "pull-request",
              label: "Pull request",
              items: [{ ...pr, title: undefined, status }],
            },
          ],
        })
      )
    );
    expect(host.querySelector("button")!.hasAttribute("aria-label")).toBe(
      false
    );
  });

  it.each([false, true])(
    "opens the PR and collapses only its group (compact=%s)",
    (compact) => {
      const toggle = vi.fn();
      const close = vi.fn();
      const sections = [
        { key: "pull-request", label: "Pull request", items: [pr] },
        { key: "workspace", label: "ORGII", items: [] },
      ];
      const render = (collapsedGroupKeys = new Set<string>()) =>
        act(() =>
          root.render(
            createElement(WorkstationSections, {
              sections,
              compact,
              collapsedGroupKeys,
              onToggleGroup: toggle,
              onRequestClose: close,
              collapseGroupLabel: "Collapse",
              expandGroupLabel: "Expand",
            })
          )
        );
      render();
      const heading = host.querySelector<HTMLButtonElement>(
        '[data-workstation-group-toggle="pull-request"]'
      )!;
      expect(heading.getAttribute("aria-expanded")).toBe("true");
      const row = host.querySelector<HTMLButtonElement>(
        `button[aria-label="${pr.title}"]`
      )!;
      expect(row.textContent).toContain(pr.label);
      act(() => row.click());
      expect(open).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      act(() => heading.click());
      expect(toggle).toHaveBeenCalledWith("pull-request");
      render(new Set(["pull-request"]));
      expect(host.textContent).not.toContain(pr.label);
      expect(host.textContent).toContain("ORGII");
    }
  );
});
