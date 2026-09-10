import { useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { enterWorkstationRouteAtom } from "@src/store/workstation/routeEntryAtom";

/** Apply URL entry intent once per navigation, never on ordinary tab changes. */
export function useWorkstationRouteEntry(): void {
  const location = useLocation();
  const enterRoute = useSetAtom(enterWorkstationRouteAtom);
  const appliedKey = useRef<string | null>(null);
  useEffect(() => {
    if (appliedKey.current === location.key) return;
    appliedKey.current = location.key;
    enterRoute(location.pathname);
  }, [enterRoute, location.key, location.pathname]);
}
