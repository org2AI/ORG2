/**
 * Session execution-mode and running-location vocabulary.
 *
 * Both unions are wire values owned by the Rust backend (`AgentExecMode`).
 * `store/session` persists them, `config/sessionCreatorConfig` decorates them
 * with picker entries, and `engines/SessionCore` freezes them onto queued
 * turns — so the unions themselves live here.
 */

/**
 * User-selectable picker shows build / plan / ask; `debug`, `review` and
 * `wingman` stay valid wire values but are hidden from the picker.
 */
export type AgentExecMode =
  | "build"
  | "ask"
  | "plan"
  | "debug"
  | "review"
  | "wingman";

export type RunningLocation = "local" | "worktree" | "cloud";
