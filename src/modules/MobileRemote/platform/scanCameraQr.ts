/** One user-initiated camera session. Frames stay on-device and are never persisted. */
export async function scanCameraQr(
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<string> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Camera unavailable", "NotFoundError");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream: MediaStream | undefined;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");
    const finish = (value?: string, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(frameTimer);
      signal.removeEventListener("abort", abort);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      canvas.width = canvas.height = 0;
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () =>
      finish(undefined, new DOMException("Cancelled", "AbortError"));
    const deadline = setTimeout(
      () =>
        finish(undefined, new DOMException("Scan timed out", "TimeoutError")),
      60_000
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    void (async () => {
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
        // A permission dialog can outlive the screen or the timeout.
        if (settled) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        video.srcObject = stream;
        await video.play();
        const { default: decode } = await import("jsqr");
        if (settled) return;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Camera canvas unavailable");
        const frame = () => {
          if (settled) return;
          try {
            if (
              video.readyState >= 2 &&
              video.videoWidth &&
              video.videoHeight
            ) {
              const scale = Math.min(
                1,
                640 / Math.max(video.videoWidth, video.videoHeight)
              );
              canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
              canvas.height = Math.max(
                1,
                Math.round(video.videoHeight * scale)
              );
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const pixels = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
              );
              const code = decode(pixels.data, pixels.width, pixels.height);
              if (code?.data) {
                finish(code.data);
                return;
              }
            }
            // At most five bounded frames per second; no work when idle.
            frameTimer = setTimeout(frame, 200);
          } catch (error) {
            finish(undefined, error);
          }
        };
        frame();
      } catch (error) {
        finish(undefined, error);
      }
    })().catch((error: unknown) => finish(undefined, error));
  });
}
