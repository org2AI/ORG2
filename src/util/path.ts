/**
 * Cross-platform path utilities for display use.
 * These functions are for UI labelling only — not for fs operations.
 */

/**
 * Returns the last path segment, stripping any trailing slashes.
 * Works for both POSIX and Windows paths.
 */
export function basename(path: string | undefined): string {
  if (!path) return "";
  const trimmed = path.replace(/[\\/]+$/u, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Collapses a macOS (`/Users/<name>`) or Linux (`/home/<name>`) home
 * directory prefix to `~`. Other paths are returned unchanged.
 */
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u, "~");
}
