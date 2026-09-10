// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { eventsAtom } from "@src/engines/SessionCore/core/atoms";

import { useRuntimeRamStats } from "./useRuntimeRamStats";

const mocks = vi.hoisted(() => ({
  read: vi.fn(() => ({
    bytes: 0,
    cachedEvents: 0,
    cachedSessions: 0,
    normalizedSessions: 0,
  })),
  t: (key: string) => key,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("@src/engines/SessionCore/core/atoms", () => ({
  eventsAtom: atom([]),
}));
vi.mock("@src/engines/SessionCore/core/atoms/events", () => ({
  derivedSnapshotAtom: atom(null),
}));
vi.mock("@src/store/session/sessionAtom/atoms", () => ({
  sessionsAtom: atom([]),
}));
vi.mock("@src/store/workstation/browser/browserAutomationAtom", () => ({
  screenshotCacheStatsAtom: atom({ totalBytes: 0 }),
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { getMemoryStats: mocks.read },
}));
vi.mock("@src/engines/SessionCore/payloads", () => ({
  getLoadedPayloadStats: () => ({ bytes: 0 }),
}));
vi.mock("@src/engines/SessionCore/turns/loadedTurnRegistry", () => ({
  getLoadedTurnRegistryStats: () => ({ bytes: 0 }),
}));
vi.mock("@src/engines/Simulator/apps/core/fullEventHydrationRegistry", () => ({
  getHydratedEventStats: () => ({ bytes: 0 }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("samples on demand without subscribing to session changes and cancels hidden FPS work", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let visible = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden"
  );
  const store = createStore();
  const host = document.createElement("div");
  const root = createRoot(host);
  let stats!: ReturnType<typeof useRuntimeRamStats>;
  let renders = 0;
  function Probe() {
    const value = useRuntimeRamStats(false);
    useEffect(() => {
      stats = value;
      renders++;
    });
    return null;
  }
  try {
    await act(async () =>
      root.render(createElement(Provider, { store }, createElement(Probe)))
    );
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => stats.refresh());
    expect(mocks.read).toHaveBeenCalledTimes(1);
    const sampledRenders = renders;
    await act(async () => store.set(eventsAtom, []));
    expect(renders).toBe(sampledRenders);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      visible = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => stats.refresh());
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      visible = true;
      stats.refresh();
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
  expect(vi.getTimerCount()).toBe(0);
});
