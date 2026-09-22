import { buildSettingsPath } from "@src/config/mainAppPaths/settings";
import { ROUTES, isSettingsPath } from "@src/config/routes";
import { navigateApp as dispatchNavigate } from "@src/router/navigateApp";
import { settingsReturnPathAtom } from "@src/store/ui/settingsNavigationAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const getStore = () => getInstrumentedStore();

export const AppViewService = {
  async toggleSidebar(): Promise<boolean> {
    const { sidebarCollapsedAtom } = await import("@src/store/ui/sidebarAtom");
    const store = getStore();
    const current = store.get(sidebarCollapsedAtom);
    store.set(sidebarCollapsedAtom, !current);
    return true;
  },

  async openSettings(): Promise<boolean> {
    dispatchNavigate(ROUTES.app.settings.path);
    return true;
  },

  /**
   * Lock the app windows. Without a password there is nothing to lock with,
   * so the shortcut lands on the settings tab where one can be set rather
   * than silently doing nothing.
   */
  async lockApp(): Promise<boolean> {
    const [{ appLockApi }, { appLockEnabledAtom, appLockStateAtom }] =
      await Promise.all([
        import("@src/api/tauri/appLock"),
        import("@src/store/appLock/appLockAtom"),
      ]);
    const store = getStore();
    if (!store.get(appLockEnabledAtom)) {
      dispatchNavigate(
        buildSettingsPath({ section: "general", tab: "app-lock" })
      );
      return false;
    }
    store.set(appLockStateAtom, await appLockApi.lock());
    return true;
  },

  /**
   * Leave the Settings surface, restoring the WorkStation URL the user came
   * from. Synchronous and guarded by the pathname so the close-tab shortcut
   * can ask "did this close Settings?" before falling through to the
   * WorkStation tab strip. Returns false when Settings is not open.
   */
  closeSettings(pathname: string = window.location.pathname): boolean {
    if (!isSettingsPath(pathname)) return false;
    const returnPath = getStore().get(settingsReturnPathAtom);
    dispatchNavigate(returnPath || ROUTES.workStation.base.path);
    return true;
  },

  async createAgentStationSession(): Promise<boolean> {
    const [
      { clearSessionAtom },
      { activeSessionIdAtom, workstationActiveSessionIdAtom },
      { stationModeAtom },
    ] = await Promise.all([
      import("@src/engines/SessionCore/core/atoms"),
      import("@src/store/session"),
      import("@src/store/ui/simulatorAtom"),
    ]);

    const store = getStore();
    store.set(clearSessionAtom);
    // Preserve WorkStation tabs/layout when opening a fresh Agent Station session.
    store.set(activeSessionIdAtom, null);
    store.set(workstationActiveSessionIdAtom, null);
    store.set(stationModeAtom, "agent-station");
    dispatchNavigate(ROUTES.workStation.base.path);
    return true;
  },
};
