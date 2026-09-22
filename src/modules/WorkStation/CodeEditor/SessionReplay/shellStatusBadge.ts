import type { ShellOperationEntry } from "./types";

/** Get status badge for a shell operation (exported for use by FileSidebar) */
export function getShellStatusBadge(
  operation: ShellOperationEntry
): { text: string; className: string } | null {
  if (operation.isLoading) {
    return { text: "...", className: "text-primary-6" };
  }
  if (operation.exitCode === undefined) return null;
  if (operation.exitCode === 0) {
    return { text: "✓", className: "text-success-6" };
  }
  return { text: String(operation.exitCode), className: "text-danger-6" };
}
