import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import Tooltip from "@src/components/Tooltip";
import {
  HEADER_ICON_SIZE,
  TYPOGRAPHY,
  WORKSTATION_TRAIL_SECTION_LABEL,
} from "@src/config/workstation/tokens";
import { useCachedSubagentParentDetails } from "@src/engines/Simulator/hooks/useCachedSubagentParentDetails";
import { useSubagentRoster } from "@src/engines/Simulator/hooks/useSubagentRoster";
import { ArrowLeft02Icon, HugeiconsIcon } from "@src/icons";
import type { SessionTrailSurface } from "@src/store/workstation/sessionTrailSurfaceAtom";
import {
  EMPTY_SUBAGENT_TRAIL_VIEW,
  subagentTrailViewAtom,
} from "@src/store/workstation/subagentTrailViewAtom";

/** Title content for the shared trail header; the shell owns its actions. */
export function SubagentTrailHeader({
  surface,
}: {
  surface: SessionTrailSurface;
}) {
  const { t } = useTranslation();
  const scope = `${surface.ownerTabId}:${surface.sessionId}`;
  const [view, setView] = useAtom(subagentTrailViewAtom);
  const selectedId =
    view.scope === scope ? view.selected : (surface.childSessionId ?? null);
  // The roster resource is shared with the content; this does not load history.
  const { sessions, loaded, error } = useSubagentRoster(surface.sessionId);
  const selected = sessions.find((child) => child.sessionId === selectedId);
  const parentDetails = useCachedSubagentParentDetails(
    selected ? surface.sessionId : null
  );

  if (!selectedId) {
    return (
      <span
        className={`min-w-0 truncate px-1 ${WORKSTATION_TRAIL_SECTION_LABEL}`}
      >
        {surface.title}
      </span>
    );
  }
  const title =
    selected?.description ||
    (selectedId ? parentDetails.get(selectedId)?.title : undefined) ||
    selected?.name ||
    t(
      !loaded && !error
        ? "common:status.loading"
        : "sessions:subagentTrail.recordUnavailable"
    );

  return (
    <>
      <ToolbarTooltip label={t("common:actions.back")} noShortcut>
        <Button
          variant="tertiary"
          size="sidebar"
          iconOnly
          aria-label={t("common:actions.back")}
          icon={
            <HugeiconsIcon icon={ArrowLeft02Icon} size={HEADER_ICON_SIZE.sm} />
          }
          onClick={() =>
            setView((previous) => ({
              ...(previous.scope === scope
                ? previous
                : { ...EMPTY_SUBAGENT_TRAIL_VIEW, scope }),
              selected: null,
            }))
          }
        />
      </ToolbarTooltip>
      <Tooltip content={title} kind="button" framedPanel>
        <span
          className={`min-w-0 truncate px-1 ${TYPOGRAPHY.value} text-text-1`}
          data-subagent-header-title
        >
          {title}
        </span>
      </Tooltip>
    </>
  );
}
