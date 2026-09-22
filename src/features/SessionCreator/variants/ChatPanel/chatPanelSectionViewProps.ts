/**
 * SessionCreatorChatPanel — per-section view props.
 *
 * Assembles the flat props of `SessionCreatorChatPanelView` from the panel's
 * hook results, one builder per view section. This module holds the layout,
 * agent identity, launchpad and session setup sections; the composer and
 * repository chrome sections are in `chatPanelComposerViewProps.tsx`.
 */
import type { SessionCreatorChatPanelViewProps as ViewProps } from "./chatPanelViewTypes";
import type { SessionCreatorChatPanelSingleProps } from "./types";
import type { useChatPanelAgentMode } from "./useChatPanelAgentMode";
import type { useChatPanelLaunchControls } from "./useChatPanelLaunchControls";
import type { useChatPanelPresentation } from "./useChatPanelPresentation";
import type { useChatPanelSelectionHandlers } from "./useChatPanelSelectionHandlers";
import type { useChatPanelSessionCreator } from "./useChatPanelSessionCreator";

type AgentMode = ReturnType<typeof useChatPanelAgentMode>;
type SessionCreator = ReturnType<typeof useChatPanelSessionCreator>;
type SelectionHandlers = ReturnType<typeof useChatPanelSelectionHandlers>;
type Presentation = ReturnType<typeof useChatPanelPresentation>;
type LaunchControls = ReturnType<typeof useChatPanelLaunchControls>;

// ── Layout ────────────────────────────────────────────────────────────────────

type ChatPanelLayoutViewProps = Pick<
  ViewProps,
  | "centerFullScreenContent"
  | "className"
  | "composerPosition"
  | "headerLayout"
  | "hideSessionSetupControls"
  | "innerClassName"
  | "isFullScreenVariant"
  | "isLaunchpadLayout"
  | "spotlight"
>;

interface ChatPanelLayoutViewPropsInput extends Omit<
  ChatPanelLayoutViewProps,
  "hideSessionSetupControls" | "isFullScreenVariant" | "isLaunchpadLayout"
> {
  layout: SessionCreatorChatPanelSingleProps["layout"];
  mode: AgentMode;
  presentation: Presentation;
}

/** Wrapper, content padding and stack layout. */
export function buildChatPanelLayoutViewProps({
  centerFullScreenContent,
  className,
  composerPosition,
  headerLayout,
  innerClassName,
  layout,
  mode: { isHumanMode },
  presentation: {
    hero: { isFullScreenVariant },
  },
  spotlight,
}: ChatPanelLayoutViewPropsInput): ChatPanelLayoutViewProps {
  return {
    centerFullScreenContent,
    className,
    composerPosition,
    headerLayout,
    innerClassName,
    isFullScreenVariant,
    isLaunchpadLayout: layout === "launchpad",
    spotlight,
    hideSessionSetupControls: isHumanMode,
  };
}

// ── Agent identity ────────────────────────────────────────────────────────────

interface ChatPanelAgentViewPropsInput {
  includeHumanSession: boolean;
  mode: AgentMode;
  presentation: Presentation;
  selection: SelectionHandlers;
}

/** Agent hero, compact agent pill and the dispatch-category picker. */
export function buildChatPanelAgentViewProps({
  includeHumanSession,
  mode: {
    cliAgentType,
    dispatchCategory,
    selectedAgentDefId,
    selectedAgentOrgId,
  },
  presentation: { compactHeaderIcon, heroContent, heroIcon },
  selection: {
    agentHeroRef,
    handleAgentPickerSelect,
    isCategorySelectorOpen,
    modelPickerStyle,
    setIsCategorySelectorOpen,
  },
}: ChatPanelAgentViewPropsInput): Pick<
  ViewProps,
  | "agentHeroRef"
  | "categoryPickerProps"
  | "compactHeaderIcon"
  | "heroContent"
  | "heroIcon"
  | "isCategorySelectorOpen"
  | "onCategoryPickerOpen"
> {
  return {
    agentHeroRef,
    compactHeaderIcon,
    heroContent,
    heroIcon,
    isCategorySelectorOpen,
    onCategoryPickerOpen: () => setIsCategorySelectorOpen(true),
    categoryPickerProps: {
      includeHumanSession,
      modelPickerStyle,
      onClose: () => setIsCategorySelectorOpen(false),
      onSelect: handleAgentPickerSelect,
      currentCategory: dispatchCategory,
      currentAgentDefinitionId: selectedAgentDefId ?? undefined,
      currentAgentOrgId: selectedAgentOrgId ?? undefined,
      currentCliAgentType: cliAgentType ?? undefined,
      anchorRef: agentHeroRef,
    },
  };
}

// ── Launchpad ─────────────────────────────────────────────────────────────────

interface ChatPanelLaunchpadViewPropsInput extends Pick<
  ViewProps,
  "heroFooterSlot" | "hideWorkItemAttachmentControl" | "launchpadIntent"
> {
  launchControls: LaunchControls;
  session: SessionCreator;
}

/** Launchpad actions, the attached work item and the runner list. */
export function buildChatPanelLaunchpadViewProps({
  heroFooterSlot,
  hideWorkItemAttachmentControl,
  launchControls: { multiRunner },
  launchpadIntent,
  session: { attachedWorkItemContext, setAttachedWorkItemContext },
}: ChatPanelLaunchpadViewPropsInput): Pick<
  ViewProps,
  | "heroFooterSlot"
  | "hideWorkItemAttachmentControl"
  | "launchpadIntent"
  | "multiRunnerContent"
  | "onAttachedWorkItemContextChange"
  | "workItemContext"
> {
  return {
    heroFooterSlot,
    hideWorkItemAttachmentControl,
    launchpadIntent,
    multiRunnerContent: multiRunner.middleContent,
    onAttachedWorkItemContextChange: setAttachedWorkItemContext,
    workItemContext: attachedWorkItemContext,
  };
}

// ── Session setup ─────────────────────────────────────────────────────────────

interface ChatPanelSetupViewPropsInput extends Pick<
  ViewProps,
  | "footerSlot"
  | "hidePresenceButton"
  | "leadingActionSlot"
  | "pinnedActionsContent"
> {
  launchControls: LaunchControls;
  mode: AgentMode;
  presentation: Presentation;
  selection: SelectionHandlers;
  session: SessionCreator;
}

/** Skills & Tools row, org-members panel, notices, presence and footer. */
export function buildChatPanelSetupViewProps({
  footerSlot,
  hidePresenceButton,
  launchControls: { cliVersionAlert },
  leadingActionSlot,
  mode: {
    cli: { enabledCliAgentList },
    isHumanMode,
  },
  pinnedActionsContent,
  presentation: {
    allAgentDefinitions,
    hero: {
      browserElementScrollNav,
      handleToggleOrgMembers,
      isOrgMembersPanelOpen,
    },
    selectedOrg,
  },
  selection: { handleAdvancedConfigChange },
  session: {
    creator: { advancedConfig },
    showMissingGitAlert,
  },
}: ChatPanelSetupViewPropsInput): Pick<
  ViewProps,
  | "browserElementScrollNav"
  | "cliVersionAlert"
  | "footerSlot"
  | "hidePresenceButton"
  | "isOrgMembersPanelOpen"
  | "leadingActionSlot"
  | "onToggleOrgMembers"
  | "orgMembersPanelProps"
  | "pinnedActionsContent"
  | "showMissingGitAlert"
> {
  return {
    browserElementScrollNav,
    cliVersionAlert,
    footerSlot,
    hidePresenceButton,
    isOrgMembersPanelOpen,
    leadingActionSlot,
    onToggleOrgMembers: handleToggleOrgMembers,
    orgMembersPanelProps: selectedOrg
      ? {
          org: selectedOrg,
          advancedConfig,
          onAdvancedConfigChange: handleAdvancedConfigChange,
          allAgents: allAgentDefinitions,
          cliAgents: enabledCliAgentList,
        }
      : undefined,
    pinnedActionsContent: isHumanMode ? undefined : pinnedActionsContent,
    showMissingGitAlert: !isHumanMode && showMissingGitAlert,
  };
}
