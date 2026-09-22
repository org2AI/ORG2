import React, { useCallback, useMemo, useState } from "react";

import {
  FILE_TREE_HOVER_DELAY_MS,
  FileTreePreview,
} from "@src/components/FileTreePreview/exports";
import Tooltip from "@src/components/Tooltip";
import { TREE_ROW_HEIGHT, TreeRowBase } from "@src/components/TreeRow";
import type {
  FlattenedTreeNode,
  StickyScrollNode,
} from "@src/components/VirtualizedStickyTree";
import { VirtualizedStickyTree } from "@src/components/VirtualizedStickyTree";
import { StickyTreeRow } from "@src/components/VirtualizedStickyTree/StickyTreeRow";
import { AGENT_DOT_TOKENS } from "@src/engines/Simulator/config";

import {
  type FileTreeInput,
  type SimulatorTreeNode,
  buildFileTree,
  flattenFileTree,
} from "../fileTreeUtils";

interface SimulatorTreePanelProps {
  items: FileTreeInput[];
  selectedId: string | null;
  /** Event IDs that should show the agent-selected indicator (blue dot) */
  agentSelectedIds: Set<string>;
  onSelectItem: (eventId: string) => void;
  emptyMessage: string;
  viewMode: "list-tree" | "list";
  /** Disable for terminal entries whose tree paths are synthetic event IDs. */
  showFilePathPreview?: boolean;
}

const SimulatorTreePanel: React.FC<SimulatorTreePanelProps> = ({
  items,
  selectedId,
  agentSelectedIds,
  onSelectItem,
  emptyMessage,
  viewMode,
  showFilePathPreview = true,
}) => {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

  const treeItems = useMemo((): FileTreeInput[] => {
    if (viewMode === "list") {
      return items.map((item) => ({
        ...item,
        logicalPath: item.filePath,
        filePath: encodeURIComponent(item.id),
      }));
    }
    return items;
  }, [items, viewMode]);

  const tree = useMemo(() => buildFileTree(treeItems), [treeItems]);
  const flattened = useMemo(
    () => flattenFileTree(tree, collapsedPaths),
    [tree, collapsedPaths]
  );

  const handleNodeClick = useCallback(
    (node: SimulatorTreeNode) => {
      if (node.type === "directory") {
        setCollapsedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(node.path)) next.delete(node.path);
          else next.add(node.path);
          return next;
        });
      } else if (node.eventId) {
        onSelectItem(node.eventId);
      }
    },
    [onSelectItem]
  );

  const renderItem = useCallback(
    (item: FlattenedTreeNode<SimulatorTreeNode>, _index: number) => {
      const isFile = item.node.type === "file";
      const isAgentSelected =
        isFile &&
        !!item.node.eventId &&
        agentSelectedIds.has(item.node.eventId);

      const row = (
        <TreeRowBase
          node={item.node}
          depth={item.depth}
          isSelected={item.node.eventId === selectedId}
          onClick={() => handleNodeClick(item.node)}
          showIndentGuides={false}
          showPathHint={false}
          showNativeTitle={!isFile}
        >
          {item.node.statusLabel && (
            <div
              className={`flex h-5 w-5 shrink-0 items-center justify-center text-[11px] font-bold ${item.node.statusColorClass || "text-text-2"}`}
            >
              {item.node.statusLabel}
            </div>
          )}
          {isAgentSelected && (
            <div className={AGENT_DOT_TOKENS.container}>
              <div className={AGENT_DOT_TOKENS.dot} />
            </div>
          )}
        </TreeRowBase>
      );

      // The row itself only shows the file name — the full path lives in a
      // hover card so long paths never squeeze the name out of the sidebar.
      if (!isFile || !showFilePathPreview) return row;

      return (
        <Tooltip
          content={<FileTreePreview path={item.node.path} />}
          position="right"
          smartPlacement
          showArrow={false}
          mouseEnterDelay={FILE_TREE_HOVER_DELAY_MS}
          style={{ padding: 0, background: "transparent", boxShadow: "none" }}
        >
          {row}
        </Tooltip>
      );
    },
    [selectedId, handleNodeClick, agentSelectedIds, showFilePathPreview]
  );

  const renderStickyItem = useCallback(
    (stickyNode: StickyScrollNode<SimulatorTreeNode>, onClick: () => void) => (
      <StickyTreeRow
        depth={stickyNode.depth}
        expanded
        name={stickyNode.node.name}
        onClick={onClick}
      />
    ),
    []
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <VirtualizedStickyTree
          flattenedNodes={flattened}
          rowHeight={TREE_ROW_HEIGHT}
          renderItem={renderItem}
          renderStickyItem={renderStickyItem}
          emptyMessage={emptyMessage}
        />
      </div>
    </div>
  );
};

export default SimulatorTreePanel;
