// @vitest-environment jsdom
import { listen } from "@tauri-apps/api/event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";
import {
  reachableFilesMatching,
  walkStaticImports,
} from "@src/test/staticImportGraph";

import { useTauriListen } from "./useTauriListen";

type TauriHandler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, TauriHandler>(),
  unlisten: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: TauriHandler) => {
    mocks.handlers.set(name, handler);
    return mocks.unlisten;
  }),
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    error: mocks.error,
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

interface HarnessProps {
  event?: string | null;
  handler: (payload: unknown) => void;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

function Harness({
  event = "demo-event",
  handler,
  enabled,
  onError,
}: HarnessProps): null {
  useTauriListen(event, handler, { enabled, onError });
  return null;
}

async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("useTauriListen", () => {
  let root: SmokeRoot;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.handlers.clear();
    root = createSmokeRoot();
  });

  afterEach(async () => {
    await root.unmount();
    vi.useRealTimers();
  });

  it("subscribes once and delivers payloads to the latest handler", async () => {
    const first = vi.fn();
    const second = vi.fn();

    await root.render(createElement(Harness, { handler: first }));
    await root.render(createElement(Harness, { handler: second }));
    await flushMicrotasks();

    expect(listen).toHaveBeenCalledTimes(1);
    mocks.handlers.get("demo-event")?.({ payload: { id: 1 } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ id: 1 });
  });

  it("defers unlisten to the next macrotask and silences the handler meanwhile", async () => {
    const handler = vi.fn();
    await root.render(createElement(Harness, { handler }));
    await flushMicrotasks();

    await root.unmount();
    expect(mocks.unlisten).not.toHaveBeenCalled();

    mocks.handlers.get("demo-event")?.({ payload: "late" });
    expect(handler).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens a registration that resolves after cleanup", async () => {
    let resolve!: (unlisten: () => void) => void;
    vi.mocked(listen).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );

    await root.render(createElement(Harness, { handler: vi.fn() }));
    await root.unmount();
    expect(mocks.unlisten).not.toHaveBeenCalled();

    resolve(mocks.unlisten);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe while disabled and follows enabled toggles", async () => {
    const handler = vi.fn();

    await root.render(createElement(Harness, { handler, enabled: false }));
    await flushMicrotasks();
    expect(listen).not.toHaveBeenCalled();

    await root.render(createElement(Harness, { handler, enabled: true }));
    await flushMicrotasks();
    expect(listen).toHaveBeenCalledTimes(1);

    await root.render(createElement(Harness, { handler, enabled: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe without an event name", async () => {
    await root.render(
      createElement(Harness, { event: null, handler: vi.fn() })
    );
    await flushMicrotasks();

    expect(listen).not.toHaveBeenCalled();
  });

  it("routes registration failures to onError, logging by default", async () => {
    const failure = new Error("registration failed");
    vi.mocked(listen).mockRejectedValueOnce(failure);
    await root.render(createElement(Harness, { handler: vi.fn() }));
    await flushMicrotasks();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error.mock.calls[0]?.[1]).toBe(failure);

    await root.unmount();
    const onError = vi.fn();
    vi.mocked(listen).mockRejectedValueOnce(failure);
    root = createSmokeRoot();
    await root.render(createElement(Harness, { handler: vi.fn(), onError }));
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
});

describe("useTauriListen static import graph", () => {
  it("does not reach the tauri platform index and its import-time patch timers", () => {
    // `util/platform/tauri/index.ts` runs patchTauriInternals() at import and
    // re-arms setTimeout retries for ~1.7s when the Tauri globals are absent.
    // A test that installs fake timers mid-chain then sees a phantom pending
    // timer. Every hook consumer would inherit that, so the hook must only
    // import the side-effect-free leaf module.
    const graph = walkStaticImports(["hooks/platform/useTauriListen.ts"]);
    expect(
      reachableFilesMatching(graph, /^util\/platform\/tauri\/index\.ts$/)
    ).toEqual([]);
  });
});
