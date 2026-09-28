// @vitest-environment jsdom
import { createStore } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";

import {
  activeWorkStationTabAtom,
  mainPaneTabsAtom,
} from "@src/store/workstation/tabs";

import { openSharedSessionFile } from "./openSharedSessionFile";
import { org2CloudAuthAtom } from "./org2CloudAuthAtom";

const runtime = vi.hoisted(() => ({
  store: null as ReturnType<typeof createStore> | null,
  reveal: vi.fn(),
}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => runtime.store,
}));
vi.mock("@src/util/ui/revealMyStation", () => ({
  revealMyStation: runtime.reveal,
}));
const reference = {
  id: "file-id",
  endpoint: "https://cloud.example",
  source: {
    orgId: "org",
    sessionId: "root",
    path: "/sender/proof.txt",
    version: { uploaderUserId: "sender", revision: "original" },
  },
};
const auth = {
  kind: "org2_cloud" as const,
  supabaseUrl: reference.endpoint,
  supabaseAnonKey: "anon",
  userId: "user-1",
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: 9999999999,
};
beforeEach(() => {
  localStorage.clear();
  runtime.store = createStore();
  runtime.store.set(org2CloudAuthAtom, auth);
  vi.clearAllMocks();
});
it("reveals the right pane immediately and deduplicates the exact snapshot", () => {
  const capability = {
    endpoint: reference.endpoint,
    shareToken: "guest-secret",
  };
  openSharedSessionFile(reference, capability);
  openSharedSessionFile(reference, capability);
  expect(runtime.reveal).toHaveBeenCalledTimes(2);
  const tabs = runtime
    .store!.get(mainPaneTabsAtom)
    .filter((tab) => tab.type === "shared-file");
  expect(tabs).toHaveLength(1);
  expect(runtime.store!.get(activeWorkStationTabAtom)?.id).toBe(tabs[0].id);
  expect(tabs[0].title).toBe("proof.txt");
  expect((tabs[0].data.getAccess as () => unknown)()).toEqual(capability);
  expect(JSON.stringify(tabs[0])).not.toContain("guest-secret");
});
it("keeps revisions and authenticated readers separate", () => {
  openSharedSessionFile(reference);
  openSharedSessionFile({
    ...reference,
    source: {
      ...reference.source,
      version: { ...reference.source.version, revision: "new" },
    },
  });
  runtime.store!.set(org2CloudAuthAtom, { ...auth, userId: "user-2" });
  openSharedSessionFile(reference);
  expect(
    runtime
      .store!.get(mainPaneTabsAtom)
      .filter((tab) => tab.type === "shared-file")
  ).toHaveLength(3);
});
it("does not carry another endpoint's capability", () => {
  openSharedSessionFile(reference, {
    endpoint: "https://other.example",
    shareToken: "wrong",
  });
  const tab = runtime.store!.get(activeWorkStationTabAtom)!;
  expect((tab.data.getAccess as () => unknown)()).toBeNull();
});
