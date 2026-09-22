// @vitest-environment jsdom
import { Provider } from "jotai";
import { act, createElement } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { navigateInMainWindow } from "@src/api/tauri/stationWindow";
import { ROUTES } from "@src/config/routes";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";
import { createInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { useStationWindowNavigation } from "./useStationWindowNavigation";
import { useStationWindowRouteGuard } from "./useStationWindowRouteGuard";

vi.mock("@src/util/platform/tauri/windowIdentity", async (original) => ({
  ...(await original<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  isStationWindow: () => true,
  getCurrentStationWindowMode: () => "my-station",
}));
vi.mock("@src/api/tauri/stationWindow", () => ({
  navigateInMainWindow: vi.fn(async () => {}),
}));

it("intercepts direct Router navigation before the main shell mounts", async () => {
  const store = createInstrumentedStore();
  const mainShell = vi.fn(() => null);
  function Station() {
    useStationWindowNavigation();
    useStationWindowRouteGuard();
    return null;
  }
  const path = "/orgii/app/station/my-station";
  const router = createMemoryRouter(
    [
      { path, element: createElement(Station) },
      { path: "*", element: createElement(mainShell) },
    ],
    { initialEntries: [path] }
  );
  const root = createSmokeRoot();
  try {
    await root.render(
      createElement(
        Provider,
        { store },
        createElement(RouterProvider, { router })
      )
    );
    await act(async () => {
      await router.navigate(ROUTES.workStation.chat.path);
    });
    expect(router.state.location.pathname).toBe(path);
    expect(store.get(stationModeAtom)).toBe("agent-station");
    await act(async () => {
      await router.navigate(ROUTES.app.settings.path);
    });
    expect(router.state.location.pathname).toBe(path);
    expect(navigateInMainWindow).toHaveBeenCalledWith({
      path: ROUTES.app.settings.path,
      replace: undefined,
    });
    expect(mainShell).not.toHaveBeenCalled();
  } finally {
    await root.unmount();
    router.dispose();
  }
});
