import { useMemo } from "react";

import { usePendingPlanApproval } from "@src/hooks/session/usePendingPlanApproval";
import { getCompactPathLabel } from "@src/util/file/pathUtils";
import { formatRepoPathForDisplay } from "@src/util/file/repoPathDisplay";

import { buildCompactFilesReloadKey } from "../../InputArea/components/compactFileChangesHelpers";
import { useCompactFileData } from "../../InputArea/components/useCompactFileData";
import type { PlanMentionSourceItem } from "./inputAreaEventSelectors";
import type { CustomMentionOption } from "./types";
import type { useInputAreaSessionState } from "./useInputAreaSessionState";

function buildPlanMentionOptions(
  planSources: ReadonlyArray<PlanMentionSourceItem>,
  pendingPlan: { planPath: string; planTitle: string } | null | undefined
): CustomMentionOption[] {
  const options: CustomMentionOption[] = [];
  const seenPaths = new Set<string>();

  if (pendingPlan?.planPath) {
    seenPaths.add(pendingPlan.planPath);
    options.push({
      id: `plan-file:${pendingPlan.planPath}`,
      label: pendingPlan.planTitle || getCompactPathLabel(pendingPlan.planPath),
      description: pendingPlan.planPath,
      groupLabel: "Plan",
      selectType: "files",
      selectValue: pendingPlan.planPath,
      selectDisplayName: getCompactPathLabel(pendingPlan.planPath),
    });
  }

  for (const source of planSources) {
    const planPath = source.planPath;
    if (!planPath || seenPaths.has(planPath)) continue;

    seenPaths.add(planPath);
    const title = source.title;
    options.push({
      id: `plan-file:${planPath}`,
      label: title || getCompactPathLabel(planPath),
      description: planPath,
      groupLabel: "Plan",
      selectType: "files",
      selectValue: planPath,
      selectDisplayName: getCompactPathLabel(planPath),
    });

    if (options.length >= 4) break;
  }

  return options;
}

interface UseInputAreaMentionSourcesOptions {
  activeSessionId: string | undefined;
  chatRoundCount: number;
  isWpGeneWorking: boolean;
  currentRepoPath: ReturnType<
    typeof useInputAreaSessionState
  >["currentRepoPath"];
  planMentionSource: ReadonlyArray<PlanMentionSourceItem>;
  customMentionOptions: ReadonlyArray<CustomMentionOption> | undefined;
}

export function useInputAreaMentionSources({
  activeSessionId,
  chatRoundCount,
  isWpGeneWorking,
  currentRepoPath,
  planMentionSource,
  customMentionOptions,
}: UseInputAreaMentionSourcesOptions) {
  const sessionFileReloadKey = buildCompactFilesReloadKey(
    activeSessionId ?? null,
    chatRoundCount,
    isWpGeneWorking
  );
  const { allFiles: sessionFiles } = useCompactFileData({
    sessionId: activeSessionId ?? null,
    reloadKey: sessionFileReloadKey,
  });

  const pendingPlan = usePendingPlanApproval(activeSessionId);
  const sessionFileMentionOptions = useMemo<ReadonlyArray<CustomMentionOption>>(
    () =>
      sessionFiles.slice(0, 12).map((file) => {
        const displayPath = formatRepoPathForDisplay({
          path: file.path,
          repoPath: currentRepoPath,
        }).displayPath;
        const label = getCompactPathLabel(displayPath || file.path);
        return {
          id: `session-file:${file.path}`,
          label,
          description: `${file.status === "D" ? "Deleted" : "Modified"} · ${displayPath || file.path}`,
          groupLabel: "Diff",
          selectType: "files",
          selectValue: file.path,
          selectDisplayName: file.fileName,
        };
      }),
    [currentRepoPath, sessionFiles]
  );
  const planMentionOptions = useMemo<ReadonlyArray<CustomMentionOption>>(
    () => buildPlanMentionOptions(planMentionSource, pendingPlan),
    [pendingPlan, planMentionSource]
  );
  const mergedCustomMentionOptions = useMemo(
    () => [
      ...sessionFileMentionOptions,
      ...planMentionOptions,
      ...(customMentionOptions ?? []),
    ],
    [customMentionOptions, planMentionOptions, sessionFileMentionOptions]
  );

  return mergedCustomMentionOptions;
}
