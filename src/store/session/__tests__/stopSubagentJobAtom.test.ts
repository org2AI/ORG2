import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { invokeTauri } from "@src/util/platform/tauri/init";

import {
  stopSubagentJobAtom,
  stoppingSubagentJobsAtom,
} from "../stopSubagentJobAtom";
import { subagentJobMapAtom, updateSubagentJobAtom } from "../subagentJobAtom";

vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: vi.fn() }));
function setup() {
  const store = createStore();
  store.set(updateSubagentJobAtom, {
    sessionId: "parent",
    handle: "child",
    agentName: "A",
    subagentType: "delegate",
    status: "running",
  });
  vi.mocked(invokeTauri).mockReset();
  return store;
}
describe("shared stop action", () => {
  it("validates parent ownership and deduplicates pending stops", async () => {
    const store = setup();
    let resolve!: () => void;
    vi.mocked(invokeTauri).mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    await store.set(stopSubagentJobAtom, {
      parentSessionId: "other",
      handle: "child",
    });
    expect(invokeTauri).not.toHaveBeenCalled();
    const pending = store.set(stopSubagentJobAtom, {
      parentSessionId: "parent",
      handle: "child",
    });
    await store.set(stopSubagentJobAtom, {
      parentSessionId: "parent",
      handle: "child",
    });
    expect(invokeTauri).toHaveBeenCalledTimes(1);
    expect(store.get(stoppingSubagentJobsAtom).has("child")).toBe(true);
    resolve();
    await pending;
    expect(store.get(stoppingSubagentJobsAtom).size).toBe(0);
    expect(store.get(subagentJobMapAtom).get("parent")?.has("child")).toBe(
      true
    );
  });
  it("cleans stale handles but keeps a real failed stop retryable", async () => {
    const store = setup();
    vi.mocked(invokeTauri).mockRejectedValue(new Error("offline"));
    await expect(
      store.set(stopSubagentJobAtom, {
        parentSessionId: "parent",
        handle: "child",
      })
    ).rejects.toThrow("offline");
    expect(store.get(stoppingSubagentJobsAtom).size).toBe(0);
    expect(store.get(subagentJobMapAtom).get("parent")?.has("child")).toBe(
      true
    );
    vi.mocked(invokeTauri).mockRejectedValue(new Error("handle not found"));
    await store.set(stopSubagentJobAtom, {
      parentSessionId: "parent",
      handle: "child",
    });
    expect(
      store.get(subagentJobMapAtom).get("parent")?.has("child")
    ).toBeFalsy();
  });
});
