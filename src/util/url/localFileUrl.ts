const FILE_URL_PREFIX = "file://";
const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\[^\\]/;

function encodePathSegments(segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

/**
 * Convert an absolute local path (POSIX, Windows drive, or UNC) into a
 * `file://` URL the inline browser webview can load. Returns an empty string
 * for blank or relative input, because a relative path has no stable target.
 */
export function localPathToFileUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";

  if (WINDOWS_UNC_PATH.test(trimmed)) {
    const [host, ...rest] = trimmed.slice(2).split("\\");
    return `${FILE_URL_PREFIX}${host}/${encodePathSegments(rest)}`;
  }

  if (WINDOWS_DRIVE_PATH.test(trimmed)) {
    const [drive, ...rest] = trimmed.replace(/\\/g, "/").split("/");
    return `${FILE_URL_PREFIX}/${drive}/${encodePathSegments(rest)}`;
  }

  if (!trimmed.startsWith("/")) return "";
  return `${FILE_URL_PREFIX}${encodePathSegments(trimmed.split("/"))}`;
}

/** True when `url` addresses a local file rather than a network page. */
export function isLocalFileUrl(url: string | undefined): boolean {
  return Boolean(url && url.trim().toLowerCase().startsWith(FILE_URL_PREFIX));
}

/** Decoded last path segment of a `file://` URL, or "" when there is none. */
export function getFileNameFromFileUrl(url: string | undefined): string {
  if (!isLocalFileUrl(url)) return "";
  try {
    const segments = new URL(url!.trim()).pathname.split("/").filter(Boolean);
    const lastSegment = segments.at(-1);
    return lastSegment ? decodeURIComponent(lastSegment) : "";
  } catch {
    return "";
  }
}
