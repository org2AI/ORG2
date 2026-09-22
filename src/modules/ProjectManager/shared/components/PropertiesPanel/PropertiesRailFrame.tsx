import React from "react";

import {
  WORKSTATION_TRAIL_RAIL_PADDING_CLASS,
  WORKSTATION_TRAIL_WIDTH,
} from "@src/components/layout/tokens/workstationTrailTokens";

interface PropertiesRailFrameProps {
  children?: React.ReactNode;
  width?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  floatingContent?: boolean;
}

function toCssSize(value: number | string | undefined): string | undefined {
  return typeof value === "number" ? `${value}px` : value;
}

const PropertiesRailFrame: React.FC<PropertiesRailFrameProps> = ({
  children,
  width,
  minWidth,
  maxWidth,
  floatingContent = false,
}) => {
  const resolvedWidth =
    floatingContent && width === undefined
      ? WORKSTATION_TRAIL_WIDTH.expandedPx
      : width;
  const sizeStyle = {
    width: toCssSize(resolvedWidth),
    minWidth: toCssSize(minWidth),
    maxWidth: toCssSize(maxWidth),
  };

  if (floatingContent) {
    return (
      <div
        className={`box-border flex h-full shrink-0 flex-col ${WORKSTATION_TRAIL_RAIL_PADDING_CLASS}`}
        style={sizeStyle}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className="box-border flex h-full shrink-0 flex-col border-l border-solid border-border-2"
      style={sizeStyle}
    >
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
};

export default PropertiesRailFrame;
