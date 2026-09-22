/**
 * Only tools whose title argument describes the invocation belong here.
 * Other tools use title for a document, task, or message being created.
 * Keep this policy shared by chat, replay, and mobile presentation.
 */
const CALL_TITLE_TOOLS = new Set([
  "js",
  "cua_repl.js",
  "mcp__cua_repl.js",
  "mcp__cua_repl__js",
]);

export function getToolCallTitle(
  toolName: string,
  args: Record<string, unknown> | undefined
): string | undefined {
  if (!CALL_TITLE_TOOLS.has(toolName) || typeof args?.title !== "string") {
    return undefined;
  }
  return args.title.trim() || undefined;
}
