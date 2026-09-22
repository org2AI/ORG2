import { useStore } from "jotai";
import { useEffect } from "react";

import { navigateInMainWindow } from "@src/api/tauri/stationWindow";
import { ROUTES } from "@src/config/routes";
import { createLogger } from "@src/hooks/logger";
import { STATION_WINDOW_NAVIGATE_EVENT } from "@src/router/navigateApp";
import { enterWorkstationRouteAtom } from "@src/store/workstation/routeEntryAtom";

const log = createLogger("StationWindowNavigation");

/** A route intent changes tabs in this shell; it never replaces the shell. */
export function useStationWindowNavigation(): void {
  const store = useStore();
  useEffect(() => {
    const handler = (event: Event) => {
      const { path, replace } = (
        event as CustomEvent<{ path: string; replace?: boolean }>
      ).detail;
      const pathname = path.split(/[?#]/, 1)[0];
      const routes = ROUTES.workStation;
      const isStationRoute = Object.values(routes).some(
        (route) => route.path === pathname
      );
      if (!isStationRoute) {
        void navigateInMainWindow({ path, replace }).catch((error) =>
          log.warn("Failed to navigate main window", error)
        );
        return;
      }
      store.set(enterWorkstationRouteAtom, pathname);
    };
    window.addEventListener(STATION_WINDOW_NAVIGATE_EVENT, handler);
    return () =>
      window.removeEventListener(STATION_WINDOW_NAVIGATE_EVENT, handler);
  }, [store]);
}
