/**
 * useTeamInboxReadActions
 *
 * Read/unread transitions for Inbox rows, including the implicit "opening a
 * row marks it read" rule. Every failure surfaces through the shared load
 * state so the notice bar can report it.
 */
import { useCallback, useEffect, useRef } from "react";

import type { ManagedPrItem } from "@src/modules/MainApp/WorkManagement/githubManagedItemModel";

import type {
  LoadState,
  TeamInboxDataSource,
  TeamInboxFilter,
  TeamInboxItem,
  TeamInboxUnreadCounts,
} from "./domain";
import { getTeamInboxItemKey } from "./domain";
import { performTeamInboxReadTransition } from "./teamInboxReadTransitions";

export interface UseTeamInboxReadActionsOptions {
  dataSource: TeamInboxDataSource;
  t: (key: string) => string;
  setLoadState: (state: LoadState) => void;
  selectedItem: TeamInboxItem | null;
  selectedPullRequest: ManagedPrItem | null;
  visibleFilter: TeamInboxFilter;
  unreadCounts: TeamInboxUnreadCounts;
}

export function useTeamInboxReadActions({
  dataSource,
  t,
  setLoadState,
  selectedItem,
  selectedPullRequest,
  visibleFilter,
  unreadCounts,
}: UseTeamInboxReadActionsOptions) {
  const markItemRead = useCallback(
    (item: TeamInboxItem) => {
      if (item.readAt !== null) return;
      void performTeamInboxReadTransition("read", item, dataSource).then(
        (result) => {
          if (result.ok) {
            setLoadState({ status: "ready", message: null });
          } else {
            setLoadState({
              status: "error",
              message: t("teamInbox.errors.markRead"),
            });
          }
        }
      );
    },
    [dataSource, t, setLoadState]
  );

  // Opening a row is a selection transition, not a read-state invariant.
  // Refreshing its snapshot (including an explicit "mark unread") must not
  // issue another write. Keep only the current opening, scoped to the viewer.
  const openedSelection = useRef<string | null>(null);
  useEffect(() => {
    const selection =
      !selectedPullRequest && selectedItem
        ? JSON.stringify([
            dataSource.scopeKey,
            getTeamInboxItemKey(selectedItem),
          ])
        : null;
    if (openedSelection.current === selection) return;
    openedSelection.current = selection;
    if (selection !== null && selectedItem) markItemRead(selectedItem);
  }, [dataSource.scopeKey, markItemRead, selectedItem, selectedPullRequest]);

  const handleMarkRead = (item: TeamInboxItem) => {
    markItemRead(item);
  };

  const handleMarkUnread = (item: TeamInboxItem) => {
    if (item.readAt === null) return;
    void performTeamInboxReadTransition("unread", item, dataSource).then(
      (result) => {
        if (result.ok) {
          setLoadState({ status: "ready", message: null });
        } else {
          setLoadState({
            status: "error",
            message: t("teamInbox.errors.markUnread"),
          });
        }
      }
    );
  };

  const handleMarkAllRead = () => {
    const filterUnreadCount =
      visibleFilter === "all"
        ? unreadCounts.all
        : visibleFilter === "mentions"
          ? unreadCounts.mentions
          : unreadCounts.assigned;
    if (filterUnreadCount === 0) return;
    void dataSource
      .markAllRead?.([], visibleFilter)
      .then(() => {
        setLoadState({ status: "ready", message: null });
      })
      .catch(() => {
        setLoadState({
          status: "error",
          message: t("teamInbox.errors.markAllRead"),
        });
      });
  };

  return { handleMarkRead, handleMarkUnread, handleMarkAllRead };
}
