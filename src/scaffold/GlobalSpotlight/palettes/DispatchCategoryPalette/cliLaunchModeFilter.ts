import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import {
  CLI_LAUNCH_MODE,
  type CliLaunchMode,
} from "@src/store/session/creatorStateAtom";

/**
 * Whether the picker's GUI/TUI launch-mode switch hides an installed CLI
 * agent. Only the GUI list is filtered: a runtime without GUI launch support
 * cannot start a managed GUI run. Existing-conversation continuation passes an
 * explicit shell-out allowlist; that runtime path does not require the
 * optional GUI capability, so allowlisted runtimes stay visible. Surfaces
 * without the switch pass `undefined` and never filter.
 */
export function isCliAgentHiddenByLaunchMode(args: {
  cliLaunchMode: CliLaunchMode | undefined;
  agentType: CliAgentType;
  supportsGui: boolean;
  allowedCliAgentTypes?: readonly CliAgentType[];
}): boolean {
  if (args.cliLaunchMode !== CLI_LAUNCH_MODE.GUI) return false;
  if (args.supportsGui) return false;
  return !args.allowedCliAgentTypes?.includes(args.agentType);
}
