/**
 * SessionCreatorChatPanel — presentation.
 *
 * The repository display, org-members panel state and browser scroll-nav shim
 * for the hero area, and the agent hero content, icons and region notice for
 * the selected agent.
 */
import type { TFunction } from "i18next";

import type { UseBrowserAddToConversationActionReturn } from "@src/engines/ChatPanel/hooks/useBrowserAddToConversationAction";
import type { OrgDefinition } from "@src/modules/MainApp/AgentOrgs/types";

import type {
  SessionCreatorChatPanelSingleProps,
  SessionCreatorChatPanelVariant,
} from "./types";
import type { useChatPanelAgentMode } from "./useChatPanelAgentMode";
import { useChatPanelAgentPresentation } from "./useChatPanelAgentPresentation";
import { useChatPanelHeroPresentation } from "./useChatPanelHeroPresentation";
import type { useChatPanelSessionCreator } from "./useChatPanelSessionCreator";

interface UseChatPanelPresentationOptions extends Pick<
  SessionCreatorChatPanelSingleProps,
  "onRegionNoticeChange"
> {
  browserAddToConversationNav: UseBrowserAddToConversationActionReturn;
  mode: ReturnType<typeof useChatPanelAgentMode>;
  orgs: OrgDefinition[];
  session: ReturnType<typeof useChatPanelSessionCreator>;
  t: TFunction<"sessions">;
  variant: SessionCreatorChatPanelVariant;
}

export function useChatPanelPresentation({
  browserAddToConversationNav,
  mode,
  onRegionNoticeChange,
  orgs,
  session,
  t,
  variant,
}: UseChatPanelPresentationOptions) {
  const {
    agentIconId,
    agentName,
    cliAgentType,
    dispatchCategory,
    isCliMode,
    isCursorIdeMode,
    isOSMode,
    isRustMode,
    selectedAgentDefId,
    selectedAgentOrgId,
    targetKind,
  } = mode;
  const {
    creator: { advancedConfig, effectiveSource, repos },
    currentRepo,
  } = session;

  // ── Hero section ──────────────────────────────────────────────────────────

  const hero = useChatPanelHeroPresentation({
    effectiveSource,
    repos,
    currentRepo,
    variant,
    isOSMode,
    targetKind,
    selectedAgentOrgId,
    browserAddToConversationNav,
    t,
  });

  const {
    allAgentDefinitions,
    compactHeaderIcon,
    heroContent,
    heroIcon,
    selectedOrg,
  } = useChatPanelAgentPresentation({
    advancedConfig,
    agentIconId,
    agentName,
    cliAgentType,
    dispatchCategory,
    isCliMode,
    isCursorIdeMode,
    isOSMode,
    isRustMode,
    onRegionNoticeChange,
    orgs,
    selectedAgentDefId,
    selectedAgentOrgId,
    targetKind,
  });

  return {
    allAgentDefinitions,
    compactHeaderIcon,
    hero,
    heroContent,
    heroIcon,
    selectedOrg,
  };
}
