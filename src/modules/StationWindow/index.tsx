/**
 * StationWindowPage — the standalone route a detached station window loads.
 *
 * Rendered by `appStandaloneRouteGroup` (outside the main `AppShell`), so
 * the window carries no sidebar and no chat panel: one station surface — My
 * Station (Code / Browser / Project tabs) or Agent Station (the activity
 * simulator) — composed from the same `WorkStationPage` the main window
 * mounts inside `AppLayout`. The initial station is seeded by the window label
 * (`app-window-station-<mode>`, see `stationModeAtom`); the route param only
 * mirrors it so the URL is self-describing and browser dev can render it.
 *
 * The provider stack mirrors the slice of `AppLayout` a workstation surface
 * needs (`DataProvider → ChatProvider → SessionSyncProvider`, the
 * `BrowserProvider` the Browser host requires, and the workbench
 * `ActionSystemProvider` + Spotlight so ⌘K / ⌘P palettes work here).
 * Main-window singletons stay out: no ADE action bridge, no queue dispatch,
 * no native notification delivery, no `open-url-preview` / `open-workspace`
 * listeners (those Tauri events are broadcast and the main window already
 * handles them).
 *
 * The station follows the MAIN window's remembered session: seeded from the
 * `?session=` query at open time, then retargeted by every
 * `orgii:station-window:session` event (`useStationWindowBridge`).
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import React, { memo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";

import {
  STATION_WINDOW_SESSION_EVENT,
  type StationWindowSessionPayload,
  requestStationWindowSession,
} from "@src/api/tauri/stationWindow";
import { getPrimaryPaneBackgroundColor } from "@src/components/layout/tokens/viewContainerTokens";
import { ChatProvider } from "@src/contexts/workspace/ChatContext";
import { DataProvider } from "@src/contexts/workspace/DataContext";
import { BrowserProvider } from "@src/contexts/workstation";
import { useEventStoreBridge } from "@src/engines/SessionCore/core/store/useEventStoreBridge";
import SessionSyncProvider from "@src/engines/SessionCore/sync/SessionSyncProvider";
import { createLogger } from "@src/hooks/logger";
import { useMacosPageBackdropSurface } from "@src/hooks/platform/useMacosPageBackdropSurface";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import { useProjectDataChangedListener } from "@src/hooks/project";
import { useNativeSessionStatusMonitor } from "@src/hooks/session/useNativeSessionStatusMonitor";
import { useGlobalBrowserWebviewLayering } from "@src/modules/WorkStation/Browser/hooks";
import { useOpenUrlInBrowser } from "@src/modules/useOpenUrlInBrowser";
import { useWorkStationPipelineBridge } from "@src/modules/useWorkStationPipelineBridge";
import { ActionSystemProvider } from "@src/scaffold/ActionSystem";
import { GlobalSpotlightPortal } from "@src/scaffold/GlobalSpotlight/GlobalSpotlightPortal";
import { loadSessions } from "@src/store/session";
import {
  jumpToSessionAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import { resolvedBackgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";
import { STATION_MODES, type StationMode } from "@src/types/ui/workstation";
import { getCurrentStationWindowMode } from "@src/util/platform/tauri/windowIdentity";

import { useStationWindowNavigation } from "./useStationWindowNavigation";
import { useStationWindowRouteGuard } from "./useStationWindowRouteGuard";

const log = createLogger("StationWindow");

const WorkStationPage = React.lazy(
  () => import(/* webpackChunkName: "workstation" */ "@src/modules/WorkStation")
);

const SharedBrowserApp = React.lazy(
  () =>
    import(
      /* webpackChunkName: "browser-shared" */ "@src/modules/WorkStation/Browser/shared/SharedBrowserApp"
    )
);

/** Query parameter carrying the seed session; set by `open_station_window`. */
export const STATION_WINDOW_SESSION_PARAM = "session";

/** Path the detached window navigates to for one station. Must stay in sync
 *  with the Rust route in `app_window::commands::open_station_window` and
 *  the `appStandaloneRouteGroup` entry. */
export function getStationWindowPath(
  stationMode: StationMode,
  sessionId?: string | null
): string {
  const base = `/orgii/app/station/${stationMode}`;
  return sessionId
    ? `${base}?${STATION_WINDOW_SESSION_PARAM}=${encodeURIComponent(sessionId)}`
    : base;
}

function parseStationMode(value: string | undefined): StationMode | null {
  return value && (STATION_MODES as readonly string[]).includes(value)
    ? (value as StationMode)
    : null;
}

/**
 * Keep this window's remembered session on the main window's: the route seed
 * first, then every follow event. `jumpToSessionAtom` runs the same clear →
 * loading → set sequence the in-app owners use, so Agent Station replays and
 * My Station's per-session workspace both converge on it.
 */
function useStationWindowSessionFollower(seedSessionId: string | null): void {
  const store = useStore();
  const jumpToSession = useSetAtom(jumpToSessionAtom);
  const setStationMode = useSetAtom(stationModeAtom);

  useEffect(() => {
    // Session rows are owned by the chat surfaces in the main window; this
    // window has none, so hydrate the list itself (header names, agent
    // chips, status dots).
    loadSessions({ forceRefresh: true }).catch((error: unknown) => {
      log.warn("Failed to hydrate sessions for the station window", error);
    });
  }, []);

  useEffect(() => {
    if (seedSessionId) jumpToSession(seedSessionId);
    // Seed once per window; later retargets arrive as events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTauriListen<StationWindowSessionPayload>(
    STATION_WINDOW_SESSION_EVENT,
    ({ sessionId, stationMode }) => {
      if (stationMode) setStationMode(stationMode);
      if (sessionId === store.get(workstationActiveSessionIdAtom)) return;
      jumpToSession(sessionId);
    },
    {
      onReady: () => {
        const mode = getCurrentStationWindowMode();
        if (mode)
          void requestStationWindowSession(mode).catch((error) =>
            log.warn("Failed to request current session", error)
          );
      },
    }
  );
}

/** Hooks a station window needs from the main window's shell, and no more. */
const StationWindowBridges: React.FC<{ seedSessionId: string | null }> = ({
  seedSessionId,
}) => {
  useEventStoreBridge();
  useNativeSessionStatusMonitor({ notifications: false });
  useWorkStationPipelineBridge(true);
  useStationWindowSessionFollower(seedSessionId);
  useStationWindowNavigation();
  useStationWindowRouteGuard();
  useGlobalBrowserWebviewLayering();
  useProjectDataChangedListener();
  return null;
};

/** Mounts `useOpenUrlInBrowser` inside `BrowserProvider` (needs its context). */
const BrowserEventBridge: React.FC = () => {
  useOpenUrlInBrowser();
  return null;
};

const WorkStationLoadingFallback: React.FC = () => (
  <div className="h-full w-full bg-workstation-bg" />
);

const StationWindowSurface: React.FC<{ stationMode: StationMode }> = memo(
  ({ stationMode }) => {
    const effectiveMode = useAtomValue(stationModeAtom);
    const { t } = useTranslation("common");
    const repoPath = useAtomValue(activeWorkspaceRootPathAtom);
    const backgroundConfig = useAtomValue(resolvedBackgroundConfigAtom);
    const setStationMode = useSetAtom(stationModeAtom);
    const paneSurfaceRef = useMacosPageBackdropSurface<HTMLDivElement>();
    const paneUnderlayStyle: React.CSSProperties = {
      backgroundColor: getPrimaryPaneBackgroundColor(
        backgroundConfig.pageOpacity
      ),
    };

    // Inside Tauri the window label seeds the local selection.
    // Outside it (browser dev renders of this route) there is no label, so
    // the route decides.
    useEffect(() => {
      if (getCurrentStationWindowMode() === null) setStationMode(stationMode);
    }, [setStationMode, stationMode]);

    useEffect(() => {
      if (getCurrentStationWindowMode() === null) return;
      void getCurrentWindow()
        .setTitle(
          t(
            effectiveMode === "agent-station"
              ? "terminology.agentStation"
              : "terminology.myStation"
          )
        )
        .catch((error) =>
          log.warn("Failed to update station window title", error)
        );
    }, [effectiveMode, t]);

    return (
      <BrowserProvider>
        <BrowserEventBridge />
        <React.Suspense fallback={null}>
          <SharedBrowserApp />
        </React.Suspense>
        <ActionSystemProvider repoPath={repoPath}>
          <div
            ref={paneSurfaceRef}
            className="relative isolate flex h-full min-h-0 min-w-0 flex-row overflow-hidden"
            style={paneUnderlayStyle}
            data-pane-surface-underlay
            data-station-window={effectiveMode}
          >
            <div
              className="relative z-0 h-full min-h-0 min-w-0 flex-1 overflow-hidden"
              data-workbench-surface
            >
              <React.Suspense fallback={<WorkStationLoadingFallback />}>
                <WorkStationPage chatPanelFocused={false} />
              </React.Suspense>
            </div>
          </div>
          <GlobalSpotlightPortal />
        </ActionSystemProvider>
      </BrowserProvider>
    );
  }
);

StationWindowSurface.displayName = "StationWindowSurface";

const StationWindowPage: React.FC = () => {
  const { stationMode: stationModeParam } = useParams<{
    stationMode: string;
  }>();
  const [searchParams] = useSearchParams();
  const stationMode = parseStationMode(stationModeParam);
  const seedSessionId = searchParams.get(STATION_WINDOW_SESSION_PARAM);

  if (!stationMode) return null;

  return (
    <div className="h-full min-h-0 w-full">
      <DataProvider>
        <ChatProvider>
          <SessionSyncProvider>
            <StationWindowBridges seedSessionId={seedSessionId} />
            <StationWindowSurface stationMode={stationMode} />
          </SessionSyncProvider>
        </ChatProvider>
      </DataProvider>
    </div>
  );
};

export default StationWindowPage;
