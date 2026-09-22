import React, { memo, useCallback, useMemo } from "react";

import type { OpenPRItem } from "@src/api/tauri/github";
import AnyIcon from "@src/components/AnyIcon";
import PrHoverCard from "@src/components/PrHoverCard";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import { ReferenceDragGhost } from "@src/components/dnd/ReferenceDragGhost";
import { useReferencePillDrag } from "@src/components/dnd/useReferencePillDrag";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "@src/icons";
import type { TabDragPillPayload } from "@src/modules/WorkStation/shared/TabBar/tabDragTypes";
import { setPrDragStash } from "@src/util/dnd/dragSideChannel";
import {
  getPrStatusIconName,
  getPrStatusVariant,
} from "@src/util/git/pr/prStatus";

interface PrRowProps {
  pr: OpenPRItem;
  depth?: number;
  isSelected: boolean;
  onClick: (pr: OpenPRItem) => void;
}

export const PrRow: React.FC<PrRowProps> = memo(
  ({ pr, depth = 1, isSelected, onClick }) => {
    const statusKey = pr.draft ? "draft" : pr.state;
    const statusVariant = getPrStatusVariant(statusKey);

    const buildPrPayload = useCallback(
      () => ({
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.url,
        prStatus: statusKey,
        sourceBranch: pr.head_branch,
        targetBranch: pr.base_branch,
      }),
      [pr, statusKey]
    );

    const buildPrPillPayload = useCallback((): TabDragPillPayload => {
      const prPayload = buildPrPayload();
      return {
        path: `pr://${prPayload.prNumber}`,
        name: `#${prPayload.prNumber} ${prPayload.prTitle}`,
        iconType: "pr",
        isFolder: false,
        contextText: JSON.stringify(prPayload),
      };
    }, [buildPrPayload]);

    const stashPrDrag = useCallback(() => {
      setPrDragStash(buildPrPayload());
    }, [buildPrPayload]);

    const node: TreeRowNode = useMemo(() => {
      const iconName = getPrStatusIconName(statusKey);
      const PrIcon =
        iconName === "draft"
          ? GitPullRequestDraftIcon
          : iconName === "merge"
            ? GitMergeIcon
            : iconName === "closed"
              ? GitPullRequestClosedIcon
              : GitPullRequestIcon;
      return {
        id: String(pr.number),
        name: pr.title,
        path: pr.url,
        type: "file",
        icon: (
          <span className={statusVariant.dotClass.replace("bg-", "text-")}>
            <AnyIcon icon={PrIcon} size={14} strokeWidth={1.75} />
          </span>
        ),
      };
    }, [pr.number, pr.title, pr.url, statusKey, statusVariant.dotClass]);

    const { dragHandlers, dragState } = useReferencePillDrag<HTMLDivElement>({
      tabId: `pr-${pr.number}`,
      getPayload: buildPrPillPayload,
      onPointerDown: stashPrDrag,
    });

    return (
      <>
        {dragState && <ReferenceDragGhost dragState={dragState} />}
        <PrHoverCard pr={pr}>
          <TreeRowBase
            node={node}
            depth={depth}
            isSelected={isSelected}
            onClick={() => onClick(pr)}
            showIndentGuides={false}
            onMouseDown={stashPrDrag}
            {...dragHandlers}
          >
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <span className="min-w-[28px] text-right text-[11px] text-text-3 tabular-nums">
                #{pr.number}
              </span>
            </span>
          </TreeRowBase>
        </PrHoverCard>
      </>
    );
  }
);
PrRow.displayName = "PrRow";
