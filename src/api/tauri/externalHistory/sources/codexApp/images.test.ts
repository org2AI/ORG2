import { describe, expect, it, vi } from "vitest";

import { readTranscriptImage } from "./images";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("transcript image requests", () => {
  it("shares pending reads and releases completed image data", async () => {
    let resolve!: (value: string) => void;
    invoke.mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done;
      })
    );
    const request = {
      sessionId: "codexapp-one",
      turnId: "codex-user-123",
      originalRef: "/protected/shot.png",
    };
    const first = readTranscriptImage(request);
    expect(readTranscriptImage(request)).toBe(first);
    expect(invoke).toHaveBeenCalledWith("session_history_image", request);
    resolve("data:image/png;base64,QUJD");
    await first;
    invoke.mockResolvedValueOnce(null);
    expect(await readTranscriptImage(request)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("does not keep failed requests", async () => {
    const request = {
      sessionId: "codexapp-error",
      turnId: "codex-user-123",
      originalRef: "/protected/shot.png",
    };
    invoke.mockRejectedValueOnce(new Error("source removed"));
    await expect(readTranscriptImage(request)).rejects.toThrow(
      "source removed"
    );
    invoke.mockResolvedValueOnce(null);
    expect(await readTranscriptImage(request)).toBeNull();
  });
});

it("bounds retained pending keys even when more images are requested", async () => {
  const finish: Array<(value: null) => void> = [];
  invoke.mockImplementation(
    () =>
      new Promise<null>((resolve) => {
        finish.push(resolve);
      })
  );
  const requests = Array.from({ length: 33 }, (_, index) => ({
    sessionId: `codexapp-bound-${index}`,
    turnId: "codex-user-123",
    originalRef: "/tmp/shot.png",
  }));
  const promises = requests.map(readTranscriptImage);
  expect(readTranscriptImage(requests[0])).toBe(promises[0]);
  const overflow = readTranscriptImage(requests[32]);
  expect(overflow).not.toBe(promises[32]);
  finish.forEach((resolve) => resolve(null));
  await Promise.all([...promises, overflow]);
});
