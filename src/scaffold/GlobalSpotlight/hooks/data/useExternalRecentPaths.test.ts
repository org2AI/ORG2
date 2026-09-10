// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExternalRecentPaths } from "./useExternalRecentPaths";

const mocks = vi.hoisted(() => ({
  sources: Array.from({ length: 8 }, () => vi.fn()),
}));
vi.mock("@src/api/tauri/externalHistory", () => ({
  codexAppRecentPaths: mocks.sources[0],
  claudeCodeRecentPaths: mocks.sources[1],
  cursorCliRecentPaths: mocks.sources[2],
  opencodeRecentPaths: mocks.sources[3],
  windsurfRecentPaths: mocks.sources[4],
  warpRecentPaths: mocks.sources[5],
  zcodeRecentPaths: mocks.sources[6],
  qoderRecentPaths: mocks.sources[7],
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));
const existing = Array.from({ length: 10 }, (_, index) => `/saved/${index}`);
function Probe({
  enabled = true,
  query = "",
}: {
  enabled?: boolean;
  query?: string;
}) {
  const { recentPathRepos } = useExternalRecentPaths({
    enabled,
    existingRepoPaths: existing,
    searchQuery: query,
  });
  return createElement(
    "div",
    null,
    recentPathRepos.map((repo) => repo.fs_uri).join(",")
  );
}
const record = (path: string) => ({
  path,
  lastUsedAt: "2026-09-07",
  sessionCount: 1,
});

describe("external-app discovery lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    mocks.sources.forEach((source) => source.mockReset().mockResolvedValue([]));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("loads with many saved repos, deduplicates paths, and filters without rescanning", async () => {
    mocks.sources[0].mockResolvedValue([
      record("/external"),
      record("/saved/0"),
    ]);
    mocks.sources[1].mockResolvedValue([record("file:///external/")]);
    await act(async () => root.render(createElement(Probe)));
    expect(container.textContent).toBe("/external");
    await act(async () =>
      root.render(createElement(Probe, { query: "missing" }))
    );
    expect(container.textContent).toBe("");
    mocks.sources.forEach((source) => expect(source).toHaveBeenCalledTimes(1));
  });
  it("shares a pending batch and retains successful apps when another fails", async () => {
    mocks.sources[0].mockRejectedValue(new Error("unavailable"));
    mocks.sources[1].mockResolvedValue([record("/available")]);
    await act(async () =>
      root.render(
        createElement("div", null, createElement(Probe), createElement(Probe))
      )
    );
    expect(container.textContent).toBe("/available/available");
    mocks.sources.forEach((source) => expect(source).toHaveBeenCalledTimes(1));
  });
  it("does no work while closed or hidden and loads on visibility return", async () => {
    await act(async () =>
      root.render(createElement(Probe, { enabled: false }))
    );
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => root.render(createElement(Probe)));
    mocks.sources.forEach((source) => expect(source).not.toHaveBeenCalled());
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    mocks.sources.forEach((source) => expect(source).toHaveBeenCalledTimes(1));
  });
  it("discards a late result after closing and revalidates on reopen", async () => {
    let resolve!: (value: ReturnType<typeof record>[]) => void;
    mocks.sources[0].mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    await act(async () => root.render(createElement(Probe)));
    await act(async () =>
      root.render(createElement(Probe, { enabled: false }))
    );
    await act(async () => resolve([record("/late")]));
    expect(container.textContent).toBe("");
    mocks.sources[0].mockResolvedValue([record("/fresh")]);
    await act(async () => root.render(createElement(Probe)));
    expect(container.textContent).toBe("/fresh");
  });
});
