// @vitest-environment jsdom
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROUTES } from "@src/config/routes";
import { activeSessionIdAtom } from "@src/store/session/viewAtom";
import { chatPanelCreateTargetAtom } from "@src/store/ui/chatPanel/selectionAtoms";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationChatVisibilityAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { manualCreatorAtom } from "@src/store/ui/manualCreatorAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";

import { chatPanelTabsAtom } from "../chatPanelTabsState";
import { openChatPanelCreateTargetAtom } from "../openChatPanelCreateTargetAtom";

describe("openChatPanelCreateTargetAtom", () => {
  const originalPath = window.location.pathname;
  beforeEach(() =>
    window.history.replaceState(null, "", ROUTES.workStation.code.path)
  );
  afterEach(() => window.history.replaceState(null, "", originalPath));
  function setup(launchpad: boolean) {
    const store = createStore();
    store.set(stationModeAtom, "my-station");
    store.set(chatPanelMaximizedAtom, false);
    store.set(chatWidthAtom, 400);
    store.set(stationChatVisibilityAtom, {
      "my-station": true,
      "agent-station": true,
    });
    store.set(chatPanelTabsAtom, {
      tabs: launchpad
        ? [{ id: "launchpad", type: "start-page", title: "Launchpad" }]
        : [
            {
              id: "session",
              type: "session",
              title: "Session",
              sessionId: "session-a",
            },
          ],
      activeTabId: launchpad ? "launchpad" : "session",
    });
    return store;
  }

  it.each(["project", "workItem"] as const)(
    "opens %s over the active session with its organization",
    (target) => {
      const store = setup(false);
      const tabs = store.get(chatPanelTabsAtom);
      store.set(activeSessionIdAtom, "session-a");
      store.set(spotlightOpenAtom, true);
      const request = {
        target,
        createProjectContext: {
          orgId: "org-a",
          scopeBreadcrumbLabel: "Team A",
        },
      };
      store.set(openChatPanelCreateTargetAtom, request);
      expect(store.get(manualCreatorAtom)).toEqual(request);
      expect(store.get(spotlightOpenAtom)).toBe(false);
      expect(store.get(chatPanelTabsAtom)).toBe(tabs);
      expect(store.get(activeSessionIdAtom)).toBe("session-a");
      store.set(spotlightOpenAtom, false);
      expect(store.get(chatPanelTabsAtom)).toBe(tabs);
    }
  );

  it.each(["project", "workItem"] as const)(
    "keeps %s in the visible Launchpad",
    (target) => {
      const store = setup(true);
      store.set(openChatPanelCreateTargetAtom, { target });
      expect(store.get(manualCreatorAtom)).toBeNull();
      expect(store.get(chatPanelCreateTargetAtom)).toBe(target);
      expect(store.get(chatPanelTabsAtom).activeTabId).toBe("launchpad");
    }
  );

  it("opens over Settings even when the remembered tab is Launchpad", () => {
    const store = setup(true);
    window.history.replaceState(null, "", ROUTES.app.settings.path);
    store.set(openChatPanelCreateTargetAtom, { target: "project" });
    expect(store.get(manualCreatorAtom)?.target).toBe("project");
    expect(window.location.pathname).toBe(ROUTES.app.settings.path);
  });

  it("does not navigate to a hidden Launchpad", () => {
    const store = setup(true);
    store.set(stationChatVisibilityAtom, {
      "my-station": false,
      "agent-station": true,
    });
    store.set(openChatPanelCreateTargetAtom, { target: "project" });
    expect(store.get(manualCreatorAtom)?.target).toBe("project");
    expect(store.get(stationChatVisibilityAtom)["my-station"]).toBe(false);
  });
  it("preserves in-page creation on a maximized Launchpad even if station chat is hidden", () => {
    const store = setup(true);
    store.set(chatPanelMaximizedAtom, true);
    store.set(stationChatVisibilityAtom, {
      "my-station": false,
      "agent-station": false,
    });
    store.set(openChatPanelCreateTargetAtom, { target: "workItem" });
    expect(store.get(manualCreatorAtom)).toBeNull();
    expect(store.get(chatPanelCreateTargetAtom)).toBe("workItem");
  });

  it("uses Spotlight when the Launchpad slot has zero width", () => {
    const store = setup(true);
    store.set(chatWidthAtom, 0);
    store.set(openChatPanelCreateTargetAtom, { target: "workItem" });
    expect(store.get(manualCreatorAtom)?.target).toBe("workItem");
  });
});
