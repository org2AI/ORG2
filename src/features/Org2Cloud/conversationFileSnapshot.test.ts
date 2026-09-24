import { beforeEach, describe, expect, it, vi } from "vitest";

import { readConversationFileSnapshot } from "./conversationFileSnapshot";

const mocks = vi.hoisted(() => ({ read: vi.fn(), open: vi.fn() }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { cloudFileOutbox: { readSnapshotChunk: mocks.read } },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ open: mocks.open }));
const input = {
  identity: "endpoint|author",
  orgId: "org",
  sessionId: "root",
  candidate: { path: "/report", revision: "answer:1" },
};
beforeEach(() => vi.resetAllMocks());
describe("immutable continuation snapshot reader", () => {
  it("propagates temporary IPC failure so delivery can retry", async () => {
    mocks.read.mockRejectedValueOnce(new Error("database busy"));
    await expect(readConversationFileSnapshot(input)).rejects.toThrow(
      "database busy"
    );
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("decodes captured bytes without touching the source path", async () => {
    mocks.read.mockResolvedValue({
      status: "captured",
      bytesBase64: "AP9B",
      sha256:
        "a90a10503fbfc95789ff38a1bb5039cb71869ab9c0eb1cb51c4a9099f2933c6b",
      size: 3,
      offset: 0,
      capturedAt: 1,
    });
    expect(await readConversationFileSnapshot(input)).toEqual(
      new Uint8Array([0, 255, 65])
    );
    expect(mocks.read).toHaveBeenCalledWith({ ...input, offset: 0 });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each([
    "not_captured",
    "source_unavailable",
    "integrity_error",
    "uploaded",
    "atomic_capture_unsupported",
    "local_budget_exceeded",
  ])("never reopens the source for %s", async (status) => {
    mocks.read.mockResolvedValue({
      status,
      bytesBase64: null,
      sha256: null,
      capturedAt: 1,
    });
    await expect(readConversationFileSnapshot(input)).resolves.toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});

it("rejects corrupt chunks instead of uploading a different file", async () => {
  mocks.read.mockResolvedValue({
    status: "captured",
    bytesBase64: "YQ==",
    sha256: "0".repeat(64),
    size: 1,
    offset: 0,
    capturedAt: 1,
  });
  await expect(readConversationFileSnapshot(input)).rejects.toThrow(
    "integrity check failed"
  );
});
it("assembles bounded chunks and detects receipt changes between reads", async () => {
  mocks.read.mockResolvedValueOnce({
    status: "captured",
    bytesBase64: "YQ==",
    sha256: "old",
    size: 2,
    offset: 0,
    capturedAt: 1,
  });
  mocks.read.mockResolvedValueOnce({
    status: "captured",
    bytesBase64: "Yg==",
    sha256: "new",
    size: 2,
    offset: 1,
    capturedAt: 1,
  });
  await expect(readConversationFileSnapshot(input)).rejects.toThrow(
    "receipt changed"
  );
});
it("stops reading immediately after its lifecycle is cancelled", async () => {
  const controller = new AbortController();
  mocks.read.mockImplementationOnce(async () => {
    controller.abort();
    return { status: "captured" };
  });
  await expect(
    readConversationFileSnapshot(input, controller.signal)
  ).rejects.toThrow();
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
