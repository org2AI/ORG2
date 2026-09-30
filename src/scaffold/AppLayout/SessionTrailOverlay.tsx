import { useAtomValue, useSetAtom } from "jotai";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { NoDragRegion } from "@src/components/WindowChrome";
import { WorkstationTrailIconButton } from "@src/components/layout/blocks";
import { TYPOGRAPHY } from "@src/config/workstation/tokens";
import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  Cancel01Icon,
  HugeiconsIcon,
} from "@src/icons";
import { useOverlayLayer } from "@src/store/ui/overlayLayerAtom";
import {
  closeSessionTrailSurfaceAtom,
  sessionTrailSurfaceAtom,
  toggleSessionTrailFullscreenAtom,
} from "@src/store/workstation/sessionTrailSurfaceAtom";

import { WorkstationSurface } from "./WorkstationSurface";

const Content = lazy(() =>
  import("@src/features/SubagentTrail/SubagentTrailContent").then((m) => ({
    default: m.SubagentTrailContent,
  }))
);
const Title = lazy(() =>
  import("@src/features/SubagentTrail/SubagentTrailHeader").then((m) => ({
    default: m.SubagentTrailHeader,
  }))
);

/** The temporary inspector uses the shared Workstation shell. Opening it never
 * changes Station tabs or reparents the conversation and its unsent draft. */
export function SessionTrailOverlay() {
  const { t } = useTranslation();
  const surface = useAtomValue(sessionTrailSurfaceAtom);
  const close = useSetAtom(closeSessionTrailSurfaceAtom);
  const fullscreen = useSetAtom(toggleSessionTrailFullscreenAtom);
  useOverlayLayer(!!surface);
  if (!surface) return null;
  const label = t(
    surface.fullscreen
      ? "sessions:simulator.replay.canvas.tooltipExitFullscreen"
      : "sessions:simulator.replay.canvas.tooltipFullscreen"
  );
  const closeLabel = t("common:actions.close");
  return (
    <WorkstationSurface
      floating
      visible
      appearance="trail"
      fullscreen={surface.fullscreen}
      label={surface.title}
      dockStyle={{}}
      dockClassName=""
      headerTitle={
        <Suspense fallback={surface.title}>
          <Title surface={surface} />
        </Suspense>
      }
      header={
        <NoDragRegion className="flex shrink-0 items-center gap-px">
          <ToolbarTooltip label={label} noShortcut>
            <WorkstationTrailIconButton
              aria-label={label}
              aria-pressed={!!surface.fullscreen}
              onClick={fullscreen}
            >
              <HugeiconsIcon
                icon={
                  surface.fullscreen ? ArrowShrink02Icon : ArrowExpand01Icon
                }
                size={14}
                strokeWidth={1.75}
              />
            </WorkstationTrailIconButton>
          </ToolbarTooltip>
          <ToolbarTooltip label={closeLabel} noShortcut>
            <WorkstationTrailIconButton aria-label={closeLabel} onClick={close}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
            </WorkstationTrailIconButton>
          </ToolbarTooltip>
        </NoDragRegion>
      }
    >
      <Suspense
        fallback={
          <p role="status" className={`p-2 ${TYPOGRAPHY.value} text-text-3`}>
            {t("common:status.loading")}
          </p>
        }
      >
        <Content
          key={`${surface.ownerTabId}:${surface.sessionId}`}
          surface={surface}
        />
      </Suspense>
    </WorkstationSurface>
  );
}
