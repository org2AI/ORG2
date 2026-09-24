// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SharedSessionFileReference } from "@src/features/Org2Cloud/sharedSessionFileReference";
import type { WorkStationTab } from "@src/store/workstation/tabs";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import SharedFileRenderer from "./sharedFile";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), dispose: vi.fn() }));
vi.mock("@src/features/Org2Cloud/SharedSessionFileViewer", () => ({
  default: function Viewer() {
    useEffect(() => {
      lifecycle.mount();
      return () => lifecycle.dispose();
    }, []);
    return createElement("pre", null, "loaded");
  },
}));
let root: ReturnType<typeof createSmokeRoot>;
beforeEach(() => {
  root = createSmokeRoot();
});
afterEach(async () => {
  await root.unmount();
  vi.clearAllMocks();
});
it("waits for authoritative origin, renders automatically, and releases the viewer on deactivation", async () => {
  const store = createStore();
  const referenceAtom = atom<SharedSessionFileReference | null | undefined>(
    null
  );
  const tab: WorkStationTab = {
    id: "shared-file:one",
    type: "shared-file",
    title: "proof.txt",
    data: {
      identity: "user",
      reference: { id: "source", endpoint: "cloud" },
      getAccess: () => null,
      pending: { key: "event", referenceAtom },
    },
  };
  const render = async (isActive: boolean) =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(SharedFileRenderer, { tab, isActive })
      )
    );
  await render(true);
  expect(document.querySelector('[role="status"]')).not.toBeNull();
  expect(lifecycle.mount).not.toHaveBeenCalled();
  await act(async () => {
    store.set(referenceAtom, { id: "exact-snapshot", endpoint: "cloud" });
  });
  expect(lifecycle.mount).toHaveBeenCalledOnce();
  await render(false);
  expect(lifecycle.dispose).toHaveBeenCalledOnce();
  expect(document.querySelector("pre")).toBeNull();
});
it("ends an abandoned unresolved origin without attempting a path-based lookup", async () => {
  const tab: WorkStationTab = {
    id: "shared-file:abandoned",
    type: "shared-file",
    title: "proof.txt",
    data: {
      identity: "user",
      reference: { id: "source", endpoint: "cloud" },
      getAccess: () => null,
      pending: { key: "event", referenceAtom: atom(undefined) },
    },
  };
  await root.render(createElement(SharedFileRenderer, { tab, isActive: true }));
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(lifecycle.mount).not.toHaveBeenCalled();
});
