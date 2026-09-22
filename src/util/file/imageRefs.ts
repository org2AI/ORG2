const TRANSCRIPT_IMAGE_PREFIX = "orgii-transcript-image:";

export function parseTranscriptImageRef(
  ref: string
): { sessionId: string; turnId: string; originalRef: string } | null {
  if (!ref.startsWith(TRANSCRIPT_IMAGE_PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(
      ref.slice(TRANSCRIPT_IMAGE_PREFIX.length)
    );
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      !value.every((part) => typeof part === "string")
    )
      return null;
    const [sessionId, turnId, originalRef] = value as string[];
    return { sessionId, turnId, originalRef };
  } catch {
    return null;
  }
}

const TAURI_ASSET_PREFIXES = [
  "asset://localhost",
  "https://asset.localhost",
  "http://asset.localhost",
] as const;

/**
 * Convert a Tauri asset URL back to the filesystem path used by Rust and the
 * filesystem plugin. Data URLs and plain paths are already usable as-is.
 */
export function imageRefToRustPath(ref: string): string {
  const transcript = parseTranscriptImageRef(ref);
  if (transcript) return transcript.originalRef;
  if (ref.startsWith("data:")) return ref;
  for (const prefix of TAURI_ASSET_PREFIXES) {
    if (ref.startsWith(prefix)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(ref.slice(prefix.length));
      } catch {
        return ref;
      }
      return /^\/[a-z]:\//i.test(decoded) ? decoded.slice(1) : decoded;
    }
  }
  return ref;
}

/** Browser-owned URLs bypass filesystem reads; Tauri HTTP asset URLs do not. */
export function isDirectImageUrl(ref: string): boolean {
  return (
    /^(?:data:|blob:|https?:\/\/)/i.test(ref) &&
    !TAURI_ASSET_PREFIXES.some((prefix) => ref.startsWith(`${prefix}/`))
  );
}
