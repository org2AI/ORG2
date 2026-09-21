/**
 * SessionCreatorChatPanel — view prop types.
 *
 * The flat props of `SessionCreatorChatPanelView`. The view's section
 * components pick their subsets from it, so they never import the view.
 */
import type React from "react";

import type { DispatchCategory } from "@src/api/tauri/session";
import type { CliAgentType } from "@src/api/types/keys";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import type { CreatorComposerPosition } from "@src/config/sessionCreatorConfig";
import type { ScrollNavState } from "@src/engines/ChatPanel/ChatHistory";
import type { SessionLaunchWorkItemContext } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import type { AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette";
import type { CreatorRepoChromePosition } from "@src/store/session";
import type { ModelPickerStyle } from "@src/store/ui/chatPanel/displayPrefsAtoms";

import type { EditorArea, SessionInfoLine } from "../../components";
import type ScreenPickerModal from "./ScreenPickerModal";
import type SessionCreatorOrgMembersPanel from "./SessionCreatorOrgMembersPanel";
import type { SessionCreatorAgentHeroContent } from "./resolveSessionCreatorAgentHero";
import type {
  SessionCreatorChatPanelHeaderLayout,
  SessionCreatorLaunchpadIntent,
} from "./types";

interface CategoryPickerProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  currentAgentDefinitionId?: string;
  currentAgentOrgId?: string;
  currentCategory: DispatchCategory;
  currentCliAgentType?: CliAgentType;
  includeHumanSession: boolean;
  modelPickerStyle: ModelPickerStyle;
  onClose: () => void;
  onSelect: (selection: AgentSelection) => void;
}

interface CliVersionAlert {
  cliDisplayName: string | undefined;
  installedVersion: string | undefined;
  latestVersion: string | undefined;
  refreshing: boolean;
  onMuteUntilNextVersion: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export interface SessionCreatorChatPanelViewProps {
  agentHeroRef: React.RefObject<HTMLButtonElement | null>;
  browserElementScrollNav: ScrollNavState;
  canLaunch: boolean;
  centerFullScreenContent: boolean;
  className: string;
  cliLaunchModeSwitch: React.ReactNode;
  cliVersionAlert?: CliVersionAlert;
  compactHeaderIcon: React.ReactNode;
  composerHeaderContent?: React.ReactNode;
  composerPosition: CreatorComposerPosition;
  composerInputRef: React.RefObject<ComposerInputRef | null>;
  editorAreaProps: React.ComponentProps<typeof EditorArea>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  footerSlot?: React.ReactNode;
  headerLayout: SessionCreatorChatPanelHeaderLayout;
  spotlight?: boolean;
  heroFooterSlot?: React.ReactNode;
  heroContent: SessionCreatorAgentHeroContent;
  heroIcon: React.ReactNode;
  hidePresenceButton: boolean;
  hideRepoLine: boolean;
  hideWorkItemAttachmentControl: boolean;
  innerClassName?: string;
  isCategorySelectorOpen: boolean;
  isCliTuiMode: boolean;
  isFullScreenVariant: boolean;
  isLaunchpadLayout: boolean;
  launchpadIntent: SessionCreatorLaunchpadIntent;
  isLoading: boolean;
  hideSessionSetupControls: boolean;
  isOrgMembersPanelOpen: boolean;
  isWingmanMode: boolean;
  leadingActionSlot?: React.ReactNode;
  /**
   * Runner list rendered in place of the launchpad's agent hero + action
   * cards while multi-runner mode is on. Present only for that mode.
   */
  multiRunnerContent?: React.ReactNode;
  onAttachedWorkItemContextChange: React.Dispatch<
    React.SetStateAction<SessionLaunchWorkItemContext | null>
  >;
  onCategoryPickerOpen: () => void;
  onFileUpload: React.ChangeEventHandler<HTMLInputElement>;
  onLaunch: () => void;
  onPinnedActionsVisibleChange: (visible: boolean) => void;
  onRepoChromePositionChange: (position: CreatorRepoChromePosition) => void;
  onShareScreen: () => Promise<unknown>;
  onToggleOrgMembers: () => void;
  orgMembersPanelProps?: React.ComponentProps<
    typeof SessionCreatorOrgMembersPanel
  >;
  pinnedActionsContent?: React.ReactNode;
  pinnedActionsVisible: boolean;
  repoChromePosition: CreatorRepoChromePosition;
  categoryPickerProps: CategoryPickerProps;
  screenPickerProps?: React.ComponentProps<typeof ScreenPickerModal>;
  sessionInfoProps: React.ComponentProps<typeof SessionInfoLine>;
  showMissingGitAlert: boolean;
  workItemContext: SessionLaunchWorkItemContext | null;
}
