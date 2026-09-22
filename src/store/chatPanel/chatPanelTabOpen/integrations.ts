/**
 * Integration surface tab open atoms: Team Inbox, GitHub issue / PR details
 * and discussion channels.
 */
import { atom } from "jotai";

import { WORK_MANAGEMENT_SECTION } from "@src/store/workstation/workstationTabBarAtoms";
import type {
  GitHubIssueDetailTabData,
  GitHubPrDetailTabData,
} from "@src/types/githubDetail";

import {
  buildChannelTabKey,
  createChannelTab,
  createGitHubIssueTab,
  createGitHubPrTab,
} from "../chatPanelTabFactories";
import type { ChatPanelSelectedChannel } from "../chatPanelTabsModel";
import { openOrFocusChatPanelTab } from "./openOrFocus";
import { openWorkManagementChatPanelTabAtom } from "./workManagement";

/** Open Inbox in the shared Work list tab so it keeps the dataset selector. */
export const openTeamInboxInChatPanelTabAtom = atom(
  null,
  (_get, set, title: string = "Inbox") =>
    set(openWorkManagementChatPanelTabAtom, {
      section: WORK_MANAGEMENT_SECTION.INBOX,
      title,
    })
);
openTeamInboxInChatPanelTabAtom.debugLabel = "openTeamInboxInChatPanelTab";

/** Open or focus a GitHub issue detail tab inside the chat pane. */
export const openGitHubIssueInChatPanelTabAtom = atom(
  null,
  (get, set, issue: GitHubIssueDetailTabData) =>
    openOrFocusChatPanelTab(get, set, {
      isMatch: (tab) =>
        tab.type === "github-issue" &&
        tab.githubIssue?.repoPath === issue.repoPath &&
        tab.githubIssue.issueNumber === issue.issueNumber,
      refresh: (tab) => ({
        ...tab,
        title: `#${issue.issueNumber} ${issue.issueTitle}`,
        githubIssue: issue,
      }),
      create: () => createGitHubIssueTab(issue),
    })
);
openGitHubIssueInChatPanelTabAtom.debugLabel = "openGitHubIssueInChatPanelTab";

/** Open or focus a GitHub pull-request detail tab inside the chat pane. */
export const openGitHubPrInChatPanelTabAtom = atom(
  null,
  (get, set, pr: GitHubPrDetailTabData) =>
    openOrFocusChatPanelTab(get, set, {
      isMatch: (tab) =>
        tab.type === "github-pr" &&
        tab.githubPr?.repoPath === pr.repoPath &&
        tab.githubPr.prNumber === pr.prNumber,
      refresh: (tab) => ({
        ...tab,
        title: `#${pr.prNumber} ${pr.prTitle}`,
        githubPr: pr,
      }),
      create: () => createGitHubPrTab(pr),
    })
);
openGitHubPrInChatPanelTabAtom.debugLabel = "openGitHubPrInChatPanelTab";

/**
 * Open — or focus, if already open — a dedicated tab for a channel's message
 * surface. Deduped per composite key (`cloud:orgId:channelId` /
 * `local:channelId`, see `buildChannelTabKey`), the `openWorkItemInChatPanelTab`
 * shape: re-opening refreshes the stored payload (a rename, or a cloud
 * channel flipping visibility, would otherwise leave the pill stale) before
 * focusing instead of stacking a second pill.
 */
export const openChannelInChatPanelTabAtom = atom(
  null,
  (get, set, channel: ChatPanelSelectedChannel) => {
    const key = buildChannelTabKey(channel);
    return openOrFocusChatPanelTab(get, set, {
      isMatch: (tab) =>
        tab.type === "channel" &&
        tab.channel !== undefined &&
        buildChannelTabKey(tab.channel) === key,
      refresh: (tab) => ({ ...tab, title: channel.name, channel }),
      create: () => createChannelTab({ channel }),
    });
  }
);
openChannelInChatPanelTabAtom.debugLabel = "openChannelInChatPanelTab";
