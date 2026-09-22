import { useCallback, useEffect, useState } from "react";

import {
  resolveImagePathsForDisplay,
  unresolveImagePathsForStorage,
} from "@src/modules/ProjectManager/shared/utils/workItemImagePaths";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

interface UseWorkItemDescriptionStateOptions {
  workItem: WorkItemExtended;
  onUpdateWorkItem?: (updates: Partial<WorkItemExtended>) => void;
  projectSlug?: string | null;
}

/**
 * Work Item description source: the stored markdown, its display copy with
 * image paths resolved for the project, and the change handler that stores
 * edits back with unresolved image paths.
 */
export function useWorkItemDescriptionState({
  workItem,
  onUpdateWorkItem,
  projectSlug,
}: UseWorkItemDescriptionStateOptions) {
  const rawDescription =
    workItem.spec || workItem.session_metadata?.file_change_summary || "";
  const [resolvedDescriptionState, setResolvedDescriptionState] = useState<{
    source: string;
    value: string;
  } | null>(null);
  const resolvedDescription =
    resolvedDescriptionState?.source === rawDescription
      ? resolvedDescriptionState.value
      : null;

  useEffect(() => {
    let cancelled = false;
    if (projectSlug && rawDescription) {
      resolveImagePathsForDisplay(rawDescription, projectSlug)
        .then((resolved) => {
          if (!cancelled) {
            setResolvedDescriptionState({
              source: rawDescription,
              value: resolved,
            });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResolvedDescriptionState({
              source: rawDescription,
              value: rawDescription,
            });
          }
        });
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to resolve without a project slug or description, so the display copy is settled synchronously
      setResolvedDescriptionState({
        source: rawDescription,
        value: rawDescription,
      });
    }
    return () => {
      cancelled = true;
    };
  }, [rawDescription, projectSlug]);

  const handleDescriptionChange = useCallback(
    (markdown: string) => {
      const storable = unresolveImagePathsForStorage(markdown.trim());
      const current =
        workItem.spec || workItem.session_metadata?.file_change_summary || "";
      if (storable === current) return;
      onUpdateWorkItem?.({ spec: storable });
    },
    [
      onUpdateWorkItem,
      workItem.spec,
      workItem.session_metadata?.file_change_summary,
    ]
  );

  return { rawDescription, resolvedDescription, handleDescriptionChange };
}
