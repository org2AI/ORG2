// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { scanCameraQr } from "./scanCameraQr";

const decode = vi.hoisted(() => vi.fn());
vi.mock("jsqr", () => ({ default: decode }));
let stop: ReturnType<typeof vi.fn>;
let media: ReturnType<typeof vi.fn>;
let video: HTMLVideoElement;
let controller: AbortController;
beforeEach(() => {
  vi.useFakeTimers();
  stop = vi.fn();
  media = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: media },
  });
  video = document.createElement("video");
  vi.spyOn(video, "play").mockResolvedValue();
  Object.defineProperties(video, {
    readyState: { value: 2 },
    videoWidth: { value: 1280 },
    videoHeight: { value: 720 },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray(4),
      width: 640,
      height: 360,
    }),
  } as unknown as CanvasRenderingContext2D);
  controller = new AbortController();
  decode.mockReset().mockReturnValue(null);
});
afterEach(() => {
  controller.abort();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("decodes once, bounds frames, releases camera and timers on success", async () => {
  decode.mockReturnValue({ data: "pairing-payload" });
  const result = scanCameraQr(video, controller.signal);
  await expect(result).resolves.toBe("pairing-payload");
  expect(decode).toHaveBeenCalledTimes(1);
  expect(decode.mock.calls[0].slice(1, 3)).toEqual([640, 360]);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(video.srcObject).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it("releases a camera granted after cancellation without starting playback", async () => {
  let grant!: (value: unknown) => void;
  media.mockReturnValue(
    new Promise((resolve) => {
      grant = resolve;
    })
  );
  const result = scanCameraQr(video, controller.signal);
  const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await check;
  grant({ getTracks: () => [{ stop }] });
  await Promise.resolve();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(video.play).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("permission denial does not leave timers running", async () => {
  media.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  await expect(scanCameraQr(video, controller.signal)).rejects.toMatchObject({
    name: "NotAllowedError",
  });
  expect(vi.getTimerCount()).toBe(0);
});
it("timeout stops an unread camera session", async () => {
  const result = scanCameraQr(video, controller.signal);
  const check = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(60_000);
  await check;
  expect(stop).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
