// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBrowserAutomation } from "./useBrowserAutomation";

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@src/util/platform/tauri/init", () => ({
  listenTauri: listen,
  invokeTauri: vi.fn(),
}));
vi.mock("@src/api/tauri/sidecars", () => ({
  OPTIONAL_SIDECAR: {},
  ensureSidecarInstalled: vi.fn(),
}));

beforeEach(() => {
  listen.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

function Consumer({ enabled = true }: { enabled?: boolean }) {
  useBrowserAutomation({ enabled });
  return null;
}

it.each(["unmount", "disable"])(
  "releases frame listener resolved after %s and never registers status",
  async (end) => {
    let resolve!: (unlisten: () => void) => void;
    const release = vi.fn();
    listen.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Consumer)));
    await act(async () =>
      end === "unmount"
        ? root.unmount()
        : root.render(createElement(Consumer, { enabled: false }))
    );
    await act(async () => resolve(release));
    expect(release).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
    if (end !== "unmount") await act(async () => root.unmount());
  }
);

it("releases a pending status registration after its frame listener was already cleaned", async () => {
  const releaseFrame = vi.fn();
  const releaseStatus = vi.fn();
  let resolveStatus!: (unlisten: () => void) => void;
  listen.mockResolvedValueOnce(releaseFrame).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolveStatus = done;
      })
  );
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Consumer)));
  expect(listen).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  expect(releaseFrame).toHaveBeenCalledTimes(1);
  await act(async () => resolveStatus(releaseStatus));
  expect(releaseStatus).toHaveBeenCalledTimes(1);
});
