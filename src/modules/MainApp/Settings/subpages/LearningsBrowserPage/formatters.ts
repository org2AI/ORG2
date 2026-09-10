import { formatRelativeTime as _formatRelativeTime } from "@src/util/time/formatRelativeTime";

export function formatRelativeTime(iso: string): string {
  return _formatRelativeTime(iso, "nano");
}

export { truncate } from "@src/util/string/truncate";
