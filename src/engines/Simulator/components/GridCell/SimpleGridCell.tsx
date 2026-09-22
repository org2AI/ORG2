/**
 * SimpleGridCell
 *
 * Memoized grid cell without independent replay: renders the active app's
 * content (or the booting state) for the shared simulator cursor.
 * Used for single-cell mode or when independent replay is not needed.
 * Custom memo comparison prevents unnecessary re-renders.
 */
import { memo } from "react";

import type { SessionEvent, SessionSpec } from "@src/engines/SessionCore";

import type { AppType } from "../../types/appTypes";
import { getEventRenderSignature } from "../../utils/eventRenderSignature";
import { SimulatorSingleView } from "../SimulatorContentArea/SimulatorSingleView";
import { BootingState } from "../SimulatorContentArea/StateDisplays";
import { useSimulatorContent } from "../SimulatorContentArea/useSimulatorContent";

interface SimpleGridCellProps {
  currentEvent: SessionEvent | null;
  events: SessionEvent[];
  specs: SessionSpec[];
  forceAppType?: AppType | null;
}

const SimpleGridCellComponent = ({
  currentEvent,
  events,
  specs,
  forceAppType = null,
}: SimpleGridCellProps) => {
  const { mainContentAppType, isBootingEvent, displayContent } =
    useSimulatorContent({
      currentEvent,
      events,
      specs,
      forceAppType,
    });

  return (
    <div className="group relative flex h-full w-full flex-col overflow-hidden transition-all duration-300">
      {isBootingEvent ? (
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg-2">
          <div className="min-h-0 flex-1 overflow-auto text-text-1">
            <BootingState />
          </div>
        </div>
      ) : (
        <SimulatorSingleView
          mainContentAppType={mainContentAppType}
          displayContent={displayContent}
        />
      )}
    </div>
  );
};

const arePropsEqual = (
  prev: SimpleGridCellProps,
  next: SimpleGridCellProps
): boolean => {
  if (prev.forceAppType !== next.forceAppType) return false;
  // Arrays are compared by reference: a changed tail always arrives as a new
  // array, so a tail signature over the same reference could never differ.
  if (prev.events !== next.events) return false;
  if (prev.specs !== next.specs) return false;

  return (
    getEventRenderSignature(prev.currentEvent) ===
    getEventRenderSignature(next.currentEvent)
  );
};

const SimpleGridCell = memo(SimpleGridCellComponent, arePropsEqual);
SimpleGridCell.displayName = "SimpleGridCell";

export { SimpleGridCell };
