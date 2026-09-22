// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import { Fragment, act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RouteSidebarBody } from "@src/scaffold/AppLayout/sidebar/RouteSidebarBody";
import type { Session } from "@src/store/session";
import { sessionsAtom } from "@src/store/session";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import {
  DesktopSessionRosterProvider,
  useDesktopSessionRoster,
} from "./DesktopSessionRosterProvider";

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  invoke: vi.fn(),
  mainWindow: true,
  closeOtherTabs: vi.fn(),
  showError: vi.fn(),
  cloudSection: vi.fn(),
}));
const emptySet = new Set<string>();
const emptyMap = new Map();
const emptyItems: never[] = [];
function noop() {
  return undefined;
}
const t = (key: string) => key;
const scopeAtom = atom("personal");
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t }) }));
vi.mock("@src/api/tauri/mobileRemote", () => ({
  syncSidebarSessions: mocks.publish,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@src/util/platform/tauri/windowIdentity", () => ({
  isMainAppWindow: () => mocks.mainWindow,
  isStationWindow: () => false,
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@src/hooks/logger", () => ({ createLogger: () => ({ warn: noop }) }));
vi.mock("@src/components/Message", () => ({
  default: { error: mocks.showError },
}));
vi.mock("@src/hooks/navigation/useAppNavigate", () => ({
  useAppNavigate: () => noop,
}));
vi.mock("@src/hooks/navigation/useAppNavigation", () => ({
  useAppNavigation: () => ({ goToNewSession: noop }),
}));
vi.mock("@src/features/Org2Cloud/org2CloudAuthAtom", async () => {
  const { atom } = await import("jotai");
  return {
    org2CloudAuthAtom: atom(null),
    org2CloudAuthIdentityKey: () => "user",
  };
});
vi.mock("@src/store/session", async () => {
  const { atom } = await import("jotai");
  const category = { generation: 0, phase: "exhausted" };
  return {
    sessionsAtom: atom([]),
    sessionLoadingAtom: atom(false),
    visitedSessionsAtom: atom(new Set()),
    workstationActiveSessionIdAtom: atom(null),
    sessionCreatorDraftListAtom: atom([]),
    sessionPaginationAtom: atom(new Proxy({}, { get: () => category })),
    SESSION_LIST_CATEGORIES: ["pinned_native", "rust_agent", "external"],
    createSidebarRosterMatcher: () => () => true,
    upsertSession: noop,
  };
});
vi.mock("@src/store/ui/sidebarAtom", async () => {
  const { atom } = await import("jotai");
  return {
    clearSessionSidebarRevealAtom: atom(null, noop),
    sessionSidebarRevealRequestAtom: atom(null),
    sessionBranchTagsVisibleAtom: atom(false),
  };
});
vi.mock("@src/store/session/agentLiveStatusAtom", async () => {
  const { atom } = await import("jotai");
  return { agentLiveStatusAtom: atom(new Map()) };
});
vi.mock("../sections/collapsePreference", async () => {
  const { atom } = await import("jotai");
  return { sidebarCustomCollapsedAtom: atom([]) };
});
vi.mock("../sections/useSidebarSections", () => ({
  useSidebarSections: () => ({ loadedIds: emptySet, membership: emptyMap }),
}));
vi.mock("./sidebarConnector.scopeAndPagination", async () => {
  const { useAtomValue } = await import("jotai");
  return {
    useWorkstationSidebarScopeAndPagination: ({
      sessions,
    }: {
      sessions: Session[];
    }) => {
      const scope = useAtomValue(scopeAtom);
      return {
        activeOrgId: scope,
        activeCloudOrgId: scope === "personal" ? null : scope,
        // Production selectors can return fresh arrays without any domain change.
        sortedSessions: [...sessions],
        groupByMode: "none",
        groupVisibleCount: 20,
        includeExternal: true,
        repoPathToName: emptyMap,
        orgSelectorLoading: false,
        cloudMySessionsVisibleCount: 20,
        handleCloudSessionFilterChange: noop,
      };
    },
  };
});
vi.mock("../workstationSidebarData", () => ({
  DEFAULT_COLLAPSED_SECTION_IDS: [],
}));
vi.mock("./sessionEntryActions", () => ({ openNewChatFromSidebar: noop }));
vi.mock("./sidebarConnector.chatPanelAtoms", () => ({
  useWorkstationSidebarChatPanelAtoms: () => ({
    setStationMode: noop,
    setStationChatVisible: noop,
    resetChatPanelSessionSurface: noop,
    openOrReplaceSessionInChatPanelTab: noop,
    closeOtherThanActiveChatPanelTabs: mocks.closeOtherTabs,
  }),
}));
vi.mock("./sidebarConnector.labels", () => ({
  buildWorkstationSidebarLabels: () => ({ untitledSession: "Untitled" }),
}));
vi.mock("./useWorkspaceGroupActions", () => ({
  useWorkspaceGroupActions: () => undefined,
}));
vi.mock("./cloudSessionsSection", () => ({
  useCloudSessionsSection: (options: unknown) => {
    mocks.cloudSection(options);
    return {
      cloudFlatListExcludedSessionIds: emptySet,
      cloudLocalSessionIds: emptySet,
      cloudMenuItems: emptyItems,
    };
  },
}));
vi.mock("./sidebarMenuCollections", () => ({
  useSessionSidebarMenuItems: ({ menuItems }: { menuItems: unknown }) =>
    menuItems,
}));
vi.mock("../useSessionMenuItems/useSessionPrStatuses", () => ({
  useSessionPrStatuses: () => noop,
}));
vi.mock("../useSessionMenuItems/menuItemBuilders", () => ({
  buildSessionMenuItem: ({ session }: { session: Session }) => ({
    id: session.session_id,
    key: session.session_id,
    label: session.name,
  }),
  separator: (id: string) => ({
    id: `separator-${id}`,
    key: `separator-${id}`,
    label: "",
  }),
}));
vi.mock("@src/scaffold/NavigationSidebar/connectors", () => ({
  WorkstationSidebarConnector: function RosterConsumer() {
    const { projection } = useDesktopSessionRoster();
    return createElement(
      "div",
      { "data-view": "sessions" },
      projection.menuItems.map((item) => item.label).join(",")
    );
  },
}));
vi.mock("@src/scaffold/NavigationSidebar/variants/SettingsSidebar", () => ({
  default: () => createElement("div", { "data-view": "settings" }),
}));

let root: ReturnType<typeof createSmokeRoot>;
let store: ReturnType<typeof createStore>;
const session = (id: string): Session => ({
  session_id: id,
  name: id,
  status: "completed",
  category: "rust_agent",
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T00:00:00Z",
});
const render = async (route: "session" | "settings", hover = false) => {
  await root.render(
    createElement(
      Provider,
      { store },
      createElement(
        MemoryRouter,
        null,
        createElement(
          DesktopSessionRosterProvider,
          null,
          createElement(
            Fragment,
            null,
            createElement(RouteSidebarBody, { layoutType: route }),
            hover
              ? createElement(RouteSidebarBody, { layoutType: route })
              : null
          )
        )
      )
    )
  );
};
const flush = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
beforeEach(() => {
  vi.useFakeTimers();
  mocks.mainWindow = true;
  mocks.closeOtherTabs.mockReset().mockResolvedValue(undefined);
  mocks.showError.mockReset();
  mocks.cloudSection.mockClear();
  mocks.publish.mockReset().mockResolvedValue(true);
  mocks.invoke.mockReset().mockResolvedValue([]);
  store = createStore();
  store.set(sessionsAtom, [session("first")]);
  root = createSmokeRoot();
});
afterEach(async () => {
  await root.unmount();
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  vi.useRealTimers();
});

it.each(["personal", "cloud-org"])(
  "cold settings route publishes %s roster and new sessions without mounting a session sidebar",
  async (scope) => {
    store.set(scopeAtom, scope);
    await render("settings");
    await flush();
    expect(root.container.querySelector('[data-view="sessions"]')).toBeNull();
    expect(mocks.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "first" }),
    ]);
    await act(async () => store.set(sessionsAtom, [session("second")]));
    await flush();
    expect(mocks.publish).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "second" }),
    ]);
  }
);

it("route changes and closing duplicate hover views cannot clear or steal the app roster", async () => {
  await render("session");
  await flush();
  await render("session", true);
  await render("session", false);
  await render("settings");
  await flush();
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  await act(async () => store.set(sessionsAtom, [session("renamed")]));
  await flush();
  await render("session");
  expect(root.container.textContent).toContain("renamed");
  expect(mocks.publish).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: "renamed" }),
  ]);
  expect(mocks.publish.mock.calls.every(([rows]) => rows.length > 0)).toBe(
    true
  );
});

it("detached-window roster consumers never publish or clear the main process snapshot", async () => {
  mocks.mainWindow = false;
  await render("session");
  await flush();
  await render("settings");
  await root.unmount();
  await flush();
  expect(mocks.publish).not.toHaveBeenCalled();
  root = createSmokeRoot();
});

it("stops view-only child hydration on settings while retaining roster updates", async () => {
  await render("session");
  await flush();
  expect(mocks.invoke).toHaveBeenCalledWith("es_get_child_sessions", {
    parentSessionId: "first",
  });
  await render("settings");
  mocks.invoke.mockClear();
  await act(async () => store.set(sessionsAtom, [session("new-on-settings")]));
  await flush();
  expect(mocks.publish).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: "new-on-settings" }),
  ]);
  expect(mocks.invoke).not.toHaveBeenCalled();
  await render("session");
  expect(mocks.invoke).toHaveBeenCalledWith("es_get_child_sessions", {
    parentSessionId: "new-on-settings",
  });
});

it("scope changes invalidate the previous application snapshot before replacement", async () => {
  await render("settings");
  await flush();
  await act(async () => {
    store.set(scopeAtom, "another-org");
    store.set(sessionsAtom, [session("other-org-session")]);
  });
  await flush();
  expect(
    mocks.publish.mock.calls
      .slice(-2)
      .map(([rows]) => rows.map(({ id }: { id: string }) => id))
  ).toEqual([[], ["other-org-session"]]);
});

it("reports a failed replace-all tab action without an unhandled rejection", async () => {
  mocks.closeOtherTabs.mockRejectedValueOnce(new Error("Unable to close tabs"));
  await render("session");
  await act(async () => {
    mocks.cloudSection.mock.lastCall![0].openSessionAtDestination(
      "replace-all",
      {
        sessionId: "first",
        title: "First",
      }
    );
  });
  expect(mocks.closeOtherTabs).toHaveBeenCalledOnce();
  expect(mocks.showError).toHaveBeenCalledWith("Unable to close tabs");
});
