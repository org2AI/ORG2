import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareSharedCommentFiles } from "./prepareSharedCommentFiles";
import { SHARED_FILE_MAX_BYTES } from "./sharedSessionFilesClient";

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  open: vi.fn(),
  upload: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: mocks.stat,
  open: mocks.open,
}));
vi.mock("./sharedSessionFilesClient", () => ({
  SHARED_FILE_MAX_BYTES: 33554432,
  uploadSharedSessionFile: mocks.upload,
}));
const input = {
  body: "report.md [file:/repo/report.md]",
  token: "jwt",
  endpoint: {
    supabaseUrl: "https://cloud.example",
    anonKey: "anon",
    webOrigin: "https://app.example",
    isOfficial: false,
  },
  orgId: "org",
  sessionId: "session",
  assertCurrentIdentity: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.stat.mockResolvedValue({ isFile: true, size: 3 });
  mocks.read
    .mockImplementationOnce(async (buffer: Uint8Array) => {
      buffer.set([97, 98, 99]);
      return 3;
    })
    .mockResolvedValue(0);
  mocks.open.mockResolvedValue({ read: mocks.read, close: mocks.close });
  mocks.upload.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
  });
});
describe("explicit comment attachment admission", () => {
  it("uploads bytes once for duplicate references and removes sender paths", async () => {
    const body = await prepareSharedCommentFiles({
      ...input,
      body: `${input.body} ${input.body}`,
    });
    expect(body).not.toContain("/repo/");
    expect(body).not.toContain("report.md [report.md]");
    expect(body.match(/orgii-file:/g)).toHaveLength(2);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.upload.mock.calls[0][5]).toEqual(new Uint8Array([97, 98, 99]));
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("does no IO for plain text, old markdown links, or already shared links", async () => {
    const body = "[report](/repo/report.md) [shared](orgii-file://id)";
    expect(await prepareSharedCommentFiles({ ...input, body })).toBe(body);
    expect(mocks.stat).not.toHaveBeenCalled();
  });
  it("does not impose a five-files-per-comment limit", async () => {
    mocks.stat.mockResolvedValue({ isFile: true, size: 0 });
    mocks.read.mockReset().mockResolvedValue(0);
    await prepareSharedCommentFiles({
      ...input,
      body: Array.from({ length: 6 }, (_, i) => `[file:/r/${i}]`).join(" "),
    });
    expect(mocks.upload).toHaveBeenCalledTimes(6);
  });
  it("rejects oversized files before opening", async () => {
    mocks.stat.mockResolvedValue({
      isFile: true,
      size: SHARED_FILE_MAX_BYTES + 1,
    });
    await expect(prepareSharedCommentFiles(input)).rejects.toThrow("32 MiB");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("bounds a growing file and closes its handle", async () => {
    mocks.read
      .mockReset()
      .mockImplementation(async (buffer: Uint8Array) => buffer.length);
    await expect(prepareSharedCommentFiles(input)).rejects.toThrow("changed");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("fails closed on upload failure without emitting a shared reference", async () => {
    mocks.upload.mockRejectedValue(new Error("offline"));
    await expect(prepareSharedCommentFiles(input)).rejects.toThrow("offline");
  });
  it("does not upload bytes after an identity switch while reading", async () => {
    const guard = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new Error("identity changed");
      });
    await expect(
      prepareSharedCommentFiles({ ...input, assertCurrentIdentity: guard })
    ).rejects.toThrow("identity changed");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
