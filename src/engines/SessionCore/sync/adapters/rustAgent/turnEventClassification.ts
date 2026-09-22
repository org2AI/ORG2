/**
 * Wire-level classification of Rust agent channel events: which event types
 * end a turn, which never start one, and which live-stream deltas are dropped
 * once the user has stopped the turn.
 */

// Terminal event types — signal turn completion and lock out further
// "running" signals. Module-scoped because every open Rust session shares
// the same wire contract; rebuilding these sets per handler retains needless
// allocations across repeated session switches.
export const TERMINAL_EVENTS = new Set([
  "agent:complete",
  "agent:turn_completed",
  "agent:error",
  "agent:stream_error_exhausted",
  "agent:session_evicted",
]);

// Events that may arrive while a turn is running or after it has completed,
// but never start a new LLM turn by themselves. In particular,
// `agent:snapshot_created` is emitted asynchronously after snapshot
// persistence. Treating it as a new-turn signal resurrected a completed
// session as `running`, leaving a permanent green sidebar indicator even
// though the composer had already returned to Send.
const TURN_NEUTRAL_EVENTS = new Set([
  "agent:turn_summary",
  "agent:warning",
  "agent:goal_loop",
  "agent:ade_action",
  "agent:shell_process_started",
  "agent:shell_process_backgrounded",
  "agent:shell_process_exited",
  "agent:exec_output",
  "agent:context_usage",
  "agent:file_change",
  "agent:setup_repo_update",
  "agent:heartbeat",
  "agent:snapshot_created",
  "agent:computer_use_entered",
  "agent:computer_use_exited",
  "agent:computer_use_aborted",
]);

export function isRustAgentTurnNeutralEvent(eventType: string): boolean {
  return TURN_NEUTRAL_EVENTS.has(eventType);
}

export const PLAN_SUBMITTED_END_TURN_PREFIX = "PLAN_SUBMITTED_END_TURN:";
export const LIVE_STREAM_EVENTS_IGNORED_AFTER_STOP = new Set([
  "agent:message_delta",
  "agent:thinking_delta",
  "agent:tool_call_delta",
  "agent:streaming_complete",
]);
