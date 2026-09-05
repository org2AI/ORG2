// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import type { ConversationFamilyMember } from "./continuationEvents";
import { useEnsureFamilyLoaded } from "./useEnsureFamilyLoaded";

const mocks = vi.hoisted(() => ({
  buildCloudSessionFetchClient: vi.fn(() => ({ kind: "test-client" })),
  ensureFreshSession: vi.fn(),
  importRemoteSession: vi.fn(),
  setAuth: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => AUTH,
  useSetAtom: () => mocks.setAuth,
}));

vi.mock("@src/features/Org2Cloud/org2CloudBackendAdapter", () => ({
  buildCloudSessionFetchClient: mocks.buildCloudSessionFetchClient,
}));

vi.mock("@src/features/TeamCollaboration/engine/collabSessionImport", () => ({
  importRemoteSession: mocks.importRemoteSession,
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));

vi.mock("../org2CloudClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org2CloudClient")>()),
  ensureFreshSession: mocks.ensureFreshSession,
}));

const AUTH = {
  kind: "org2_cloud" as const,
  supabaseUrl: "https://cloud.example.test",
  supabaseAnonKey: "anon",
  userId: "user-a",
  accessToken: "access-a",
  refreshToken: "refresh-a",
  expiresAt: 4_102_444_800,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function family(prefix: string, count: number): ConversationFamilyMember[] {
  return Array.from({ length: count }, (_, index) => {
    const bareSessionId = `${prefix}-${index}`;
    return {
      bareSessionId,
      isRoot: index === 0,
      row: {
        id: `remote-${bareSessionId}`,
        orgId: "org-a",
        ownerMemberId: "member-a",
        ownerUserId: "owner-a",
        ownerDisplayName: "Ada",
        ownerIdentityKind: "human",
        sourceSessionId: bareSessionId,
        title: bareSessionId,
        eventsEpoch: 1,
        eventsFrozenSeq: 0,
        eventsCount: 1,
        eventsTailHash: `tail-${bareSessionId}`,
      },
    };
  });
}

const NO_LOADED_SESSIONS = new Set<string>();

function Probe({ members }: { members: readonly ConversationFamilyMember[] }) {
  useEnsureFamilyLoaded(members, NO_LOADED_SESSIONS, "anchor");
  return null;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useEnsureFamilyLoaded import claims", () => {
  let root: SmokeRoot;

  beforeEach(() => {
    vi.clearAllMocks();
    root = createSmokeRoot();
  });

  afterEach(async () => {
    await root.unmount();
  });

  async function render(members: readonly ConversationFamilyMember[]) {
    await root.render(createElement(Probe, { members }));
  }

  it("claims only worker-owned tasks and releases them on cleanup", async () => {
    const members = family("cancel-overflow", 6);
    const refreshes = Array.from({ length: 4 }, () => deferred<typeof AUTH>());
    let refreshIndex = 0;
    mocks.ensureFreshSession.mockImplementation(
      () => refreshes[refreshIndex++]?.promise ?? Promise.resolve(AUTH)
    );

    await render(members);
    await vi.waitFor(() => {
      expect(mocks.ensureFreshSession).toHaveBeenCalledTimes(4);
    });

    await root.unmount();
    mocks.ensureFreshSession.mockResolvedValue(AUTH);
    root = createSmokeRoot();
    await render([...members]);

    await vi.waitFor(() => {
      expect(mocks.importRemoteSession).toHaveBeenCalledTimes(6);
    });
    expect(
      mocks.importRemoteSession.mock.calls.map(
        ([options]) => options.remoteSession.sourceSessionId
      )
    ).toEqual(
      expect.arrayContaining(members.map((member) => member.bareSessionId))
    );

    for (const refresh of refreshes) refresh.resolve(AUTH);
    await flushAsync();
    await render([...members]);
    await flushAsync();
    expect(mocks.importRemoteSession).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["a null refresh", () => Promise.resolve(null)],
    ["a rejected refresh", () => Promise.reject(new Error("refresh failed"))],
  ])(
    "releases a claim after %s so the same position can retry",
    async (_, fail) => {
      const members = family(`refresh-retry-${String(_)}`, 1);
      mocks.ensureFreshSession.mockImplementationOnce(fail);

      await render(members);
      await vi.waitFor(() => {
        expect(mocks.ensureFreshSession).toHaveBeenCalledTimes(1);
      });
      await flushAsync();

      mocks.ensureFreshSession.mockResolvedValue(AUTH);
      await render([...members]);
      await vi.waitFor(() => {
        expect(mocks.importRemoteSession).toHaveBeenCalledTimes(1);
      });
    }
  );

  it("releases a claim after import failure so the same position can retry", async () => {
    const members = family("import-retry", 1);
    mocks.ensureFreshSession.mockResolvedValue(AUTH);
    mocks.importRemoteSession.mockRejectedValueOnce(new Error("import failed"));

    await render(members);
    await vi.waitFor(() => {
      expect(mocks.importRemoteSession).toHaveBeenCalledTimes(1);
    });
    await flushAsync();

    mocks.importRemoteSession.mockResolvedValue(undefined);
    await render([...members]);
    await vi.waitFor(() => {
      expect(mocks.importRemoteSession).toHaveBeenCalledTimes(2);
    });
  });
});
