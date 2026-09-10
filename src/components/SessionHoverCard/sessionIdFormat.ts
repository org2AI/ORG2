/** How long the copied-check flash stays visible on the session-id row. */
export const COPIED_FLASH_MS = 1500;
/** Characters kept on each side when middle-truncating a session id. */
export const COMPACT_ID_EDGE_CHARS = 8;

/**
 * Middle-truncate a session id so both the distinctive head and tail stay
 * visible (UUIDs differ at both ends; opencode `ses_` ids differ at the tail).
 */
export function formatCompactSessionId(id: string): string {
  if (id.length <= COMPACT_ID_EDGE_CHARS * 2 + 2) return id;
  return `${id.slice(0, COMPACT_ID_EDGE_CHARS)}…${id.slice(-COMPACT_ID_EDGE_CHARS)}`;
}
