// @vitest-environment jsdom
import { Fragment, act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type {
  ConnectionHarness,
  HarnessConnectionView,
} from "@src/api/tauri/rpc/schemas/agentOrgs";

import {
  refreshHarnessConnections,
  useHarnessConnection,
} from "./useHarnessConnection";

const mocks = vi.hoisted(() => ({ status: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { agentOrgs: { connections: { status: mocks.status } } },
}));

type Subscription = {
  handler: (event: { payload: string }) => void;
  stop: ReturnType<typeof vi.fn>;
};
type Snapshot = ReturnType<typeof useHarnessConnection>;
const snapshots = new Map<string, Snapshot>();
let subscriptions: Subscription[];
let hidden: boolean;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let mounted: boolean;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function view(
  agentName: ConnectionHarness,
  version: string
): HarnessConnectionView {
  return {
    version,
    installed: true,
    choices: [],
    config: {
      agentName,
      supported: true,
      mode: "default",
      hasDefaultBackup: false,
      conflict: false,
      targetFiles: [],
    },
  };
}

function Probe({
  agentName,
  slot = "main",
}: {
  agentName: ConnectionHarness;
  slot?: string;
}) {
  const state = useHarnessConnection(agentName);
  useEffect(() => {
    snapshots.set(slot, state);
  }, [slot, state]);
  return createElement(
    "output",
    { "data-testid": slot },
    JSON.stringify({
      version: state.view?.version ?? null,
      loading: state.loading,
      error: state.error,
    })
  );
}

async function render(agentName: ConnectionHarness) {
  await act(async () => root.render(createElement(Probe, { agentName })));
}

async function unmount() {
  if (mounted) {
    await act(async () => root.unmount());
    mounted = false;
  }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  refreshHarnessConnections();
  mocks.status.mockReset();
  mocks.listen.mockReset();
  snapshots.clear();
  subscriptions = [];
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  mocks.status.mockImplementation(
    ({ agentName }: { agentName: ConnectionHarness }) =>
      Promise.resolve(view(agentName, `read-${mocks.status.mock.calls.length}`))
  );
  mocks.listen.mockImplementation(
    async (_event: string, handler: Subscription["handler"]) => {
      const stop = vi.fn();
      subscriptions.push({ handler, stop });
      return stop;
    }
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(async () => {
  await unmount();
  container.remove();
  refreshHarnessConnections();
  vi.restoreAllMocks();
});

it("refreshes only when the native event names this connection target", async () => {
  await render("claude_desktop");
  expect(mocks.listen).toHaveBeenCalledWith(
    "native-history-state-changed",
    expect.any(Function)
  );
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await act(async () => subscriptions[0].handler({ payload: "codex" }));
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await act(async () =>
    subscriptions[0].handler({ payload: "claude_desktop" })
  );
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(mocks.status).toHaveBeenLastCalledWith({
    agentName: "claude_desktop",
  });
  expect(snapshots.get("main")?.view?.version).toBe("read-2");
});

it("skips native events and focus while hidden and refreshes on visible focus", async () => {
  await render("codex");
  hidden = true;
  await act(async () => {
    subscriptions[0].handler({ payload: "codex" });
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.status).toHaveBeenCalledTimes(1);
  hidden = false;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(snapshots.get("main")?.view?.version).toBe("read-2");
  await unmount();
  expect(subscriptions[0].stop).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  expect(mocks.status).toHaveBeenCalledTimes(2);
});

it("cleans a listener that resolves after unmount and rejects late read completion", async () => {
  const response = deferred<HarnessConnectionView>();
  const listening = deferred<() => void>();
  const stop = vi.fn();
  let handler!: Subscription["handler"];
  mocks.status.mockReturnValue(response.promise);
  mocks.listen.mockImplementationOnce(
    (_event: string, callback: Subscription["handler"]) => {
      handler = callback;
      return listening.promise;
    }
  );
  await render("codex");
  let reload!: ReturnType<Snapshot["reload"]>;
  await act(async () => {
    reload = snapshots.get("main")!.reload();
  });
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await unmount();
  await act(async () => {
    listening.resolve(stop);
    response.resolve(view("codex", "late-private-version"));
    expect(await reload).toEqual({ status: "stale" });
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("");
  expect(snapshots.get("main")?.view).toBeNull();
  handler({ payload: "codex" });
  window.dispatchEvent(new Event("focus"));
  refreshHarnessConnections();
  expect(mocks.status).toHaveBeenCalledTimes(1);
});

it("does not publish an old target's response after switching connections", async () => {
  const codex = deferred<HarnessConnectionView>();
  const claude = deferred<HarnessConnectionView>();
  mocks.status.mockImplementation(
    ({ agentName }: { agentName: ConnectionHarness }) =>
      agentName === "codex" ? codex.promise : claude.promise
  );
  await render("codex");
  await render("claude_desktop");
  expect(subscriptions[0].stop).toHaveBeenCalledTimes(1);
  await act(async () => {
    subscriptions[0].handler({ payload: "codex" });
    codex.resolve(view("codex", "old-target-version"));
  });
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(snapshots.get("main")?.view).toBeNull();
  expect(snapshots.get("main")?.loading).toBe(true);
  expect(container.textContent).not.toContain("old-target-version");
  await act(async () =>
    claude.resolve(view("claude_desktop", "current-target-version"))
  );
  expect(snapshots.get("main")?.view?.version).toBe("current-target-version");
  expect(snapshots.get("main")?.loading).toBe(false);
});

it("shares one in-flight read across consumers and bursty native notifications", async () => {
  const response = deferred<HarnessConnectionView>();
  mocks.status.mockReturnValueOnce(response.promise);
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Probe, { agentName: "codex", slot: "first" }),
        createElement(Probe, { agentName: "codex", slot: "second" })
      )
    )
  );
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await act(async () => {
    for (const subscription of subscriptions) {
      subscription.handler({ payload: "codex" });
      subscription.handler({ payload: "codex" });
    }
    response.resolve(view("codex", "shared-version"));
  });
  expect(mocks.status).toHaveBeenCalledTimes(1);
  expect(snapshots.get("first")?.view?.version).toBe("shared-version");
  expect(snapshots.get("second")?.view?.version).toBe("shared-version");
  await act(async () => refreshHarnessConnections());
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(snapshots.get("first")?.view?.version).toBe("read-2");
  expect(snapshots.get("second")?.view?.version).toBe("read-2");
  await unmount();
  expect(subscriptions.every(({ stop }) => stop.mock.calls.length === 1)).toBe(
    true
  );
});
