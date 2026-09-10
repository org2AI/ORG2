import {
  type OrgtrackFileTimeline,
  getOrgtrackFileTimeline,
} from "@src/api/tauri/lineage";
import { useAsyncData } from "@src/hooks/async/useAsyncData";

export interface UseOrgtrackFileTimelineOptions {
  repoPath: string;
  filePath: string | null;
  autoLoad?: boolean;
}

export interface UseOrgtrackFileTimelineResult {
  timeline: OrgtrackFileTimeline | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useOrgtrackFileTimeline({
  repoPath,
  filePath,
  autoLoad = true,
}: UseOrgtrackFileTimelineOptions): UseOrgtrackFileTimelineResult {
  const {
    data: timeline,
    loading,
    error,
    refresh,
  } = useAsyncData<OrgtrackFileTimeline | null, string>({
    key: `${repoPath}\u0000${filePath ?? ""}`,
    enabled: autoLoad && Boolean(repoPath) && Boolean(filePath),
    initialData: null,
    query: () =>
      filePath
        ? getOrgtrackFileTimeline({ repoPath, filePath })
        : Promise.resolve(null),
  });

  return { timeline, loading, error, refresh };
}
