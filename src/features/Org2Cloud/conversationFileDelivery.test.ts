// @vitest-environment jsdom
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationFileDelivery } from "./conversationFileDelivery";
import { conversationFileOutboxSignalAtom } from "./conversationFileOutbox";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { org2CloudOrgsAtom } from "./org2CloudOrgsAtom";
import { SharedSessionFileRequestError } from "./sharedSessionFilesClient";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  settle: vi.fn(),
  sync: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { cloudFileOutbox: { claim: mocks.claim, settle: mocks.settle } },
}));
vi.mock("./syncSessionSharedFiles", () => ({
  syncSessionSharedFileCandidates: mocks.sync,
}));
vi.mock("./org2CloudAuthAction", () => ({
  refreshOrg2CloudAuthForAction: async (auth: unknown) => ({
    status: "ready",
    auth,
  }),
}));
const auth = {
  kind: "org2_cloud" as const,
  supabaseUrl: "https://cloud.example",
  supabaseAnonKey: "anon",
  userId: "author",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: 9999999999,
};
const job = {
  id: 1,
  orgId: "org",
  sessionId: "root",
  path: "/report.md",
  revision: "event:1",
  lease: "lease-1",
};
async function flush() {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
describe("durable continuation file delivery lifecycle", () => {
  let worker: ConversationFileDelivery;
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mocks.claim.mockResolvedValue({ job: null, retryAt: null });
    mocks.settle.mockResolvedValue(undefined);
    mocks.listen.mockResolvedValue(mocks.unlisten);
    mocks.sync.mockResolvedValue({ supported: true, sourceUnavailable: false });
    store = createStore();
    store.set(org2CloudAuthAtom, auth);
    store.set(org2CloudOrgsAtom, [
      { orgId: "org", name: "Org", role: "member" },
    ]);
    worker = new ConversationFileDelivery();
  });
  afterEach(() => {
    worker.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("recovers a persisted job on startup and does no polling after the queue empties", async () => {
    mocks.claim.mockResolvedValueOnce({ job, retryAt: null });
    worker.start(store);
    await flush();
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "root",
        candidates: [{ path: "/report.md", revision: "event:1" }],
      })
    );
    expect(mocks.settle).toHaveBeenCalledWith({
      identity: org2CloudAuthIdentityKey(auth),
      id: 1,
      lease: "lease-1",
      outcome: "uploaded",
    });
    const reads = mocks.claim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mocks.claim).toHaveBeenCalledTimes(reads);
  });
  it.each([
    [
      "quota",
      new SharedSessionFileRequestError(
        "quota",
        413,
        false,
        "ORG2_QUOTA_EXCEEDED"
      ),
    ],
    ["retry", new Error("offline")],
  ])(
    "records %s without affecting the executing turn",
    async (outcome, error) => {
      mocks.claim.mockResolvedValueOnce({ job, retryAt: null });
      mocks.sync.mockRejectedValueOnce(error);
      worker.start(store);
      await flush();
      expect(mocks.settle).toHaveBeenCalledWith(
        expect.objectContaining({ outcome })
      );
    }
  );
  it("keeps unavailable local bytes pending instead of acknowledging upload", async () => {
    mocks.claim.mockResolvedValueOnce({ job, retryAt: null });
    mocks.sync.mockResolvedValueOnce({
      supported: true,
      sourceUnavailable: true,
    });
    worker.start(store);
    await flush();
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "source_unavailable" })
    );
  });
  it("restores the persisted retry deadline after stop/start without reading early", async () => {
    const due = Date.now() + 60_000;
    mocks.claim.mockResolvedValue({ job: null, retryAt: due });
    worker.start(store);
    await flush();
    worker.stop();
    worker.start(store);
    await flush();
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    mocks.claim
      .mockResolvedValueOnce({ job, retryAt: null })
      .mockResolvedValue({ job: null, retryAt: null });
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it.each([
    "account",
    "endpoint",
    "org",
    "hidden",
    "offline",
    "signout",
    "stop",
  ])(
    "cancels the active job across %s transition and rejects stale success",
    async (transition) => {
      let resolve!: (value: {
        supported: boolean;
        sourceUnavailable: boolean;
      }) => void;
      mocks.claim.mockResolvedValueOnce({ job, retryAt: null });
      mocks.sync.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      worker.start(store);
      await flush();
      const signal = mocks.sync.mock.calls[0][0].signal as AbortSignal;
      if (transition === "account")
        store.set(org2CloudAuthAtom, { ...auth, userId: "other" });
      else if (transition === "endpoint")
        store.set(org2CloudAuthAtom, {
          ...auth,
          supabaseUrl: "https://other.example",
        });
      else if (transition === "org") store.set(org2CloudOrgsAtom, []);
      else if (transition === "hidden") {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      } else if (transition === "offline") {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        window.dispatchEvent(new Event("offline"));
      } else if (transition === "signout") store.set(org2CloudAuthAtom, null);
      else worker.stop();
      expect(signal.aborted).toBe(true);
      resolve({ supported: true, sourceUnavailable: false });
      await flush();
      expect(mocks.settle).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: org2CloudAuthIdentityKey(auth),
          outcome: "cancelled",
        })
      );
      expect(mocks.sync).toHaveBeenCalledOnce();
    }
  );
  it("coalesces enqueue signals while a file request is still running", async () => {
    let release!: (value: {
      supported: boolean;
      sourceUnavailable: boolean;
    }) => void;
    mocks.claim.mockResolvedValueOnce({ job, retryAt: null });
    mocks.sync.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = done;
        })
    );
    worker.start(store);
    await flush();
    for (let i = 0; i < 20; i++)
      store.set(conversationFileOutboxSignalAtom, (n) => n + 1);
    await flush();
    expect(mocks.sync).toHaveBeenCalledOnce();
    release({ supported: true, sourceUnavailable: false });
    await flush();
    expect(mocks.settle).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("starts no work while hidden and wakes once on return", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    worker.start(store);
    await flush();
    expect(mocks.claim).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(mocks.claim).toHaveBeenCalledOnce();
  });
  it("wakes for another window's durable enqueue and disposes the peer listener", async () => {
    worker.start(store);
    await flush();
    mocks.claim.mockResolvedValueOnce({ job, retryAt: null });
    mocks.listen.mock.calls[0][1]();
    await flush();
    expect(mocks.sync).toHaveBeenCalledOnce();
    worker.stop();
    await flush();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
  it("releases a lease received after the consumer has stopped without reading bytes", async () => {
    let resolve!: (value: { job: typeof job; retryAt: null }) => void;
    mocks.claim.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    worker.start(store);
    await flush();
    worker.stop();
    resolve({ job, retryAt: null });
    await flush();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "cancelled" })
    );
  });
  it("retains a task when the endpoint does not yet support file uploads", async () => {
    mocks.claim.mockResolvedValueOnce({ job, retryAt: null });
    mocks.sync.mockResolvedValueOnce({
      supported: false,
      sourceUnavailable: false,
    });
    worker.start(store);
    await flush();
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "retry" })
    );
  });
  it("yields after 32 jobs while retaining the rest of the durable backlog", async () => {
    let remaining = 40;
    mocks.claim.mockImplementation(async () =>
      remaining-- > 0
        ? { job: { ...job, id: remaining + 1 }, retryAt: null }
        : { job: null, retryAt: null }
    );
    worker.start(store);
    for (let i = 0; i < 40; i++) await flush();
    expect(mocks.sync).toHaveBeenCalledTimes(32);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(mocks.sync).toHaveBeenCalledTimes(40);
    expect(vi.getTimerCount()).toBe(0);
  });
});
