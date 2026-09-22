import { useCallback } from "react";

import { TREE_ROW_HEIGHT } from "@src/components/TreeRow";
import { VirtualList } from "@src/components/VirtualList";

import { DOMTreeNodeRow } from "./DOMTreeNodeRow";
import { useDOMTreeReveal } from "./hooks/useDOMTreeReveal";
import type { FlattenedDOMNode } from "./types";

interface DOMTreeListProps {
  nodes: FlattenedDOMNode[];
  expandedNodes: Set<string>;
  selectedXPath: string | null;
  highlightedXPath?: string | null;
  virtualized: boolean;
  revealXPath?: string | null;
  revealKey?: number;
  onToggle: (xpath: string) => void;
  onSelect: (xpath: string) => void;
  onHover: (xpath: string | null) => void;
}

export function DOMTreeList({
  nodes,
  expandedNodes,
  selectedXPath,
  highlightedXPath,
  virtualized,
  revealXPath,
  revealKey,
  onToggle,
  onSelect,
  onHover,
}: DOMTreeListProps) {
  const { listRef, scrollContainerRef } = useDOMTreeReveal({
    flattenedNodes: nodes,
    virtualized,
    revealXPath,
    revealKey,
  });
  const renderNode = useCallback(
    (item: FlattenedDOMNode) => (
      <DOMTreeNodeRow
        node={item.node}
        depth={item.depth}
        isExpanded={expandedNodes.has(item.node.xpath)}
        isSelected={item.node.xpath === selectedXPath}
        isHighlighted={item.node.xpath === highlightedXPath}
        hasChildren={item.node.children.length > 0}
        onToggle={onToggle}
        onSelect={onSelect}
        onHover={onHover}
      />
    ),
    [
      expandedNodes,
      highlightedXPath,
      onHover,
      onSelect,
      onToggle,
      selectedXPath,
    ]
  );

  return (
    <div className="h-full overflow-hidden">
      {virtualized ? (
        <VirtualList
          ref={listRef}
          totalCount={nodes.length}
          itemContent={(index) => renderNode(nodes[index])}
          computeItemKey={(index) => nodes[index].node.xpath}
          overscanPx={200}
          className="scrollbar-hide h-full"
          estimatedItemHeight={TREE_ROW_HEIGHT}
        />
      ) : (
        <div
          ref={scrollContainerRef}
          className="scrollbar-hide h-full overflow-y-auto py-1"
        >
          {nodes.map((item) => (
            <div key={item.node.xpath} data-xpath={item.node.xpath}>
              {renderNode(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
