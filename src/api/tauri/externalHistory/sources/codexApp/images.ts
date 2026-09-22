import { invoke } from "@tauri-apps/api/core";

interface TranscriptImageRequest {
  sessionId: string;
  turnId: string;
  originalRef: string;
}

// Only in-flight calls are shared. No image bytes survive completion in a
// module cache; the mounted thumbnail owns the returned data URL. Rust caps
// active source reads at two regardless of how many windows request images.
const pending = new Map<string, Promise<string | null>>();
const MAX_PENDING_KEYS = 32;

export function readTranscriptImage(
  request: TranscriptImageRequest
): Promise<string | null> {
  const key = JSON.stringify(request);
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = invoke<string | null>("session_history_image", {
    ...request,
  });
  if (pending.size < MAX_PENDING_KEYS) {
    pending.set(key, promise);
    void promise.then(
      () => {
        if (pending.get(key) === promise) pending.delete(key);
      },
      () => {
        if (pending.get(key) === promise) pending.delete(key);
      }
    );
  }
  return promise;
}
