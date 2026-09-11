// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitFile } from "@src/types/git/types";

import { useFileGitBaseline } from "./useFileGitBaseline";

const mocks = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn() }));
vi.mock("@src/services/git/workingTreeDiffResource", () => ({
  loadWorkingTreeDiff: mocks.load,
  releaseWorkingTreeDiff: mocks.release,
}));
const file = (path: string): GitFile => ({
  id: path,
  path,
  status: "modified",
  staged: false,
  additions: 0,
  deletions: 0,
});
let root: Root;
let latest: string | undefined;
function Harness({
  entry,
  active = true,
}: {
  entry: GitFile;
  active?: boolean;
}) {
  const baseline = useFileGitBaseline(entry, "/repo", active, "disk contents");
  useEffect(() => {
    latest = baseline;
  }, [baseline]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.load.mockReset();
  mocks.release.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("useFileGitBaseline", () => {
  it("fetches HEAD when M status has metadata but no body", async () => {
    mocks.load.mockResolvedValue({
      oldContent: "HEAD contents",
      binary: false,
    });
    await act(async () =>
      root.render(createElement(Harness, { entry: file("a.ts") }))
    );
    expect(latest).toBe("HEAD contents");
    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: "/repo",
        file: expect.objectContaining({ path: "a.ts", status: "modified" }),
      })
    );
  });

  it("does not fetch for inactive tabs or new files", async () => {
    await act(async () =>
      root.render(
        createElement(Harness, { entry: file("a.ts"), active: false })
      )
    );
    expect(mocks.load).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        createElement(Harness, {
          entry: { ...file("new.ts"), status: "added" },
        })
      )
    );
    expect(latest).toBe("");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("ignores stale responses after switching file and releases the old resource", async () => {
    let resolve!: (value: { oldContent: string; binary: boolean }) => void;
    mocks.load
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce({ oldContent: "B", binary: false });
    await act(async () =>
      root.render(createElement(Harness, { entry: file("a.ts") }))
    );
    await act(async () =>
      root.render(createElement(Harness, { entry: file("b.ts") }))
    );
    await act(async () => resolve({ oldContent: "A", binary: false }));
    expect(latest).toBe("B");
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ path: "a.ts" }),
      })
    );
  });

  it("does not invent an empty HEAD baseline on missing or failed loads", async () => {
    mocks.load
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("offline"));
    await act(async () =>
      root.render(createElement(Harness, { entry: file("a.ts") }))
    );
    expect(latest).toBeUndefined();
    await act(async () =>
      root.render(createElement(Harness, { entry: file("b.ts") }))
    );
    expect(latest).toBeUndefined();
  });
});
