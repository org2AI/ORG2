/**
 * Public Chat Panel tab API.
 *
 * Command consumers use this boundary for opening, closing and navigating tabs.
 * Model, factory and state readers should import their owning modules directly.
 * Existing exports remain available for API compatibility; atom identity comes
 * from the single definition in each owner, not from this forwarding module.
 */
export {
  clearChatPanelTabCliCommandAtom,
  closeAndDestroyChatPanelTabAtom,
  closeChatPanelTabAtom,
  closeOrganizationChatPanelTabAtom,
  closeOtherChatPanelTabsAtom,
  closeOtherThanActiveChatPanelTabsAtom,
  closeProjectOrgChatPanelTabsAtom,
  closeRevokedCloudChannelChatPanelTabsAtom,
  closeSessionChatPanelTabsAtom,
  closeWorkItemChatPanelTabAtom,
  nextChatPanelTabAtom,
  prevChatPanelTabAtom,
  reconcileDiscussionChannelTabsAtom,
  reorderChatPanelTabsAtom,
  setActiveWorkManagementSectionAtom,
  setChatPanelTabTitleAtom,
  toggleChatPanelTabTuiModeAtom,
  type ReconcileDiscussionChannelTabsInput,
} from "./chatPanelTabLifecycleAtoms";
export {
  openChannelInChatPanelTabAtom,
  openGitHubIssueInChatPanelTabAtom,
  openGitHubPrInChatPanelTabAtom,
  openTeamInboxInChatPanelTabAtom,
} from "./chatPanelTabOpen/integrations";
export {
  addChatPanelTerminalTabAtom,
  openRuntimeInChatPanelTabAtom,
  openOrFocusSessionInChatPanelTabAtom,
  openOrReplaceSessionInChatPanelTabAtom,
  openRunGroupInChatPanelTabAtom,
  openSessionInNewChatTabAtom,
} from "./chatPanelTabOpen/session";
export {
  addChatPanelLaunchpadTabAtom,
  openCreateTargetInChatPanelStartPageAtom,
  openExploreInChatPanelTabAtom,
  openOrFocusChatPanelStartPageTabAtom,
} from "./chatPanelTabOpen/startPage";
export {
  openOrganizationInChatPanelTabAtom,
  openWorkManagementChatPanelTabAtom,
  openProjectInChatPanelTabAtom,
  openWorkItemInChatPanelTabAtom,
  openWorkspaceOverviewInChatPanelTabAtom,
} from "./chatPanelTabOpen/workManagement";
export {
  buildChannelTabKey,
  buildDefaultLaunchpadTab,
  buildInitialChatPanelTabsState,
  createChannelTab,
  createGitHubIssueTab,
  createGitHubPrTab,
  createOrganizationTab,
  createLaunchpadTab,
  createRuntimeTab,
  createSessionTab,
  createTeamInboxTab,
  createTerminalTab,
  createWorkManagementTab,
  createWorkspaceTab,
} from "./chatPanelTabFactories";
export {
  defineChatPanelTabFactory,
  type ChatPanelTabFactoryConfig,
  type ChatPanelTabIdStrategy,
  type ChatPanelTabPayload,
} from "./chatPanelTabFactory";
export {
  activateChatPanelTabAtom,
  syncActiveChatPanelTabStateAtom,
  toggleActiveChatPanelMaximizedAtom,
} from "./chatPanelTabPresentationAtoms";
export {
  activeChatPanelTabCanGoBackAtom,
  activeChatPanelTabCanGoForwardAtom,
  activeChatPanelTabHistoryAtom,
  chatPanelTabHistoriesAtom,
  goBackChatPanelTabAtom,
  goForwardChatPanelTabAtom,
  navigateChatPanelTabToSessionAtom,
  type ChatPanelTabHistory,
} from "./chatPanelTabNavigationAtoms";
export {
  isChatPanelTabStationAvailable,
  normalizePersistedChatPanelTabsState,
  resolveChatPanelMaximizedForLayout,
  type ChatPanelSelectedChannel,
  type ChatPanelTab,
  type ChatPanelTabsState,
  type ChatPanelTabType,
} from "./chatPanelTabsModel";
export {
  activeChatPanelTabAtom,
  activeChatPanelTabTypeAtom,
  activeWorkManagementSectionAtom,
  chatPanelTabCountAtom,
  chatPanelTabsAtom,
} from "./chatPanelTabsState";
export {
  canMoveChatPanelTabToWorkstation,
  canMoveWorkstationPrTabToChatPanel,
  moveChatPanelTabToWorkstationAtom,
  moveWorkstationPrTabToChatPanelAtom,
} from "./chatPanelTabPlacementAtom";
export {
  openRecentChatPanelTabAtom,
  recentChatPanelTabsAtom,
} from "./chatPanelRecentTabs";

export { openChatPanelCreateTargetAtom } from "./openChatPanelCreateTargetAtom";
