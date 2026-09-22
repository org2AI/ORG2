import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import SourceControlMainPane from "../SourceControlMainPane";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/features/GitHubWork/useGitHubIssueDetailState", () => ({
  useGitHubIssueDetailState: () => ({ selectedState: { issue: null } }),
}));
vi.mock("../useSourceControlIssueDetailTab", () => ({
  useSourceControlIssueDetailTab: () => ["overview", vi.fn()],
}));
vi.mock("@src/store/workstation/codeEditor/workstationPrAtom", () => ({
  workstationRepoScopeKey: () => "repo",
}));

it.each([
  ["stashed", "selectSidebarStash"],
  ["history", "selectSidebarCommit"],
  ["pr", "selectSidebarPullRequest"],
  ["issues", "selectSidebarIssue"],
])("matches the %s sidebar when nothing is selected", (mode, message) => {
  const markup = renderToStaticMarkup(
    createElement(SourceControlMainPane, {
      tabData: { mode: "focus", focusPath: null, historySelection: null },
      repoPath: "/repo",
      repoId: "repo",
      gitFilesByPath: new Map(),
      sourceControlFiles: [],
      sourceControlFilterMode: mode,
      activeRepoRoot: "/repo",
      gitDiffLoading: false,
      sourceControlQuickActions: [],
    })
  );
  expect(markup).toContain(`placeholders.${message}`);
  expect(markup).not.toContain("selectSidebarFileToViewChanges");
  expect(markup).toContain("<svg");
  expect(markup).toContain('width="72"');
  expect(markup).toContain("h-full");
});
