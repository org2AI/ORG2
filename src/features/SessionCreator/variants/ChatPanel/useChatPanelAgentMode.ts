/**
 * SessionCreatorChatPanel — agent mode.
 *
 * The creator's dispatch selection (category, CLI agent, target kind, agent
 * definition / org, display name and icon), the selected CLI agent's
 * configuration, and the mode flags derived from them.
 */
import { useAtomValue } from "jotai";

import {
  agentIconIdAtom,
  agentNameAtom,
  cliAgentTypeAtom,
  dispatchCategoryAtom,
  selectedAgentDefinitionIdAtom,
  selectedAgentOrgIdAtom,
  sessionTargetKindAtom,
} from "@src/store/session";
import { getRustAgentType } from "@src/util/session/sessionDispatch";

import { useCliAgentConfiguration } from "./useCliAgentConfiguration";

export function useChatPanelAgentMode() {
  // Read atoms needed before useSessionCreator so we can pass derived values in.
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const cliAgentType = useAtomValue(cliAgentTypeAtom);
  const isCliMode = dispatchCategory === "cli_agent";
  const isHumanMode = dispatchCategory === "human_session";
  const cli = useCliAgentConfiguration({ cliAgentType, isCliMode });
  const { cliComposerEnabled } = cli;

  const targetKind = useAtomValue(sessionTargetKindAtom);
  const selectedAgentDefId = useAtomValue(selectedAgentDefinitionIdAtom);
  const selectedAgentOrgId = useAtomValue(selectedAgentOrgIdAtom);
  const agentName = useAtomValue(agentNameAtom);
  const agentIconId = useAtomValue(agentIconIdAtom);

  const agentVariant = getRustAgentType(selectedAgentDefId);
  const isRustMode = dispatchCategory === "rust_agent";
  const isOSMode = isRustMode && agentVariant === "os";
  const isSDEMode = isRustMode && agentVariant === "sde";
  const isWingmanMode = isRustMode && agentVariant === "wingman";
  const isCursorIdeMode = dispatchCategory === "cursor_ide";
  const isCliTuiMode = isCliMode && !cliComposerEnabled;

  return {
    agentIconId,
    agentName,
    cli,
    cliAgentType,
    dispatchCategory,
    isCliMode,
    isCliTuiMode,
    isCursorIdeMode,
    isHumanMode,
    isOSMode,
    isRustMode,
    isSDEMode,
    isWingmanMode,
    selectedAgentDefId,
    selectedAgentOrgId,
    targetKind,
  };
}
