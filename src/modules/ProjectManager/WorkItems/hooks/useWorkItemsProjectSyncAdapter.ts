import { useEffect, useState } from "react";

import { projectSyncApi } from "@src/api/http/project/sync";

/**
 * Resolves the story-sync adapter bound to the current project slug.
 * Returns `undefined` until the status for the resolved slug is known.
 */
export function useWorkItemsProjectSyncAdapter(
  resolvedProjectSlug: string | null
) {
  const [projectSyncAdapter, setProjectSyncAdapter] = useState<{
    projectSlug: string;
    adapterId: string | null;
  } | null>(null);

  const projectSyncAdapterId =
    projectSyncAdapter && projectSyncAdapter.projectSlug === resolvedProjectSlug
      ? projectSyncAdapter.adapterId
      : undefined;

  useEffect(() => {
    if (!resolvedProjectSlug) return;

    let cancelled = false;
    void projectSyncApi
      .status(resolvedProjectSlug)
      .then((status) => {
        if (!cancelled) {
          setProjectSyncAdapter({
            projectSlug: resolvedProjectSlug,
            adapterId: status.adapter_id,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectSyncAdapter({
            projectSlug: resolvedProjectSlug,
            adapterId: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedProjectSlug]);

  return projectSyncAdapterId;
}
