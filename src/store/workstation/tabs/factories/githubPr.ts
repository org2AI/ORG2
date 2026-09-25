/**
 * GitHub Pull Request Detail Tab Factory
 *
 * Opens a github-pr-detail tab in the main pane when the user clicks a PR row
 * in Kanban (or elsewhere). Mirrors the github-issue-detail factory; the
 * renderer reuses the Source Control `PrDetailPanel`, so the PR opens as a
 * first-class My Station tab rather than in the Source Control sidebar.
 */
import type { GitHubPrDetailTabData } from "@src/types/githubDetail";
import { githubPullRequestTabKey } from "@src/util/git/githubPullRequestUrl";

import { defineTabFactory } from "../tabFactory";
import type { WorkStationTab } from "../types";

export type { GitHubPrDetailTabData } from "@src/types/githubDetail";

export function githubPrTabTitle(number: number, title: string): string {
  const label = title.trim();
  const prefix = `#${number}`;
  return label && label !== prefix ? `${prefix} ${label}` : prefix;
}

export const githubPrDetailTabFactory = defineTabFactory<GitHubPrDetailTabData>(
  {
    tabType: "github-pr-detail",
    idStrategy: {
      type: "keyed",
      prefix: "github-pr-detail",
      getKey: githubPullRequestTabKey,
    },
    getTitle: (data) => githubPrTabTitle(data.prNumber, data.prTitle),
    icon: "GitPullRequest",
  }
);

export function createGitHubPrDetailTab(
  data: GitHubPrDetailTabData
): WorkStationTab {
  return githubPrDetailTabFactory(data);
}
