/**
 * Terminal session contracts.
 *
 * `store/ui/miniTerminalAtom` and `store/workstation/codeEditor/terminal`
 * name these when opening terminals, and `engines/TerminalCore` consumes
 * them.
 *
 * `TerminalSession` itself deliberately stays in
 * `engines/TerminalCore/types`: it embeds `CliAgentType`, which is inferred
 * from a zod schema in `api/tauri/rpc/schemas/validation` and cannot be moved
 * down without the schema.
 */

export const TERMINAL_AGENT_STATUS = {
  STARTING: "starting",
  RUNNING: "running",
  WAITING: "waiting",
  DONE: "done",
} as const;

export type TerminalAgentStatus =
  (typeof TERMINAL_AGENT_STATUS)[keyof typeof TERMINAL_AGENT_STATUS];

export interface AddSessionOptions {
  /** Internal setup flows may require a dedicated session immediately after
   * the Terminal tab mounts its default session. User-initiated creation must
   * leave this false so rapid clicks remain throttled. */
  bypassCreationCooldown?: boolean;
  /** Shell profile ID to use (if omitted, uses default profile) */
  profileId?: string;
  /** Shell executable path override */
  shell?: string;
  /** Shell arguments override */
  args?: string[];
  /** Custom environment variables */
  env?: Record<string, string>;
  /** Initial working directory for the terminal session */
  cwd?: string;
  /** User-assigned name for this terminal */
  name?: string;
}
