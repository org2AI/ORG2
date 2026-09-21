import { useCallback } from "react";

import type { SessionFilterButtonProps } from "./sessionFilterTypes";
import type { SessionGroupVisibleCount } from "./types";

interface UseSessionFilterActionsOptions extends Pick<
  SessionFilterButtonProps,
  | "onSelect"
  | "onSelectGroupVisibleCount"
  | "onConfigureExternalSources"
  | "onCollapseAll"
  | "onMarkAllRead"
  | "onRefreshSessions"
  | "onExportSessionJson"
  | "onImportSessionJson"
> {
  close: () => void;
}

/** Setting selections stay open; terminal action rows close after running. */
export function useSessionFilterActions({
  onSelect,
  onSelectGroupVisibleCount,
  onConfigureExternalSources,
  onCollapseAll,
  onMarkAllRead,
  onRefreshSessions,
  onExportSessionJson,
  onImportSessionJson,
  close,
}: UseSessionFilterActionsOptions) {
  const handleSelect = useCallback(
    (mode: string) => {
      onSelect(mode);
    },
    [onSelect]
  );

  const handleGroupVisibleCountSelect = useCallback(
    (count: SessionGroupVisibleCount) => {
      onSelectGroupVisibleCount(count);
    },
    [onSelectGroupVisibleCount]
  );

  const handleConfigureExternalSources = useCallback(() => {
    onConfigureExternalSources?.();
    close();
  }, [onConfigureExternalSources, close]);

  const handleCollapseAll = useCallback(() => {
    onCollapseAll?.();
    close();
  }, [onCollapseAll, close]);

  const handleMarkAllRead = useCallback(() => {
    onMarkAllRead?.();
    close();
  }, [onMarkAllRead, close]);

  const handleRefreshSessions = useCallback(() => {
    onRefreshSessions?.();
    close();
  }, [onRefreshSessions, close]);

  const handleExportSessionJson = useCallback(() => {
    onExportSessionJson?.();
    close();
  }, [onExportSessionJson, close]);

  const handleImportSessionJson = useCallback(() => {
    onImportSessionJson?.();
    close();
  }, [onImportSessionJson, close]);

  return {
    handleSelect,
    handleGroupVisibleCountSelect,
    handleConfigureExternalSources,
    handleCollapseAll,
    handleMarkAllRead,
    handleRefreshSessions,
    handleExportSessionJson,
    handleImportSessionJson,
  };
}
