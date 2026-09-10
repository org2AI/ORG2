// @vitest-environment jsdom
import { StrictMode, act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLinkPullRequest } from "./useLinkPullRequest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const getPRLocal = vi.hoisted(() => vi.fn());
vi.mock("@src/api/tauri/github", () => ({ getPRLocal }));
let latest: ReturnType<typeof useLinkPullRequest>;
function Probe({ url }: { url: string }) {
  const value = useLinkPullRequest(url);
  useEffect(() => {
    latest = value;
  });
  return null;
}
const url = "https://github.com/org/repo/pull/42";
const container = document.createElement("div");
let root = createRoot(container);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(container);
  getPRLocal.mockReset();
});
async function render(value = url) {
  await act(async () => {
    root.render(
      createElement(StrictMode, null, createElement(Probe, { url: value }))
    );
  });
}
describe("mounted PR preview", () => {
  it("reads file count from PR details and preserves zero", async () => {
    getPRLocal.mockResolvedValue({ state: "open", changed_files: 0 });
    await render();
    expect(latest.filesChanged).toBe(0);
  });
  it("does not fetch ordinary URLs", async () => {
    await render("https://example.com");
    expect(getPRLocal).not.toHaveBeenCalled();
  });
  it.each([
    [{ state: "open" }, "open"],
    [{ state: "open", draft: true }, "draft"],
    [{ state: "closed" }, "closed"],
    [{ state: "closed", merged: true }, "merged"],
  ])(
    "loads the title and state %j once across effect replay and opening",
    async (fields, status) => {
      getPRLocal.mockResolvedValue({ title: "Fix card status", ...fields });
      await render();
      expect(latest.data?.prTitle).toBe("Fix card status");
      expect(latest.data?.prStatus).toBe(status);
      await latest.load();
      expect(getPRLocal).toHaveBeenCalledTimes(1);
      expect(getPRLocal).toHaveBeenCalledWith("org/repo", 42);
    }
  );
  it("shares a pending preview request with Open PR", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    getPRLocal.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    await render();
    expect(latest.loading).toBe(true);
    const opening = latest.load();
    await act(async () => {
      resolve({ title: "Shared", state: "open" });
      await opening;
    });
    expect(getPRLocal).toHaveBeenCalledTimes(1);
  });
  it("ignores a late result for a different URL", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    getPRLocal.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    await render();
    getPRLocal.mockResolvedValue({ title: "New PR", merged: true });
    await render("https://github.com/org/repo/pull/43");
    await act(async () => {
      resolve({ title: "Old PR", state: "open" });
    });
    expect(latest.data?.prTitle).toBe("New PR");
  });
  it("leaves failed status unknown and allows an explicit retry", async () => {
    getPRLocal.mockRejectedValue(new Error("offline"));
    await render();
    expect(latest.loading).toBe(false);
    expect(latest.data).toBeNull();
    getPRLocal.mockResolvedValue({ state: "closed" });
    await latest.load();
    expect(getPRLocal).toHaveBeenCalledTimes(2);
  });
  it("discards completed data on close and fetches fresh data when reopened", async () => {
    getPRLocal.mockResolvedValue({ state: "open" });
    await render();
    act(() => root.unmount());
    root = createRoot(container);
    getPRLocal.mockResolvedValue({ merged: true });
    await render();
    expect(getPRLocal).toHaveBeenCalledTimes(2);
    expect(latest.data?.prStatus).toBe("merged");
  });
});
