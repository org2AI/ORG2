import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadSharedSessionFile } from "./downloadSharedSessionFile";

const mocks = vi.hoisted(() => ({ write: vi.fn(), exists: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Download: 6 },
  writeFile: mocks.write,
  exists: mocks.exists,
}));
const file = { name: "report.md", bytes: new Uint8Array([1, 2, 3]) };
describe("direct shared-file downloads", () => {
  beforeEach(() => vi.resetAllMocks());
  it("exclusively creates the original filename in Downloads", async () => {
    await expect(downloadSharedSessionFile(file, () => true)).resolves.toBe(
      "report.md"
    );
    expect(mocks.write).toHaveBeenCalledWith("report.md", file.bytes, {
      baseDir: 6,
      createNew: true,
    });
  });
  it("retries collisions with a suffix without overwriting", async () => {
    mocks.write.mockRejectedValueOnce(new Error("exists"));
    mocks.exists.mockResolvedValue(true);
    await expect(downloadSharedSessionFile(file, () => true)).resolves.toBe(
      "report (1).md"
    );
    expect(mocks.write.mock.calls.every((call) => call[2].createNew)).toBe(
      true
    );
  });
  it("does not retry a permission or disk error", async () => {
    mocks.write.mockRejectedValue(new Error("permission denied"));
    mocks.exists.mockResolvedValue(false);
    await expect(downloadSharedSessionFile(file, () => true)).rejects.toThrow(
      "permission denied"
    );
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("stops if the account changes while checking a collision", async () => {
    let current = true;
    mocks.write.mockRejectedValueOnce(new Error("exists"));
    mocks.exists.mockImplementation(async () => {
      current = false;
      return true;
    });
    await expect(
      downloadSharedSessionFile(file, () => current)
    ).resolves.toBeNull();
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("rejects paths before writing", async () => {
    await expect(
      downloadSharedSessionFile({ ...file, name: "../report.md" }, () => true)
    ).rejects.toThrow("Invalid");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("bounds collision retries", async () => {
    mocks.write.mockRejectedValue(new Error("exists"));
    mocks.exists.mockResolvedValue(true);
    await expect(downloadSharedSessionFile(file, () => true)).rejects.toThrow(
      "Too many"
    );
    expect(mocks.write).toHaveBeenCalledTimes(100);
  });
});
