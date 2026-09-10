// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTraySessions } from "./index";

const mocks = vi.hoisted(() => ({
  effect: undefined as (() => (() => void) | undefined) | undefined,
  label: "main",
  desktop: true,
  rows: [
    {
      session_id: "one",
      name: "First",
      updated_at: "2026-09-07",
      status: "running",
    },
  ],
  visited: new Set<string>(),
  subscriptions: new Map<string, () => void>(),
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  navigate: vi.fn(),
  set: vi.fn(),
  markAllRead: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (effect: typeof mocks.effect) => {
    mocks.effect = effect;
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => {
    throw new Error("Tray bootstrap must not require Router context");
  },
}));
vi.mock("jotai", () => ({
  useStore: () => ({
    get: (key: string) => (key === "sessions" ? mocks.rows : mocks.visited),
    set: mocks.set,
    sub: (key: string, callback: () => void) => {
      mocks.subscriptions.set(key, callback);
      return () => mocks.subscriptions.delete(key);
    },
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: mocks.label }),
}));
vi.mock("@src/util/platform/tauri", () => ({
  isTauriDesktop: () => mocks.desktop,
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: vi.fn() }),
}));
vi.mock("@src/store/session", () => ({
  markAllSessionsVisited: mocks.markAllRead,
  sessionsAtom: "sessions",
  visitedSessionsAtom: "visited",
}));
vi.mock("@src/store/chatPanel/chatPanelTabsAtom", () => ({
  openOrFocusSessionInChatPanelTabAtom: "open",
  openRuntimeInChatPanelTabAtom: "runtime",
  openWorkManagementChatPanelTabAtom: "kanban",
}));
vi.mock("@src/store/ui/chatPanel/visibilityAtoms", () => ({
  activeStationChatVisibleAtom: "visible",
}));
vi.mock("@src/store/ui/simulatorAtom", () => ({ stationModeAtom: "station" }));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "dispatchEvent").mockImplementation(mocks.navigate);
  mocks.label = "main";
  mocks.desktop = true;
  mocks.subscriptions.clear();
  mocks.invoke.mockResolvedValue(null);
  mocks.listen.mockResolvedValue(mocks.unlisten);
});

describe("useTraySessions production bridge", () => {
  it("publishes the initial roster, subscribes to changes and disposes resources", async () => {
    useTraySessions();
    const stop = mocks.effect?.();
    await tick();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "tray_update_sessions",
      expect.objectContaining({
        sections: expect.arrayContaining([
          expect.objectContaining({
            sessions: [{ id: "one", title: "First" }],
          }),
        ]),
      })
    );
    expect(mocks.subscriptions.size).toBe(2);
    const original = mocks.rows;
    mocks.rows = [{ ...original[0], name: "Renamed" }];
    mocks.subscriptions.get("sessions")?.();
    await tick();
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "tray_update_sessions",
      expect.objectContaining({
        sections: expect.arrayContaining([
          expect.objectContaining({
            sessions: [{ id: "one", title: "Renamed" }],
          }),
        ]),
      })
    );
    mocks.rows = original;
    stop?.();
    expect(mocks.subscriptions.size).toBe(0);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("opens a pending cold-start selection through the session tab action", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "tray_take_pending_action"
          ? { kind: "session", id: "not-yet-hydrated" }
          : null
      )
    );
    useTraySessions();
    const stop = mocks.effect?.();
    await tick();
    expect(mocks.set).toHaveBeenCalledWith(
      "open",
      expect.objectContaining({ sessionId: "not-yet-hydrated" })
    );
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.navigate.mock.calls[0][0]).toMatchObject({
      type: "action-system-navigate",
      detail: { path: "/orgii/workstation" },
    });
    stop?.();
  });

  it.each(["kanban", "runtime"])(
    "opens the %s top action and navigates to the workbench",
    async (kind) => {
      mocks.invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === "tray_take_pending_action" ? { kind } : null
        )
      );
      useTraySessions();
      const stop = mocks.effect?.();
      await tick();
      expect(mocks.set).toHaveBeenCalledWith(
        kind,
        kind === "kanban" ? {} : "chat.startPage.tabs.runtime"
      );
      expect(mocks.set).toHaveBeenCalledWith("visible", "my-station", true);
      expect(mocks.navigate.mock.calls[0][0]).toMatchObject({
        type: "action-system-navigate",
        detail: { path: "/orgii/workstation" },
      });
      stop?.();
    }
  );

  it("marks every loaded unread session in one batch and refreshes the tray without navigation", async () => {
    const original = mocks.rows;
    mocks.rows = [
      ...Array.from({ length: 7 }, (_, i) => ({
        ...original[0],
        session_id: `unread-${i}`,
        status: "completed",
      })),
      Object.assign(
        { ...original[0], session_id: "pinned", status: "completed" },
        { pinned: true }
      ),
      { ...original[0], session_id: "read", status: "completed" },
      { ...original[0], session_id: "archived", status: "archived" },
      original[0],
    ];
    mocks.visited = new Set(["read"]);
    mocks.markAllRead.mockImplementationOnce((ids: string[]) => {
      ids.forEach((id) => mocks.visited.add(id));
      mocks.subscriptions.get("visited")?.();
    });
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "tray_take_pending_action" ? { kind: "markAllRead" } : null
      )
    );
    useTraySessions();
    const stop = mocks.effect?.();
    try {
      await tick();
      expect(mocks.markAllRead).toHaveBeenCalledOnce();
      expect(mocks.markAllRead).toHaveBeenCalledWith([
        ...Array.from({ length: 7 }, (_, i) => `unread-${i}`),
        "pinned",
      ]);
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.set).not.toHaveBeenCalled();
      const updates = mocks.invoke.mock.calls.filter(
        ([command]) => command === "tray_update_sessions"
      );
      const sections = updates.at(-1)?.[1].sections;
      expect(
        sections.find(
          (section: { title: string }) => section.title === "tray.unread (0)"
        ).sessions
      ).toEqual([]);
    } finally {
      stop?.();
      mocks.rows = original;
      mocks.visited = new Set();
    }
  });

  it("detaches an asynchronously installed listener after unmount", async () => {
    let resolve!: (stop: () => void) => void;
    mocks.listen.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    useTraySessions();
    const stop = mocks.effect?.();
    stop?.();
    resolve(mocks.unlisten);
    await tick();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalledWith("tray_take_pending_action");
  });

  it("does not allow secondary windows or browsers to own the tray", () => {
    mocks.label = "session-one";
    useTraySessions();
    mocks.effect?.();
    mocks.label = "main";
    mocks.desktop = false;
    useTraySessions();
    mocks.effect?.();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.subscriptions.size).toBe(0);
  });
});
