// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWeeklyQuotaHistory,
  useWeeklyQuotaSampler,
} from "./useWeeklyQuotaHistory";

const mocks = vi.hoisted(() => ({
  identity: "initial",
  read: vi.fn(),
  sample: vi.fn(),
  due: vi.fn(),
  listeners: new Set<(signature: string) => void>(),
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    validation: {
      getWeeklyQuotaHistory: mocks.read,
      sampleWeeklyQuota: mocks.sample,
      listDueWeeklyQuotaAccounts: mocks.due,
    },
  },
}));
vi.mock("./weeklyQuotaAccounts", () => ({
  currentWeeklyQuotaAccountSignature: () => mocks.identity,
  subscribeWeeklyQuotaAccountChanges: (
    listener: (signature: string) => void
  ) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.identity = "initial";
});
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  mocks.read.mockReset();
  mocks.sample.mockReset();
  mocks.due.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Consumer() {
  const state = useWeeklyQuotaHistory();
  return createElement(
    "span",
    null,
    state.accounts.map((a) => a.name).join(",")
  );
}
async function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(Consumer));
  });
  return container;
}
const row = (name: string) => ({
  keyId: name,
  name,
  provider: "codex",
  status: "ok",
  points: [],
});

describe("useWeeklyQuotaHistory", () => {
  it("shares concurrent reads without requesting provider samples", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let resolve!: (value: unknown[]) => void;
    mocks.read.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const a = await mount();
    const b = await mount();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => resolve([row("one")]));
    expect(a.textContent).toBe("one");
    expect(b.textContent).toBe("one");
    expect(mocks.sample).not.toHaveBeenCalled();
  });
  it("rejects the old response after an account change", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let old!: (value: unknown[]) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          old = r;
        })
    );
    const container = await mount();
    mocks.read.mockResolvedValueOnce([row("new")]);
    await act(async () => {
      mocks.identity = "changed-account";
      for (const listener of mocks.listeners) listener(mocks.identity);
    });
    await act(async () => old([row("old")]));
    expect(container.textContent).toBe("new");
  });
  it("samples due account IDs without reading chart history", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mocks.due.mockResolvedValue(["one", "two"]);
    mocks.sample.mockResolvedValue(null);
    function Sampler() {
      useWeeklyQuotaSampler();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    roots.push(root);
    await act(async () => root.render(createElement(Sampler)));
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.sample.mock.calls).toEqual([
      [{ keyId: "one" }],
      [{ keyId: "two" }],
    ]);
  });
  it("does not join a previous identity's pending read after all consumers remount", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let old!: (value: unknown[]) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        })
    );
    await mount();
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    mocks.identity = "new-account";
    mocks.read.mockResolvedValueOnce([row("new")]);
    const container = await mount();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => old([row("old")]));
    expect(container.textContent).toBe("new");
  });
});
