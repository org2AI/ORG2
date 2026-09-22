import React from "react";

import Button from "@src/components/Button";
import { HOVER_CARD } from "@src/components/HoverCard/tokens";
import { HugeiconsIcon, InternetIcon } from "@src/icons";
import { openLink } from "@src/util/ui/openLink";

import { HoverCardRow } from "./HoverCardBase";

export const HOVER_CARD_LINK_ROW_CLASS_NAME =
  "block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left text-text-2 underline-offset-2 transition-colors hover:text-accent-9 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-8";

const COMPACT_URL_MAX_CHARS = 44;

function formatCompactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const compact = `${parsed.host}${parsed.pathname}${parsed.search}`.replace(
      /\/$/,
      ""
    );
    if (compact.length <= COMPACT_URL_MAX_CHARS) return compact;
    return `${compact.slice(0, COMPACT_URL_MAX_CHARS - 1).trimEnd()}…`;
  } catch {
    if (url.length <= COMPACT_URL_MAX_CHARS) return url;
    return `${url.slice(0, COMPACT_URL_MAX_CHARS - 1).trimEnd()}…`;
  }
}

interface HoverCardUrlRowProps {
  url: string;
}

export const HoverCardUrlRow: React.FC<HoverCardUrlRowProps> = ({ url }) => {
  const label = formatCompactUrl(url);

  return (
    <HoverCardRow
      icon={
        <HugeiconsIcon
          icon={InternetIcon}
          data-icon="globe"
          size={HOVER_CARD.iconSize}
          strokeWidth={HOVER_CARD.iconStrokeWidth}
        />
      }
    >
      <Button
        layout="custom"
        className={HOVER_CARD_LINK_ROW_CLASS_NAME}
        title={url}
        onClick={() => openLink(url)}
      >
        {label}
      </Button>
    </HoverCardRow>
  );
};

HoverCardUrlRow.displayName = "HoverCardUrlRow";
