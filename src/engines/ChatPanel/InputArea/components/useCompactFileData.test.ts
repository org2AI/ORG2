/* @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHookLifecycleHarness } from "@src/test/hookLifecycleHarness";

import { useCompactFileData } from "./useCompactFileData";

const mocks = vi.hoisted(() => ({
  getOrgtrackSessionEditArtifacts: vi.fn(),
  getOrgtrackSessionFinalDiffs: vi.fn(),
}));

vi.mock("@src/api/tauri/lineage", () => ({
  getOrgtrackSessionEditArtifacts: mocks.getOrgtrackSessionEditArtifacts,
  getOrgtrackSessionFinalDiffs: mocks.getOrgtrackSessionFinalDiffs,
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

function artifact(filePath: string) {
  return {
    filePath,
    editKind: "patch" as const,
    linesAdded: 2,
    linesRemoved: 1,
    sequenceIndex: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createHarness() {
  return createHookLifecycleHarness(
    (props: { sessionId: string | null; reloadKey?: string }) =>
      useCompactFileData(props).allFiles
  );
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.clearAllMocks();
});

describe("useCompactFileData", () => {
  it("issues no orgtrack reads for imported sessions", async () => {
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ sessionId: "claudecodeapp-1", reloadKey: "a" });
    await harness.render({ sessionId: "codexapp-rollout-1", reloadKey: "b" });
    await flushAsync();

    expect(mocks.getOrgtrackSessionEditArtifacts).not.toHaveBeenCalled();
    expect(mocks.getOrgtrackSessionFinalDiffs).not.toHaveBeenCalled();
    expect(harness.read()).toEqual([]);
  });

  it("never returns another session's files while the next read is pending", async () => {
    mocks.getOrgtrackSessionEditArtifacts.mockResolvedValue([
      artifact("src/a.ts"),
    ]);
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ sessionId: "sdeagent-a" });
    await flushAsync();
    expect(harness.read().map((file) => file.path)).toEqual(["src/a.ts"]);

    const pending = deferred<ReturnType<typeof artifact>[]>();
    mocks.getOrgtrackSessionEditArtifacts.mockReturnValue(pending.promise);
    await harness.render({ sessionId: "sdeagent-b" });
    await flushAsync();
    expect(harness.read()).toEqual([]);

    pending.resolve([artifact("src/b.ts")]);
    await flushAsync();
    expect(harness.read().map((file) => file.path)).toEqual(["src/b.ts"]);
  });
});
