// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Session } from "@src/store/session";

import { useMobileSidebarSessions } from "./useMobileSidebarSessions";

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("@src/api/tauri/mobileRemote", () => ({
  syncSidebarSessions: mocks.publish,
}));
vi.mock("@src/features/Org2Cloud/org2CloudAuthAtom", async () => {
  const { atom } = await import("jotai");
  return {
    org2CloudAuthAtom: atom(null),
    org2CloudAuthIdentityKey: () => "identity",
  };
});
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

const session = (id: string, extra: Partial<Session> = {}): Session => ({
  session_id: id,
  name: `Stored ${id}`,
  status: "completed",
  created_at: "2026-09-09T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
  repoPath: "/workspace/project/",
  ...extra,
});
const item = (id: string): NavigationMenuItem => ({
  id,
  key: id,
  label: `Desktop ${id}`,
});
type Params = Parameters<typeof useMobileSidebarSessions>[0];
function Harness(props: Params) {
  useMobileSidebarSessions(props);
  return null;
}

describe("desktop connector's mobile sidebar publisher hook", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: Params;
  const render = async (patch: Partial<Params> = {}) => {
    props = { ...props, ...patch };
    await act(async () => root.render(createElement(Harness, props)));
  };
  const flush = async (ms = 100) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    mocks.publish.mockReset().mockResolvedValue(true);
    container = document.createElement("div");
    root = createRoot(container);
    props = {
      scope: "org-a",
      loading: false,
      items: [item("pin"), item("local")],
      sessionMap: new Map([
        ["pin", session("pin", { pinned: true })],
        ["local", session("local")],
      ]),
      repoPathToName: new Map([["/workspace/project", "Project"]]),
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    await flush(2000);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("publishes final desktop order/titles, pinned/local rows and workspace/status metadata only", async () => {
    await render({
      items: [
        item("separator"),
        item("pin"),
        item("cloud-remote"),
        item("local"),
        item("draft"),
        item("pin"),
      ],
      sessionMap: new Map([
        ["pin", session("pin", { pinned: true, status: "waiting_for_user" })],
        ["local", session("local")],
        ["not-rendered", session("not-rendered")],
      ]),
    });
    await flush();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls[0][0]).toEqual([
      {
        id: "pin",
        name: "Desktop pin",
        status: "running",
        repoPath: "/workspace/project",
        repoName: "Project",
        updatedAtMs: Date.parse("2026-09-10T00:00:00Z"),
      },
      {
        id: "local",
        name: "Desktop local",
        status: "idle",
        repoPath: "/workspace/project",
        repoName: "Project",
        updatedAtMs: Date.parse("2026-09-10T00:00:00Z"),
      },
    ]);
  });

  it("coalesces rename/reorder/status bursts and sends nothing while idle or unchanged", async () => {
    await render();
    await render({ items: [item("local")] });
    await render({
      items: [{ ...item("pin"), label: "Renamed" }],
      sessionMap: new Map([["pin", session("pin", { status: "running" })]]),
    });
    await flush();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls[0][0][0]).toMatchObject({
      name: "Renamed",
      status: "running",
    });
    await render({ items: [{ ...item("pin"), label: "Renamed" }] });
    await flush(60_000);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("bounds the published window to the backend's 200-row contract", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `row-${index}`);
    await render({
      items: ids.map(item),
      sessionMap: new Map(ids.map((id) => [id, session(id)])),
    });
    await flush();
    expect(mocks.publish.mock.calls[0][0]).toHaveLength(200);
    expect(mocks.publish.mock.calls[0][0].at(-1).id).toBe("row-199");
  });

  it("retries a failed unmount clear and republishes the same rows on remount", async () => {
    await render();
    await flush();
    mocks.publish.mockRejectedValueOnce(new Error("temporary IPC failure"));
    await act(async () => root.unmount());
    await flush(1500);
    expect(mocks.publish.mock.calls.slice(-2).map(([rows]) => rows)).toEqual([
      [],
      [],
    ]);
    root = createRoot(container);
    await render();
    await flush();
    expect(mocks.publish).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "pin" })])
    );
  });

  it("preserves rows while refreshing, publishes real empty, and clears old org before replacement", async () => {
    await render();
    await flush();
    await render({ loading: true, items: [] });
    await flush();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    await render({ loading: false });
    await flush();
    expect(mocks.publish).toHaveBeenLastCalledWith([]);
    await render({ scope: "org-b", items: [item("local")] });
    await flush();
    expect(
      mocks.publish.mock.calls
        .slice(-2)
        .map(([rows]) => rows.map((row: { id: string }) => row.id))
    ).toEqual([[], ["local"]]);
  });

  it("retries one failure, then waits for focus/online rather than polling", async () => {
    mocks.publish.mockRejectedValue(new Error("unavailable"));
    await render();
    await flush(5000);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    await flush(60_000);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    mocks.publish.mockResolvedValue(true);
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(mocks.publish).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "pin" })])
    );
  });

  it("serializes in-flight work, discards superseded org rows and clears on unmount", async () => {
    let finish: (() => void) | undefined;
    mocks.publish.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render();
    await flush();
    await render({ scope: "org-b", items: [item("local")] });
    await render({ scope: "org-c", items: [item("pin")] });
    await flush();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    finish?.();
    await flush();
    expect(
      mocks.publish.mock.calls
        .slice(1)
        .map(([rows]) => rows.map((row: { id: string }) => row.id))
    ).toEqual([[], ["pin"]]);
    await act(async () => root.unmount());
    await flush();
    expect(mocks.publish).toHaveBeenLastCalledWith([]);
    root = createRoot(container);
  });

  it("clears an in-flight old scope before publishing an immediate remount", async () => {
    let finish: (() => void) | undefined;
    mocks.publish.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render({ scope: "org-a", items: [item("pin")] });
    await flush();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ scope: "org-b", items: [item("local")] });
    finish?.();
    await flush();
    expect(
      mocks.publish.mock.calls
        .slice(1)
        .map(([rows]) => rows.map((row: { id: string }) => row.id))
    ).toEqual([[], ["local"]]);
  });
});
