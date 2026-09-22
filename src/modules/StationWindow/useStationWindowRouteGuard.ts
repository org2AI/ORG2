import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

import { isStationWindowPath } from "@src/config/routes";
import { navigateApp } from "@src/router/navigateApp";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

/** Catch direct Router links as well as the action-system navigation adapter. */
export function useStationWindowRouteGuard(): void {
  const blocker = useBlocker(
    ({ nextLocation }) =>
      isStationWindow() &&
      !isStationWindowPath(nextLocation.pathname) &&
      nextLocation.pathname !== "/orgii/app/login"
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const { pathname, search, hash } = blocker.location;
    blocker.reset();
    navigateApp(pathname + search + hash);
  }, [blocker]);
}
