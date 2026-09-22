import React, { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_PANEL,
  MULTI_SELECT_PANEL_WIDTH,
} from "@src/components/Dropdown/tokens";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { WorkManagementRefreshButton } from "@src/features/GitHubWork/WorkManagementRefreshButton";
import { WorkManagementSearchInput } from "@src/features/GitHubWork/WorkManagementSearchInput";
import {
  HugeiconsIcon,
  NotificationOff01Icon,
  TickDouble01Icon,
} from "@src/icons";

import type {
  TeamInboxFilter,
  TeamInboxNotificationKind,
  TeamInboxUnreadCounts,
} from "../../domain";

const TEAM_INBOX_NOTIFICATION_KINDS: readonly TeamInboxNotificationKind[] = [
  "mention",
  "discussion_updated",
  "run_failed",
  "status_changed",
  "assignee_changed",
  "priority_changed",
  "dates_changed",
  "child_completed",
];

export interface TeamInboxListControlsProps {
  filter: TeamInboxFilter;
  unreadCounts: TeamInboxUnreadCounts;
  query: string;
  loading: boolean;
  placement: "header" | "list";
  /** A split-list header search grows before the action buttons. */
  fillSearch?: boolean;
  trailingActions?: ReactNode;
  onQueryChange: (query: string) => void;
  onRefresh?: () => void;
  onMarkAllRead?: () => void;
  mutedKinds?: readonly TeamInboxNotificationKind[];
  mutePreferencesLoading?: boolean;
  onLoadMutePreferences?: () => void;
  onSetKindMuted?: (kind: TeamInboxNotificationKind, muted: boolean) => void;
}

/** Shared Inbox controls used in the page header or compact left pane. */
export const TeamInboxListControls: React.FC<TeamInboxListControlsProps> = ({
  filter,
  unreadCounts,
  query,
  loading,
  placement,
  fillSearch = false,
  trailingActions,
  onQueryChange,
  onRefresh,
  onMarkAllRead,
  mutedKinds = [],
  mutePreferencesLoading = false,
  onLoadMutePreferences,
  onSetKindMuted,
}) => {
  const { t } = useTranslation();
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);
  const activeFilterUnread = filter === "archived" ? 0 : unreadCounts[filter];
  const muteOptions = useMemo(
    () =>
      TEAM_INBOX_NOTIFICATION_KINDS.map((kind) => ({
        value: kind,
        label: t(`teamInbox.events.${kind}`),
      })),
    [t]
  );

  return (
    <div
      className={`flex min-w-0 items-center gap-px ${
        placement === "list" || fillSearch ? "flex-1" : ""
      }`.trim()}
    >
      <WorkManagementSearchInput
        value={query}
        onChange={onQueryChange}
        placement={placement}
        fillWidth={fillSearch}
        placeholder={t("common:actions.search")}
        dataTestId="team-inbox-search"
      />
      {(activeFilterUnread > 0 && onMarkAllRead) ||
      onRefresh ||
      trailingActions ? (
        <div className="flex shrink-0 items-center gap-px">
          {activeFilterUnread > 0 && onMarkAllRead ? (
            <ToolbarTooltip label={t("inbox.markAllAsRead")}>
              <Button
                variant="tertiary"
                size="small"
                icon={
                  <HugeiconsIcon
                    icon={TickDouble01Icon}
                    data-icon="check-check"
                    size={14}
                    strokeWidth={2}
                  />
                }
                iconOnly
                className="shrink-0"
                aria-label={t("inbox.markAllAsRead")}
                data-testid="team-inbox-mark-all-read"
                onClick={onMarkAllRead}
              />
            </ToolbarTooltip>
          ) : null}
          {onRefresh ? (
            <WorkManagementRefreshButton
              label={t("common:actions.refresh")}
              loading={loading}
              onRefresh={onRefresh}
              dataTestId="team-inbox-refresh"
            />
          ) : null}
          {onLoadMutePreferences && onSetKindMuted ? (
            <Dropdown
              options={muteOptions}
              mode="multiple"
              showSearch
              style={{
                width: MULTI_SELECT_PANEL_WIDTH,
                maxWidth: `calc(100vw - ${DROPDOWN_PANEL.viewportPadding * 2}px)`,
              }}
              value={[...mutedKinds]}
              loading={mutePreferencesLoading}
              popupVisible={muteMenuOpen}
              position="bottom-end"
              getPopupContainer={() => document.body}
              avoidViewportOverflow
              onVisibleChange={(visible) => {
                setMuteMenuOpen(visible);
                if (visible) onLoadMutePreferences();
              }}
              onSelect={(nextValue) => {
                const nextKinds = new Set(
                  (Array.isArray(nextValue) ? nextValue : []).map(String)
                );
                const changedKind = TEAM_INBOX_NOTIFICATION_KINDS.find(
                  (kind) => nextKinds.has(kind) !== mutedKinds.includes(kind)
                );
                if (changedKind) {
                  onSetKindMuted(changedKind, nextKinds.has(changedKind));
                }
              }}
            >
              <Button
                variant="tertiary"
                size="small"
                icon={
                  <HugeiconsIcon
                    icon={NotificationOff01Icon}
                    data-icon="bell-off"
                    size={14}
                    strokeWidth={2}
                  />
                }
                iconOnly
                className="shrink-0"
                title={t("teamInbox.mute.title")}
                aria-label={t("teamInbox.mute.title")}
                data-testid="team-inbox-mute-categories"
              />
            </Dropdown>
          ) : null}
          {trailingActions}
        </div>
      ) : null}
    </div>
  );
};
