import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { syncSessionSharedFiles } from "./syncSessionSharedFiles";

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  find: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("./org2CloudCapabilities", () => ({
  getCloudCapabilitiesConfirmed: mocks.capabilities,
}));
vi.mock("./prepareSharedCommentFiles", () => ({ readBoundedFile: mocks.read }));
vi.mock("./sharedSessionFilesClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sharedSessionFilesClient")>()),
  findSharedSessionFileRevisions: mocks.find,
  uploadSharedSessionFile: mocks.upload,
}));
const event = {
  id: "e1",
  createdAt: "now",
  source: "assistant",
  displayStatus: "completed",
  uiCanonical: "write_file",
  filePath: "/author/report.md",
  displayText: "",
} as SessionEvent;
const input = {
  token: "token",
  endpoint: {
    supabaseUrl: "https://cloud.example",
    anonKey: "anon",
    webOrigin: "",
    isOfficial: false,
  },
  orgId: "org",
  sessionId: "session",
  events: [event],
  assertCurrentIdentity: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.capabilities.mockResolvedValue({
    confirmed: true,
    capabilities: { sharedSessionFiles: true },
  });
  mocks.find.mockResolvedValue(new Set());
  mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
});
describe("shared session artifact publication", () => {
  it("uploads an agent file without rewriting conversation events or requiring a comment", async () => {
    await syncSessionSharedFiles(input);
    expect(mocks.upload).toHaveBeenCalledWith(
      "token",
      input.endpoint,
      "org",
      "session",
      "report.md",
      new Uint8Array([1, 2, 3]),
      { path: "/author/report.md", revision: "e1:now" }
    );
    expect(event.filePath).toBe("/author/report.md");
  });
  it("resumes using durable versions without reading or reuploading existing files", async () => {
    mocks.find.mockResolvedValue(new Set(["/author/report.md\0e1:now"]));
    await syncSessionSharedFiles(input);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does no IO for an idle/no-file batch", async () => {
    await syncSessionSharedFiles({ ...input, events: [] });
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });
  it("fails a transient capability probe instead of marking files synced", async () => {
    mocks.capabilities.mockResolvedValue({
      confirmed: false,
      capabilities: {},
    });
    await expect(syncSessionSharedFiles(input)).rejects.toThrow(
      "temporarily unavailable"
    );
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not claim a missing source file is available", async () => {
    mocks.read.mockRejectedValue(new Error("missing source"));
    await syncSessionSharedFiles(input);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("propagates network failure for the existing delivery lifecycle to retry", async () => {
    mocks.upload.mockRejectedValue(new Error("offline"));
    await expect(syncSessionSharedFiles(input)).rejects.toThrow("offline");
  });
  it("bounds manifest queries and processes more than five files", async () => {
    await syncSessionSharedFiles({
      ...input,
      events: Array.from({ length: 65 }, (_, i) => ({
        ...event,
        id: `e${i}`,
        filePath: `/author/${i}.md`,
      })),
    });
    expect(mocks.find.mock.calls.map((call) => call[4].length)).toEqual([
      64, 1,
    ]);
    expect(mocks.upload).toHaveBeenCalledTimes(65);
  });
});
