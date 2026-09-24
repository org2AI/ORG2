import { beforeEach, describe, expect, it, vi } from "vitest";

import { readConversationFileSnapshot } from "./conversationFileSnapshot";

const mocks = vi.hoisted(() => ({ read: vi.fn(), open: vi.fn() }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { cloudFileOutbox: { readSnapshot: mocks.read } },
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
      sha256: "digest",
      capturedAt: 1,
    });
    expect(await readConversationFileSnapshot(input)).toEqual(
      new Uint8Array([0, 255, 65])
    );
    expect(mocks.read).toHaveBeenCalledWith(input);
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
