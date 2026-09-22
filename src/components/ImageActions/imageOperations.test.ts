// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyNativeImage,
  downloadImage,
  localImagePath,
  readActionImage,
  revealImage,
} from "./imageOperations";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  write: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: mocks.read,
  stat: mocks.stat,
  writeFile: mocks.write,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));

describe("image operations", () => {
  const source = {
    src: "blob:preview",
    localPath: "/tmp/photo.jpg",
    fileName: "photo.jpg",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.stat.mockResolvedValue({ size: 3 });
    // jsdom's Blob predates arrayBuffer; keep the same bytes contract.
    vi.spyOn(Blob.prototype, "arrayBuffer").mockResolvedValue(
      new Uint8Array([1, 2, 3]).buffer
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("times out stalled reads and releases its timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_src, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true }
            );
          })
      )
    );
    const pending = expect(
      readActionImage(
        { src: "https://example.com/stalled.png" },
        new AbortController().signal
      )
    ).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("identifies only actual local image references", () => {
    expect(localImagePath("asset://localhost/tmp/a%20b.png")).toBe(
      "/tmp/a b.png"
    );
    expect(localImagePath("C:\\photo.png")).toBe("C:\\photo.png");
    for (const ref of [
      "https://example.com/a.png",
      "data:image/png;base64,a",
      "blob:1",
      'orgii-transcript-image:["s","t","/other/machine.png"]',
    ])
      expect(localImagePath(ref)).toBeUndefined();
  });
  it("saves the original bytes with the original name using the native dialog", async () => {
    mocks.save.mockResolvedValue("/tmp/copy.jpg");
    await downloadImage(source, new AbortController().signal);
    expect(mocks.read).toHaveBeenCalledWith(source.localPath);
    expect(mocks.save).toHaveBeenCalledWith({ defaultPath: "photo.jpg" });
    expect(mocks.write).toHaveBeenCalledWith(
      "/tmp/copy.jpg",
      new Uint8Array([1, 2, 3])
    );
  });

  it("bounds local reads and cancels an oversized remote stream", async () => {
    mocks.stat.mockResolvedValueOnce({ size: 33 * 1024 * 1024 });
    await expect(
      readActionImage(source, new AbortController().signal)
    ).rejects.toThrow("too large");
    expect(mocks.read).not.toHaveBeenCalled();
    const cancel = vi.fn();
    const releaseLock = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: async () => ({
              done: false,
              value: new Uint8Array(33 * 1024 * 1024),
            }),
            cancel,
            releaseLock,
          }),
        },
      })
    );
    await expect(
      readActionImage(
        { src: "https://example.com/image.png" },
        new AbortController().signal
      )
    ).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    cancel.mockRejectedValueOnce(new Error("reader closed"));
    await expect(
      readActionImage(
        { src: "https://example.com/image.png" },
        new AbortController().signal
      )
    ).rejects.toThrow("reader closed");
    expect(releaseLock).toHaveBeenCalledTimes(2);
  });
  it("does not write after save cancellation or source disposal", async () => {
    mocks.save.mockResolvedValue(null);
    await downloadImage(source, new AbortController().signal);
    expect(mocks.write).not.toHaveBeenCalled();
    const controller = new AbortController();
    mocks.save.mockImplementation(async () => {
      controller.abort();
      return "/tmp/copy.jpg";
    });
    await expect(downloadImage(source, controller.signal)).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not write when disposed while preparing save bytes", async () => {
    const controller = new AbortController();
    mocks.save.mockResolvedValue("/tmp/copy.jpg");
    vi.mocked(Blob.prototype.arrayBuffer).mockImplementationOnce(async () => {
      controller.abort();
      return new Uint8Array([1, 2, 3]).buffer;
    });
    await expect(downloadImage(source, controller.signal)).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("reveals the original path, never the display URL", async () => {
    await revealImage(source);
    expect(mocks.invoke).toHaveBeenCalledWith("show_in_folder", {
      path: source.localPath,
    });
    await expect(revealImage({ src: "blob:1" })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("rejects remote errors and aborts without substituting image URLs as file paths", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetch);
    await expect(
      readActionImage(
        { src: "https://example.com/private.png" },
        new AbortController().signal
      )
    ).rejects.toThrow("403");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("sends binary RGBA to the native clipboard and releases temporary resources", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:copy",
      revokeObjectURL: revoke,
    });
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        complete = true;
        naturalWidth = 1;
        naturalHeight = 1;
        decode = async () => {};
      }
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]) }),
    } as unknown as CanvasRenderingContext2D);
    await copyNativeImage(source, new AbortController().signal);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "clipboard_write_image",
      new Uint8Array([1, 2, 3, 255]),
      { headers: { "x-image-width": "1", "x-image-height": "1" } }
    );
    expect(revoke).toHaveBeenCalledWith("blob:copy");
    mocks.invoke.mockRejectedValueOnce(new Error("denied"));
    await expect(
      copyNativeImage(source, new AbortController().signal)
    ).rejects.toThrow("denied");
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
