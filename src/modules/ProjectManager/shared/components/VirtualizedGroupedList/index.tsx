import React, { useCallback, useMemo, useState } from "react";

import { VirtualList } from "@src/components/VirtualList";

import { type VirtualizedGroup, buildVirtualizedGroupModel } from "./model";

interface VirtualizedGroupedListProps<
  TEntry extends VirtualizedGroup<unknown, unknown>,
> {
  groups: readonly TEntry[];
  defaultExpanded: (group: TEntry) => boolean;
  getItemKey: (
    item: TEntry["items"][number],
    group: TEntry["group"]
  ) => React.Key;
  renderGroupHeader: (
    group: TEntry["group"],
    expanded: boolean,
    onExpandedChange: (expanded: boolean) => void
  ) => React.ReactNode;
  renderItem: (
    item: TEntry["items"][number],
    group: TEntry["group"],
    isLastInGroup: boolean
  ) => React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Shared grouped-list window for Project Manager surfaces. Authoritative item
 * arrays remain parent-owned; only the visible expanded rows are referenced by
 * the virtualizer's derived data model.
 */
export default function VirtualizedGroupedList<
  const TEntry extends VirtualizedGroup<unknown, unknown>,
>({
  groups,
  defaultExpanded,
  getItemKey,
  renderGroupHeader,
  renderItem,
  className,
  testId,
}: VirtualizedGroupedListProps<TEntry>) {
  const [expandedOverrides, setExpandedOverrides] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());

  const isExpanded = useCallback(
    (group: TEntry) =>
      expandedOverrides.get(group.key) ?? defaultExpanded(group),
    [defaultExpanded, expandedOverrides]
  );

  const model = useMemo(
    () => buildVirtualizedGroupModel(groups, isExpanded),
    [groups, isExpanded]
  );

  /**
   * The previous grouped virtualizer kept group headers and items in separate
   * index spaces and interleaved them itself. `VirtualList` windows one flat
   * row list, so headers and items are flattened here — which also makes the
   * header rows' positions the `stickyIndices` the primitive needs.
   */
  const flat = useMemo(() => {
    const keys: React.Key[] = [];
    const rows: Array<
      { kind: "group"; groupIndex: number } | { kind: "item"; rowIndex: number }
    > = [];
    const stickyIndices: number[] = [];
    let rowIndex = 0;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      stickyIndices.push(rows.length);
      rows.push({ kind: "group", groupIndex });
      keys.push(`group:${group.key}`);
      const itemCount = model.groupCounts[groupIndex] ?? 0;
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        const row = model.rows[rowIndex];
        const currentRowIndex = rowIndex;
        rowIndex += 1;
        if (row) {
          rows.push({ kind: "item", rowIndex: currentRowIndex });
          keys.push(`item:${String(getItemKey(row.item, row.group))}`);
        }
      }
    }
    return { keys, rows, stickyIndices };
  }, [getItemKey, groups, model]);

  const handleExpandedChange = useCallback(
    (groupKey: string, expanded: boolean) => {
      setExpandedOverrides((current) => {
        const next = new Map(current);
        next.set(groupKey, expanded);
        return next;
      });
    },
    []
  );

  const computeItemKey = useCallback(
    (index: number): React.Key => flat.keys[index] ?? `row:${index}`,
    [flat]
  );

  const renderRow = useCallback(
    (index: number): React.ReactNode => {
      const row = flat.rows[index];
      if (!row) return null;
      if (row.kind === "group") {
        const group = groups[row.groupIndex];
        if (!group) return null;
        const expanded = isExpanded(group);
        return renderGroupHeader(group.group, expanded, (nextExpanded) =>
          handleExpandedChange(group.key, nextExpanded)
        );
      }
      const modelRow = model.rows[row.rowIndex];
      return modelRow
        ? renderItem(modelRow.item, modelRow.group, modelRow.isLastInGroup)
        : null;
    },
    [
      flat,
      groups,
      handleExpandedChange,
      isExpanded,
      model,
      renderGroupHeader,
      renderItem,
    ]
  );

  return (
    <VirtualList
      className={className}
      data-testid={testId}
      totalCount={flat.rows.length}
      computeItemKey={computeItemKey}
      stickyIndices={flat.stickyIndices}
      estimatedItemHeight={44}
      overscanPx={320}
      style={{ height: "100%" }}
      itemContent={renderRow}
    />
  );
}

export type { VirtualizedGroup } from "./model";
