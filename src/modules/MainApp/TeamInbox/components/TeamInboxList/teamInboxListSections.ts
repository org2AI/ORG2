import type { ManagedPrItem } from "@src/modules/MainApp/WorkManagement/githubManagedItemModel";

import type { TeamInboxItem } from "../../domain";

export interface TeamInboxPullRequestSections {
  reviewRequested: ManagedPrItem[];
  authoredByViewer: ManagedPrItem[];
}

export interface TeamInboxItemSections {
  mentions: TeamInboxItem[];
  assigned: TeamInboxItem[];
  updates: TeamInboxItem[];
}

export function groupTeamInboxPullRequests(
  pullRequests: readonly ManagedPrItem[]
): TeamInboxPullRequestSections {
  return pullRequests.reduce<TeamInboxPullRequestSections>(
    (sections, pullRequest) => {
      if (pullRequest.state !== "open") return sections;
      if (pullRequest.reviewRequestedFromViewer) {
        sections.reviewRequested.push(pullRequest);
      } else if (pullRequest.authoredByViewer) {
        sections.authoredByViewer.push(pullRequest);
      }
      return sections;
    },
    { reviewRequested: [], authoredByViewer: [] }
  );
}

export function groupTeamInboxItems(
  items: readonly TeamInboxItem[]
): TeamInboxItemSections {
  return items.reduce<TeamInboxItemSections>(
    (sections, item) => {
      if (item.kind === "comment_mention") sections.mentions.push(item);
      else if (item.kind === "assigned_work_item") sections.assigned.push(item);
      else sections.updates.push(item);
      return sections;
    },
    { mentions: [], assigned: [], updates: [] }
  );
}
