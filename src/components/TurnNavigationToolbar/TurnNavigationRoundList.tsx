import React, { memo } from "react";

import Button from "@src/components/Button";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";

export interface TurnNavigationRoundListItem {
  id: string;
  pageIndex: number;
  label: string;
  timeLabel?: string;
}

export interface TurnNavigationRoundListProps {
  items: TurnNavigationRoundListItem[];
  currentPageIndex: number;
  onSelect: (pageIndex: number) => void;
  className?: string;
  mobile?: boolean;
}

const TurnNavigationRoundList: React.FC<TurnNavigationRoundListProps> = memo(
  ({ items, currentPageIndex, onSelect, className = "", mobile = false }) => {
    return (
      <div
        data-testid="turn-navigation-round-list"
        data-mobile-round-list={mobile || undefined}
        className={`scrollbar-hide max-h-[min(60vh,24rem)] overflow-y-auto ${className}`.trim()}
      >
        {items.map((item) => {
          const isCurrent = item.pageIndex === currentPageIndex;
          return (
            <Button
              layout="custom"
              key={item.id}
              data-testid="turn-page-list-item"
              data-page-index={item.pageIndex}
              aria-current={isCurrent ? "true" : undefined}
              className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left ${
                isCurrent ? DROPDOWN_CLASSES.itemSelected : "text-text-2"
              }`}
              onClick={() => onSelect(item.pageIndex)}
            >
              <span className="shrink-0 font-semibold tabular-nums">
                #{item.pageIndex + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.timeLabel ? (
                <span className="shrink-0 text-xs text-text-3 tabular-nums">
                  {item.timeLabel}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
    );
  }
);

TurnNavigationRoundList.displayName = "TurnNavigationRoundList";

export default TurnNavigationRoundList;
