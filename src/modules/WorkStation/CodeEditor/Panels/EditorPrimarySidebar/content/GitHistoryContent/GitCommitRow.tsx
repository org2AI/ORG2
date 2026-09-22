import React, { memo, useCallback } from "react";

import type { GitCommitInfo, GitCommitPerson } from "@src/api/http/git/types";
import { SidebarRow } from "@src/components/SidebarRow";
import { SIDEBAR_ROW_GAP } from "@src/components/TreeRow/config";
import { useImmediateCursorReset } from "@src/hooks/ui/useImmediateCursorReset";
import { formatCompactAge } from "@src/util/time/formatRelativeTime";

import type { CommitGraphNode } from "./graphLayout";
import { DOT_RADIUS, LANE_WIDTH } from "./graphLayout";

export const GIT_COMMIT_ROW_HEIGHT = 36;
export const GIT_COMMIT_ROW_PITCH = GIT_COMMIT_ROW_HEIGHT + SIDEBAR_ROW_GAP;

interface GraphSvgProps {
  graphNode: CommitGraphNode;
  svgWidth: number;
  isFirst: boolean;
}

const GraphSvg: React.FC<GraphSvgProps> = memo(
  ({ graphNode, svgWidth, isFirst }) => {
    const centerY = GIT_COMMIT_ROW_HEIGHT / 2;
    const dotX = graphNode.lane * LANE_WIDTH + LANE_WIDTH / 2;

    return (
      <svg
        width={svgWidth}
        height={GIT_COMMIT_ROW_PITCH}
        className="shrink-0 self-start"
      >
        {graphNode.lines.map((line, lineIndex) => {
          const fromX = line.fromLane * LANE_WIDTH + LANE_WIDTH / 2;
          const toX = line.toLane * LANE_WIDTH + LANE_WIDTH / 2;

          if (
            isFirst &&
            line.segment === "top" &&
            line.fromLane === graphNode.lane &&
            line.toLane === graphNode.lane
          ) {
            return null;
          }

          if (line.segment === "top") {
            return (
              <line
                key={`line-${lineIndex}`}
                x1={fromX}
                y1={0}
                x2={toX}
                y2={centerY}
                stroke={line.color}
                strokeWidth={1.5}
              />
            );
          }
          return (
            <line
              key={`line-${lineIndex}`}
              x1={fromX}
              y1={centerY}
              x2={toX}
              y2={GIT_COMMIT_ROW_PITCH}
              stroke={line.color}
              strokeWidth={1.5}
            />
          );
        })}
        <circle cx={dotX} cy={centerY} r={DOT_RADIUS} fill={graphNode.color} />
      </svg>
    );
  }
);

GraphSvg.displayName = "GitCommitRow.GraphSvg";

type GitCommitRowBaseCommit = Pick<
  GitCommitInfo,
  "sha" | "short_sha" | "summary"
> & {
  author?: GitCommitPerson | null;
};

export interface GitCommitRowProps<TCommit extends GitCommitRowBaseCommit> {
  commit: TCommit;
  isSelected: boolean;
  graphNode?: CommitGraphNode;
  svgWidth?: number;
  isFirst?: boolean;
  onSelect: (commit: TCommit) => void;
  onContextMenu?: (event: React.MouseEvent, commit: TCommit) => void;
  showGraphPlaceholder?: boolean;
}

function GitCommitRowComponent<TCommit extends GitCommitRowBaseCommit>({
  commit,
  isSelected,
  graphNode,
  svgWidth,
  isFirst = false,
  onSelect,
  onContextMenu,
  showGraphPlaceholder = false,
}: GitCommitRowProps<TCommit>) {
  const { cursorReset, markClicked, resetCursor } =
    useImmediateCursorReset(isSelected);

  const handleClick = useCallback(() => {
    markClicked();
    onSelect(commit);
  }, [commit, markClicked, onSelect]);

  const authorName = commit.author?.name ?? "Unknown";
  const authorDate = commit.author?.date ?? "";
  const graphWidth = svgWidth ?? LANE_WIDTH;

  return (
    <SidebarRow
      compact
      selected={isSelected}
      label={commit.summary}
      metadata={[authorName, authorDate && formatCompactAge(authorDate)]
        .filter(Boolean)
        .join(" · ")}
      className={
        cursorReset || isSelected ? "cursor-default" : "cursor-pointer"
      }
      style={{ height: `${GIT_COMMIT_ROW_HEIGHT}px` }}
      onClick={handleClick}
      onContextMenu={(event) => onContextMenu?.(event, commit)}
      onMouseLeave={resetCursor}
      title={`${commit.summary}\n\n${commit.short_sha} by ${authorName}`}
      leading={
        graphNode && svgWidth ? (
          <GraphSvg
            graphNode={graphNode}
            svgWidth={svgWidth}
            isFirst={isFirst}
          />
        ) : showGraphPlaceholder ? (
          <span style={{ width: graphWidth }} className="shrink-0" />
        ) : undefined
      }
    />
  );
}

const GitCommitRow = memo(
  GitCommitRowComponent
) as typeof GitCommitRowComponent;

export default GitCommitRow;
