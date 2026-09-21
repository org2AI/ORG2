import { z } from "zod/v4";

import { JsonRecordFromAnySchema } from "@src/util/schemas/jsonRecord";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

export const ActivityChunkSchema = z.object({
  chunk_id: z.string(),
  session_id: z.string().optional(),
  action_type: z.string(),
  function: z.string(),
  args: UnknownRecordSchema,
  result: JsonRecordFromAnySchema,
  created_at: z.string(),
  thread_id: z.string().optional(),
  process_id: z.string().optional(),
});

export const QuestionPayloadSchema = z.object({
  question_id: z.string(),
  question_text: z.string(),
  answer_kind: z.string().optional(),
  options: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  context: UnknownRecordSchema.optional(),
  created_at: z.string(),
});

export const CODE_EDITOR_WEB_SOCKET_EVENT_TYPES = [
  "repo:changed",
  "repo:status_updated",
  "file:changed",
  "repo:git_operation",
  "repo:watcher_health",
  // Session lifecycle broadcasts from the CLI runner. Consumed globally by
  // useBackgroundSessionMonitor (background-session completion toasts); the
  // active session gets the same events over its own session channel.
  "code_session.status_changed",
  // Approval requests are consumed by the main-window notification bridge.
  // Native agents use a `{ type, payload }` envelope while CLI agents emit
  // the same fields flat, so the passthrough schema below intentionally keeps
  // both wire shapes intact.
  "permission:request",
  "agent:plan_ready_for_approval",
  // Backend-owned invalidations that replace frontend polling loops.
  "agent_org:run_changed",
  "agent:snapshot_created",
] as const;

// `.passthrough()` because session broadcasts carry their payload as
// top-level fields (session_id, status, background, session_name,
// error_message) — the default zod strip would silently drop them before
// handlers run. `timestamp` is optional for the same reason: repo/file/lsp
// events include it, session broadcasts do not.
export const CodeEditorWebSocketMessageSchema = z
  .object({
    type: z.enum(CODE_EDITOR_WEB_SOCKET_EVENT_TYPES),
    repo_id: z.string().optional(),
    language: z.string().optional(),
    data: z.unknown().optional(),
    payload: z.unknown().optional(),
    status: z.unknown().optional(),
    turn_intent_id: z.string().optional(),
    files: z.array(z.unknown()).optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

export type ParsedCodeEditorWebSocketMessage = z.output<
  typeof CodeEditorWebSocketMessageSchema
>;

export function maybeParseCodeEditorWebSocketMessage(
  raw: string
): ParsedCodeEditorWebSocketMessage | null {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    return null;
  }

  const type = (parsed as { type: unknown }).type;
  if (
    typeof type !== "string" ||
    !CODE_EDITOR_WEB_SOCKET_EVENT_TYPES.includes(
      type as (typeof CODE_EDITOR_WEB_SOCKET_EVENT_TYPES)[number]
    )
  ) {
    return null;
  }

  return CodeEditorWebSocketMessageSchema.parse(parsed);
}
