import React, { useCallback, useMemo } from "react";

import { useKeyboardMouseMode } from "@src/hooks/keyboard";

import { SPOTLIGHT_TOKENS } from "../constants";
import { usePickerVirtualization } from "../hooks/usePickerVirtualization";
import type { SpotlightItem } from "../types";
import { SpotlightItemList } from "./SpotlightItemList";
import { SpotlightItemRow } from "./SpotlightItemRow";

const CARD_HEIGHT = 80;
const CARD_GAP = 6;

/** Keep section headings full-width and never group cards across sections. */
export function groupSpotlightCards(items: SpotlightItem[]): number[][] {
  const rows: number[][] = [];
  items.forEach((item, index) => {
    const previous = rows.at(-1);
    if (
      !item.data?.isHeader &&
      previous &&
      previous.length < 3 &&
      !items[previous[0]].data?.isHeader
    ) {
      previous.push(index);
    } else {
      rows.push([index]);
    }
  });
  return rows;
}

interface SpotlightCardListProps {
  items: SpotlightItem[];
  selectedIndex: number;
  onItemSelect: (item: SpotlightItem) => void;
  onItemHover: (index: number) => void;
  searchQuery: string;
  containerHeight: number;
}

/** Virtualize rows of three cards while preserving the selector's original indices. */
export function SpotlightCardList(props: SpotlightCardListProps) {
  const { items, selectedIndex, searchQuery, containerHeight } = props;
  const { isKeyboardMode, handleMouseMove, dataKeyboardMode } =
    useKeyboardMouseMode({ enabled: items.length > 0 });
  const groups = useMemo(() => groupSpotlightCards(items), [items]);
  const selectedRow = groups.findIndex((row) => row.includes(selectedIndex));
  const stickyIndices = useMemo(
    () =>
      groups.flatMap((row, index) =>
        items[row[0]].data?.isHeader ? [index] : []
      ),
    [groups, items]
  );
  const estimateSize = useCallback(
    (index: number) =>
      items[groups[index][0]].data?.isHeader
        ? SPOTLIGHT_TOKENS.itemHeight
        : CARD_HEIGHT + CARD_GAP,
    [groups, items]
  );
  const getItemKey = useCallback(
    (index: number) =>
      groups[index].map((itemIndex) => items[itemIndex].id).join("\u0000"),
    [groups, items]
  );
  const { containerRef, rows, totalSize, stickyIndex, handleScroll } =
    usePickerVirtualization({
      count: groups.length,
      getItemKey,
      estimateSize,
      containerHeight,
      selectedIndex: selectedRow,
      keyboardNavigated: isKeyboardMode,
      searchQuery,
      stickyIndices,
      scrollPadding: stickyIndices.length ? SPOTLIGHT_TOKENS.itemHeight : 0,
    });

  if (!items.length) return <SpotlightItemList {...props} />;

  return (
    <div
      ref={containerRef}
      className="spotlight-scrollable overflow-y-auto px-2"
      style={{
        maxHeight: containerHeight,
        height: Math.min(containerHeight, totalSize),
      }}
      onMouseMove={handleMouseMove}
      onScroll={handleScroll}
      data-keyboard-mode={dataKeyboardMode}
      data-spotlight-view="gui"
    >
      <div style={{ height: totalSize, position: "relative" }}>
        {rows.map((row) => {
          const indices = groups[row.index];
          const isHeader = !!items[indices[0]].data?.isHeader;
          return (
            <div
              key={row.key}
              className={isHeader ? "z-10 bg-bg-2" : "grid grid-cols-3 gap-1.5"}
              style={{
                position: row.index === stickyIndex ? "sticky" : "absolute",
                top: row.index === stickyIndex ? 0 : row.start,
                left: 0,
                right: 0,
              }}
            >
              {indices.map((index) => (
                <SpotlightItemRow
                  key={items[index].id}
                  item={items[index]}
                  index={index}
                  isSelected={index === selectedIndex}
                  isKeyboardMode={isKeyboardMode}
                  onSelect={props.onItemSelect}
                  onHover={props.onItemHover}
                  searchQuery={searchQuery}
                  cardHeight={CARD_HEIGHT}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
