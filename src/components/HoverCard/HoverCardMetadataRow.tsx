import React from "react";

import { HOVER_CARD } from "@src/components/HoverCard/tokens";
import { HugeiconsIcon } from "@src/icons";

import { HoverCardRow } from "./HoverCardBase";

interface HoverCardMetadataRowProps {
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
  dataIcon?: string;
  iconClassName?: string;
  children: React.ReactNode;
}

/** Standard metadata icon geometry, with content and status colors supplied by the domain. */
export function HoverCardMetadataRow({
  icon,
  dataIcon,
  iconClassName,
  children,
}: HoverCardMetadataRowProps) {
  return (
    <HoverCardRow
      icon={
        <HugeiconsIcon
          icon={icon}
          data-icon={dataIcon}
          size={HOVER_CARD.iconSize}
          strokeWidth={HOVER_CARD.iconStrokeWidth}
        />
      }
      iconClassName={iconClassName}
    >
      {children}
    </HoverCardRow>
  );
}

/** Consistent label/value separation for timestamps, branches and identifiers. */
export function HoverCardMetadataValue({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="text-text-3">{label}</span>
      <span className="mx-1 text-text-4">·</span>
      <span>{children}</span>
    </>
  );
}
