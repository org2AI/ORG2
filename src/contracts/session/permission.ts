/**
 * Pending tool-permission request.
 *
 * Emitted by every session adapter (`engines/SessionCore/sync/adapters`) and
 * parked in `store/session/permissionRequestAtom` until the user answers.
 */
import type { RustAgentType } from "@src/contracts/agent/rustAgentType";

export interface PermissionRequestEvent {
  requestId: string;
  sessionId: string;
  tool: string;
  toolCallId?: string;
  args: Record<string, unknown>;
  agentType?: RustAgentType;
  /**
   * Where the pending approval is parked on the backend. Default
   * (undefined) is the Rust-agent `AgentPermissionManager`
   * (`agent_permission_response`). `"cli_hook"` marks a managed CLI
   * session's PermissionRequest hook long-poll, `"acp"` an ACP agent's
   * (OpenCode/Copilot/Kiro) parked `session/request_permission` — both
   * answered via `cli_agent_approval_response` instead.
   */
  origin?: "cli_hook" | "acp" | "native_cli";
}
