import { writeTextFile } from "@tauri-apps/plugin-fs";
import { expect, it, vi } from "vitest";

import { writeTextFileSerial } from "./writeTextFileSerial";

vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));
it("serializes two owners of the same file, permits other files and releases failed queues", async () => {
  const releases: (() => void)[] = [];
  vi.mocked(writeTextFile).mockImplementation(
    () => new Promise<void>((r) => releases.push(r))
  );
  const a = writeTextFileSerial("/fixture/A", "a");
  const b = writeTextFileSerial("/fixture/A", "b");
  const c = writeTextFileSerial("/fixture/B", "c");
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  expect(vi.mocked(writeTextFile).mock.calls).toEqual([
    ["/fixture/A", "a"],
    ["/fixture/B", "c"],
  ]);
  releases[0]();
  releases[1]();
  await Promise.all([a, c]);
  await vi.waitFor(() => expect(releases).toHaveLength(3));
  expect(writeTextFile).toHaveBeenLastCalledWith("/fixture/A", "b");
  releases[2]();
  await b;
  vi.mocked(writeTextFile).mockRejectedValueOnce(new Error("failure"));
  await expect(writeTextFileSerial("/fixture/A", "bad")).rejects.toThrow(
    "failure"
  );
  vi.mocked(writeTextFile).mockResolvedValueOnce();
  await writeTextFileSerial("/fixture/A", "retry");
});
it("bounds queued operations including repeated writes to one target", async () => {
  vi.mocked(writeTextFile).mockResolvedValue();
  const saves = Array.from({ length: 128 }, (_, i) =>
    writeTextFileSerial("/fixture/cap", String(i))
  );
  await expect(writeTextFileSerial("/fixture/cap", "overflow")).rejects.toThrow(
    "Too many files"
  );
  await Promise.all(saves);
  await writeTextFileSerial("/fixture/cap", "retry");
});
