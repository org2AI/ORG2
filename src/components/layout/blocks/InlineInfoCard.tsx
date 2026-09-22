import cn from "classnames";
import React from "react";

import { useInlineSurface } from "./inlineSurface";

export interface InlineInfoCardProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  dataTestId?: string;
}

const CARD_CLASS =
  "relative max-w-full min-w-0 overflow-hidden rounded-lg border border-border-2 bg-bg-2 px-3 py-2 contain-[inline-size]";

const InlineInfoCard: React.FC<InlineInfoCardProps> = ({
  children,
  className,
  contentClassName,
  dataTestId,
}) => {
  const surface = useInlineSurface();

  // Outside a table cell the card needs no measurement shim — the container
  // already bounds its width and owns the spacing around it.
  if (surface === "block") {
    return (
      <div
        className={cn(CARD_CLASS, contentClassName, className)}
        data-testid={dataTestId}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-0 max-w-full min-w-full overflow-hidden px-2 py-2 contain-[inline-size]",
        className
      )}
      data-testid={dataTestId}
    >
      <div className={cn(CARD_CLASS, contentClassName)}>{children}</div>
    </div>
  );
};

export default InlineInfoCard;
