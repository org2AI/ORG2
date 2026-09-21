import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  LIST_PANEL_SECTIONS,
  ListPanelSkeletonRows,
} from "@src/components/ListPanel";
import { Placeholder } from "@src/components/Placeholder";
import { ListPanelScrollArea, LoadingBar } from "@src/components/layout/blocks";
import type { ManagedPrItem } from "@src/modules/MainApp/WorkManagement/githubManagedItemModel";
import CompactListHeader from "@src/scaffold/layouts/CompactListHeader";

import {
  type TeamInboxFilter,
  type TeamInboxItem,
  type TeamInboxNotificationKind,
  type TeamInboxUnreadCounts,
  getTeamInboxItemKey,
} from "../domain";
import { TeamInboxListControls } from "./TeamInboxList/TeamInboxListControls";
import { TeamInboxListSection } from "./TeamInboxList/TeamInboxListSection";
import { TeamInboxPullRequestRows } from "./TeamInboxList/TeamInboxPullRequestRows";
import { TeamInboxPullRequestsNotice } from "./TeamInboxList/TeamInboxPullRequestsNotice";
import {
  groupTeamInboxItems,
  groupTeamInboxPullRequests,
} from "./TeamInboxList/teamInboxListSections";
import { useTeamInboxListKeyboard } from "./TeamInboxList/useTeamInboxListKeyboard";
import TeamInboxRow from "./TeamInboxRow";

export {
  TeamInboxListControls,
  type TeamInboxListControlsProps,
} from "./TeamInboxList/TeamInboxListControls";

export interface TeamInboxListProps {
  filter: TeamInboxFilter;
  items: readonly TeamInboxItem[];
  selectedItemId: string | null;
  unreadCounts: TeamInboxUnreadCounts;
  query: string;
  loading: boolean;
  /** Notification-source loading, independent of GitHub requests. */
  inboxLoading?: boolean;
  pullRequests?: readonly ManagedPrItem[];
  pullRequestsLoading?: boolean;
  pullRequestsError?: string | null;
  selectedPullRequestKey?: string | null;
  onQueryChange: (query: string) => void;
  onSelectItem: (item: TeamInboxItem) => void;
  onSelectPullRequest?: (pullRequest: ManagedPrItem) => void;
  onRefresh?: () => void;
  onMarkAllRead?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** The shared split layout can own this row instead. */
  showControls?: boolean;
  mutedKinds?: readonly TeamInboxNotificationKind[];
  mutePreferencesLoading?: boolean;
  onLoadMutePreferences?: () => void;
  onSetKindMuted?: (kind: TeamInboxNotificationKind, muted: boolean) => void;
}

// Temporarily hidden until GitHub OAuth failures can name the affected
// repositories and offer a useful recovery path. Keep the warning UI in place
// so it can be restored without rebuilding its shared styling and behavior.
const PULL_REQUEST_LOAD_WARNING_ENABLED = false;

const TeamInboxList: React.FC<TeamInboxListProps> = ({
  filter,
  items,
  selectedItemId,
  unreadCounts,
  query,
  loading,
  pullRequests = [],
  pullRequestsLoading = false,
  pullRequestsError = null,
  selectedPullRequestKey = null,
  onQueryChange,
  onSelectItem,
  onSelectPullRequest,
  onRefresh,
  onMarkAllRead,
  inboxLoading = loading,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  showControls = true,
  mutedKinds = [],
  mutePreferencesLoading = false,
  onLoadMutePreferences,
  onSetKindMuted,
}) => {
  const { t } = useTranslation();
  const hasQuery = query.trim().length > 0;
  const [pullRequestsErrorUi, setPullRequestsErrorUi] = useState(() => ({
    error: pullRequestsError,
    dismissed: false,
    detailed: false,
  }));
  if (pullRequestsErrorUi.error !== pullRequestsError) {
    setPullRequestsErrorUi({
      error: pullRequestsError,
      dismissed: false,
      detailed: false,
    });
  }
  const inboxItemSections = useMemo(() => groupTeamInboxItems(items), [items]);
  const orderedInboxItems = useMemo(
    () =>
      filter === "all"
        ? [
            ...inboxItemSections.mentions,
            ...inboxItemSections.assigned,
            ...inboxItemSections.updates,
          ]
        : items,
    [filter, inboxItemSections, items]
  );
  const selectedIndex = useMemo(
    () =>
      orderedInboxItems.findIndex(
        (item) => getTeamInboxItemKey(item) === selectedItemId
      ),
    [orderedInboxItems, selectedItemId]
  );
  const visiblePullRequests = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return pullRequests;
    return pullRequests.filter((pullRequest) =>
      [
        pullRequest.title,
        pullRequest.repo,
        pullRequest.author,
        pullRequest.sourceBranch,
        pullRequest.targetBranch,
        `#${pullRequest.id}`,
        `pr #${pullRequest.id}`,
      ].some((part) => part.toLowerCase().includes(normalizedQuery))
    );
  }, [pullRequests, query]);
  const pullRequestSections = useMemo(
    () => groupTeamInboxPullRequests(visiblePullRequests),
    [visiblePullRequests]
  );
  const showPullRequests = filter === "all";
  const actionablePullRequestCount = showPullRequests
    ? pullRequestSections.reviewRequested.length +
      pullRequestSections.authoredByViewer.length
    : 0;
  const hasPullRequestSurface =
    showPullRequests &&
    (actionablePullRequestCount > 0 ||
      pullRequestsLoading ||
      Boolean(pullRequestsError));
  const showPullRequestsError =
    showPullRequests &&
    Boolean(pullRequestsError) &&
    !pullRequestsErrorUi.dismissed;
  const showPullRequestsErrorDetails =
    Boolean(pullRequestsError) && pullRequestsErrorUi.detailed;
  const showLoadingBar = loading || pullRequestsLoading || loadingMore;
  const showInboxSkeletons = inboxLoading && items.length === 0;
  const showPrSkeletons =
    showPullRequests && pullRequestsLoading && actionablePullRequestCount === 0;
  const showSkeletonRows = showInboxSkeletons || showPrSkeletons;
  const renderSkeletonSection = (key: string, title: string) => (
    <TeamInboxListSection
      key={key}
      title={title}
      testId={`team-inbox-${key}-loading`}
    >
      <ListPanelSkeletonRows count={2} />
    </TeamInboxListSection>
  );
  const loadMoreAction =
    hasMore && onLoadMore ? (
      <div className="flex shrink-0 justify-center px-3 pt-1 pb-2">
        <Button
          variant="tertiary"
          size="small"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {t("teamInbox.loadMore")}
        </Button>
      </div>
    ) : null;
  const { rowRefs, handleListKeyDown } = useTeamInboxListKeyboard({
    orderedInboxItems,
    selectedIndex,
    onSelectItem,
  });
  const renderInboxRows = (
    rowItems: readonly TeamInboxItem[],
    label: string,
    sectioned = false
  ) => (
    <div
      className={sectioned ? undefined : LIST_PANEL_SECTIONS.sectionGroupItems}
      role="listbox"
      aria-label={label}
      onKeyDown={handleListKeyDown}
    >
      {rowItems.map((item) => {
        const key = getTeamInboxItemKey(item);
        return (
          <TeamInboxRow
            key={key}
            ref={(node) => {
              if (node) rowRefs.current.set(key, node);
              else rowRefs.current.delete(key);
            }}
            item={item}
            itemKey={key}
            selected={key === selectedItemId}
            onSelect={onSelectItem}
          />
        );
      })}
    </div>
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("teamInbox.listLabel")}
    >
      {showControls ? (
        <CompactListHeader>
          <TeamInboxListControls
            filter={filter}
            unreadCounts={unreadCounts}
            query={query}
            loading={showLoadingBar}
            placement="list"
            onQueryChange={onQueryChange}
            onRefresh={onRefresh}
            onMarkAllRead={onMarkAllRead}
            mutedKinds={mutedKinds}
            mutePreferencesLoading={mutePreferencesLoading}
            onLoadMutePreferences={onLoadMutePreferences}
            onSetKindMuted={onSetKindMuted}
          />
        </CompactListHeader>
      ) : null}
      {showLoadingBar ? <LoadingBar /> : null}

      {items.length === 0 && !hasPullRequestSurface && !showSkeletonRows ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {hasQuery ? (
            <Placeholder
              variant="no-results"
              placement="sidebar"
              title={t("teamInbox.empty.noResults.title")}
              subtitle={t("teamInbox.empty.noResults.subtitle", {
                query: query.trim(),
              })}
              fillParentHeight
            />
          ) : (
            <Placeholder
              variant="empty"
              placement="sidebar"
              title={t(`teamInbox.empty.${filter}.title`, {
                defaultValue: t("teamInbox.empty.title"),
              })}
              subtitle={t(`teamInbox.empty.${filter}.subtitle`, {
                defaultValue: t("teamInbox.empty.subtitle"),
              })}
              fillParentHeight
            />
          )}
          {loadMoreAction}
        </div>
      ) : (
        <ListPanelScrollArea listPaddingTop="none">
          <div className="flex flex-col" data-testid="team-inbox-sections">
            {PULL_REQUEST_LOAD_WARNING_ENABLED &&
            showPullRequestsError &&
            pullRequestsError ? (
              <TeamInboxPullRequestsNotice
                error={pullRequestsError}
                detailed={showPullRequestsErrorDetails}
                onToggleDetails={() =>
                  setPullRequestsErrorUi((current) => ({
                    ...current,
                    detailed: !current.detailed,
                  }))
                }
                onDismiss={() =>
                  setPullRequestsErrorUi((current) => ({
                    ...current,
                    dismissed: true,
                    detailed: false,
                  }))
                }
              />
            ) : null}
            {showPrSkeletons ? (
              <>
                {renderSkeletonSection(
                  "pr-review-requested",
                  t("teamInbox.sections.reviewRequested")
                )}
                {renderSkeletonSection(
                  "pr-authored",
                  t("teamInbox.sections.authoredByMe")
                )}
              </>
            ) : null}
            {showPullRequests &&
            pullRequestSections.reviewRequested.length > 0 ? (
              <TeamInboxListSection
                title={t("teamInbox.sections.reviewRequested")}
                testId="team-inbox-pr-review-requested"
              >
                <TeamInboxPullRequestRows
                  pullRequests={pullRequestSections.reviewRequested}
                  selectedPullRequestKey={selectedPullRequestKey}
                  onSelectPullRequest={onSelectPullRequest}
                />
              </TeamInboxListSection>
            ) : null}
            {showPullRequests &&
            pullRequestSections.authoredByViewer.length > 0 ? (
              <TeamInboxListSection
                title={t("teamInbox.sections.authoredByMe")}
                testId="team-inbox-pr-authored"
              >
                <TeamInboxPullRequestRows
                  pullRequests={pullRequestSections.authoredByViewer}
                  selectedPullRequestKey={selectedPullRequestKey}
                  onSelectPullRequest={onSelectPullRequest}
                />
              </TeamInboxListSection>
            ) : null}
            {filter === "all" ? (
              <>
                {inboxItemSections.mentions.length > 0 ? (
                  <TeamInboxListSection
                    title={t("teamInbox.filters.mentions")}
                    testId="team-inbox-mentions"
                  >
                    {renderInboxRows(
                      inboxItemSections.mentions,
                      t("teamInbox.filters.mentions"),
                      true
                    )}
                  </TeamInboxListSection>
                ) : null}
                {inboxItemSections.assigned.length > 0 ? (
                  <TeamInboxListSection
                    title={t("teamInbox.filters.assigned")}
                    testId="team-inbox-assigned"
                  >
                    {renderInboxRows(
                      inboxItemSections.assigned,
                      t("teamInbox.filters.assigned"),
                      true
                    )}
                  </TeamInboxListSection>
                ) : null}
                {inboxItemSections.updates.length > 0 ? (
                  <TeamInboxListSection
                    title={t("teamInbox.sections.updates")}
                    testId="team-inbox-updates"
                  >
                    {renderInboxRows(
                      inboxItemSections.updates,
                      t("teamInbox.sections.updates"),
                      true
                    )}
                  </TeamInboxListSection>
                ) : null}
              </>
            ) : items.length > 0 ? (
              renderInboxRows(items, t("teamInbox.itemsLabel"))
            ) : null}
            {showInboxSkeletons ? (
              filter === "all" ? (
                <>
                  {renderSkeletonSection(
                    "mentions",
                    t("teamInbox.filters.mentions")
                  )}
                  {renderSkeletonSection(
                    "assigned",
                    t("teamInbox.filters.assigned")
                  )}
                  {renderSkeletonSection(
                    "updates",
                    t("teamInbox.sections.updates")
                  )}
                </>
              ) : (
                renderSkeletonSection(filter, t(`teamInbox.filters.${filter}`))
              )
            ) : null}
          </div>
          {loadMoreAction}
        </ListPanelScrollArea>
      )}
    </section>
  );
};

export default TeamInboxList;
