import { useTranslation } from "react-i18next";

import { SidebarRow } from "@src/components/SidebarRow";
import Tooltip from "@src/components/Tooltip";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { SessionSourceIcon } from "./SessionSourceIcon";
import { sourceLabel, sourceLocation, sourceProvenance } from "./presentation";

/** Domain adapter only: SidebarRow owns the compact three-line interaction. */
export function SessionSourceRow({
  source,
  onOpenSource,
}: {
  source: Exclude<SessionSource, { kind: "tool-group" }>;
  onOpenSource: (source: SessionSource) => void;
}) {
  const { t } = useTranslation();
  const label = sourceLabel(t, source);
  const location = sourceLocation(source);
  return (
    <Tooltip content={location || label} position="left">
      <SidebarRow
        label={label}
        metadata={location}
        icon={<SessionSourceIcon source={source} />}
        aria-label={label}
        onClick={() => onOpenSource(source)}
      >
        {sourceProvenance(t, source)}
      </SidebarRow>
    </Tooltip>
  );
}
