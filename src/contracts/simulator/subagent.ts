/**
 * Subagent (child-session) clip shape.
 *
 * Produced by `engines/Simulator/hooks/useSubagentSessions` from the
 * `agent_sessions` table and consumed by `store/ui/simulatorAtom`.
 */
export interface SubagentSession {
  /** Stable React key — equals the child session id. */
  key: string;
  /** Concrete child session id (always non-null from DB). */
  sessionId: string;
  /** Agent name for UI — derived from DB `name` with `AgentName (task)` → agent only. */
  name: string;
  /** Task title for UI — derived from DB `name` with `AgentName (task)` → task only. */
  description: string;
  /** DB `agent_sessions.session_type` (Rust unified session record). */
  sessionType: string;
  status: "pending" | "running" | "completed" | "failed";
  /** Whether the subagent was spawned in background mode. */
  isBackground: boolean;
  /** Epoch ms when the subagent was spawned. */
  startedAtMs: number;
  /** Epoch ms when the subagent finished, or `null` if still running. */
  endedAtMs: number | null;
  /** Backend-authoritative terminal flag (`SessionStatus::is_terminal`). */
  isTerminal: boolean;
}
