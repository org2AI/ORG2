// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sectionGroupId, useSidebarSections } from "./useSidebarSections";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  page: vi.fn(),
  mutate: vi.fn(),
  upsert: vi.fn(),
  unlisten: vi.fn(),
  error: vi.fn(),
  listener: null as (() => void) | null,
  t: (key: string) => key,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, fn) => {
    mocks.listener = fn;
    return mocks.unlisten;
  }),
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    sessionAggregate: {
      sections: mocks.list,
      sectionPage: mocks.page,
      mutateSections: mocks.mutate,
    },
  },
}));
vi.mock("@src/api/tauri/session", () => ({
  toFrontendSession: (r: { sessionId: string }) => ({
    session_id: r.sessionId,
  }),
}));
vi.mock("@src/store/session", () => ({
  sessionsAtom: {},
  upsertSession: mocks.upsert,
}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({ get: () => [] }),
}));
vi.mock("@src/components/Message", () => ({ default: { error: mocks.error } }));
vi.mock("@src/components/Button", () => ({ default: () => null }));
vi.mock("@src/components/Input", () => ({ default: () => null }));
vi.mock("@src/scaffold/ModalSystem", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("@src/scaffold/NavigationSidebar/menus/SidebarMenu", () => ({
  popupSidebarMenu: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const snapshot = {
  sections: [{ id: "a", name: "Research", position: 0 }],
  members: [{ sessionId: "old", sectionId: "a" }],
};
let root: Root;
let node: HTMLDivElement;
let result: ReturnType<typeof useSidebarSections>;
const open = new Set<string>();
function Harness({
  enabled = true,
  collapsed = open,
}: {
  enabled?: boolean;
  collapsed?: ReadonlySet<string>;
}) {
  const controller = useSidebarSections(enabled, collapsed);
  useLayoutEffect(() => {
    result = controller;
  });
  return null;
}
async function render(props = {}) {
  await act(async () => {
    root.render(React.createElement(Harness, props));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  mocks.list.mockResolvedValue(snapshot);
  mocks.page.mockResolvedValue({
    sessions: [{ sessionId: "old" }],
    nextCursor: "old",
    hasMore: false,
  });
  mocks.mutate.mockResolvedValue({ sections: [], members: [] });
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe("personal section lifecycle", () => {
  it("hydrates an older member independently of the ordinary roster and retains it after section deletion", async () => {
    await render();
    expect(mocks.page).toHaveBeenCalledWith({
      id: "a",
      after: null,
      limit: 20,
    });
    expect(mocks.upsert).toHaveBeenCalledWith({ session_id: "old" });
    expect(result.loadedIds.has("old")).toBe(true);
    await act(async () => {
      await result.moveToSection("old", null);
    });
    expect(result.membership.has("old")).toBe(false);
    expect(result.loadedIds.has("old")).toBe(true);
  });
  it("loads collapsed sections only on expansion and does no hidden page work", async () => {
    await render({ collapsed: new Set([sectionGroupId("a")]) });
    expect(mocks.page).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await render();
    expect(mocks.page).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.page).toHaveBeenCalledTimes(1);
  });
  it("ignores late page completion after leaving the local sidebar", async () => {
    let resolve!: (value: unknown) => void;
    mocks.page.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await render();
    await render({ enabled: false });
    await act(async () => {
      resolve({
        sessions: [{ sessionId: "late" }],
        nextCursor: null,
        hasMore: false,
      });
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(result.loadedIds.size).toBe(0);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });
  it("advances the backend cursor even when a page has no remaining live sessions", async () => {
    mocks.page.mockResolvedValueOnce({
      sessions: [],
      nextCursor: "deleted",
      hasMore: true,
    });
    await render();
    await act(async () => {
      expect(result.handlePageClick("section-page-a")).toBe(true);
    });
    expect(mocks.page).toHaveBeenLastCalledWith({
      id: "a",
      after: "deleted",
      limit: 20,
    });
  });
  it("serializes first-page requests across expanded sections", async () => {
    mocks.list.mockResolvedValueOnce({
      ...snapshot,
      sections: [...snapshot.sections, { id: "b", name: "Later", position: 1 }],
    });
    let resolve!: (value: unknown) => void;
    mocks.page.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await render();
    expect(mocks.page).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ sessions: [], nextCursor: null, hasMore: false });
    });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    expect(mocks.page).toHaveBeenLastCalledWith({
      id: "b",
      after: null,
      limit: 20,
    });
  });
  it("keeps confirmed membership when a write fails", async () => {
    await render();
    mocks.mutate.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      expect(await result.moveToSection("old", null)).toBe(false);
    });
    expect(result.membership.get("old")).toBe("a");
    expect(mocks.error).toHaveBeenCalled();
  });
});
